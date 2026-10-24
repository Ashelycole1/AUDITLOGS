"""Retention rules and disposal (system.md 4.7, design.md 12).

The CIA sets how many months each record type is kept; there are no defaults (system.md 9). Each week
check_retention lists what has passed its period as Pending disposals, and the CIA approves or rejects
each one with a reason. The system raises the candidate, so the CIA's approval is never self-approval.

An approved disposal erases the content and keeps a stub (owner, 2026-10-24):
- a closed query keeps its reference, risk ratings, department, dates, assignee and Closed status, and
  is stamped disposed_at. Its text, the responsible officer's name, its follow-up, comments, revision
  values and request reasons are blanked, its evidence files are destroyed, and its import preview row
  is cleared;
- an import file is destroyed and its preview rows are cleared. The queries it created are untouched.
The audit log keeps its entries. A rejected candidate is listed again a year after the rejection.

The models refuse edits to originals and to follow-up on purpose. Disposal is the one exception, so it
writes through the base QuerySet.update here and nowhere else.
"""

import logging
from datetime import timedelta
from pathlib import Path

from django.db import models, transaction
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.auditlog.services import record
from apps.core.exceptions import RuleError
from apps.core.validators import MIN_REASON
from apps.followup.models import Comment, Evidence, FollowUpActivity
from apps.imports.models import BatchStatus, ImportBatch, ImportRow
from apps.notifications import services as notify
from apps.organizations.models import Organization, OrgStatus
from apps.queries.models import Query, QueryRevision, Status
from apps.workflow.models import ReassignmentRequest, StatusChangeRequest

from .models import DisposalRecord, DisposalStatus, RecordType, RetentionRule

log = logging.getLogger(__name__)

ERASED = "(disposed)"
MAX_MONTHS = 1200
# A rejected candidate is listed again after this long.
RECHECK_AFTER = timedelta(days=365)


class DisposalError(RuleError):
    status_code = 409


def months_before(moment, months: int):
    """The same day `months` calendar months earlier, clamped to the month's last day."""
    year, month = divmod(moment.month - 1 - months, 12)
    year, month = moment.year + year, month + 1
    for day in (moment.day, 30, 29, 28):
        try:
            return moment.replace(year=year, month=month, day=day)
        except ValueError:
            continue
    raise ValueError("unreachable")


# Retention rules -------------------------------------------------------------------------------------


@transaction.atomic
def set_rule(*, actor: User, record_type: str, months: int, reason: str, ip=None) -> RetentionRule:
    if actor.effective_role() != Role.CIA:
        raise DisposalError("Only the CIA sets retention rules.")
    if record_type not in RecordType.values:
        raise DisposalError("Choose a record type.")
    if not 1 <= months <= MAX_MONTHS:
        raise DisposalError(f"Give a period of 1 to {MAX_MONTHS} months.")
    if len((reason or "").strip()) < MIN_REASON:
        raise DisposalError(f"Say where the period comes from, in at least {MIN_REASON} characters.")
    rule = (
        RetentionRule.objects.select_for_update()
        .in_org(actor.organization_id)
        .filter(record_type=record_type)
        .first()
    )
    old = {"retention_months": rule.retention_months} if rule else None
    if rule and rule.retention_months == months:
        return rule
    if rule is None:
        rule = RetentionRule(organization_id=actor.organization_id, record_type=record_type)
    rule.retention_months = months
    rule.approved_by = actor
    rule.approved_at = timezone.now()
    rule.reason = reason.strip()
    rule.save()
    record(
        actor=actor,
        action="retention.set",
        object_type="RetentionRule",
        object_id=rule.pk,
        old=old,
        new={"record_type": record_type, "retention_months": months},
        reason=rule.reason,
        ip=ip,
    )
    return rule


# Finding what is due ---------------------------------------------------------------------------------


def _due_queries(org_id, cutoff):
    return Query.objects.in_org(org_id).filter(
        status=Status.CLOSED, disposed_at__isnull=True, closed_at__isnull=False, closed_at__lte=cutoff
    )


def _due_batches(org_id, cutoff):
    return (
        ImportBatch.objects.in_org(org_id)
        .exclude(source_file_path="")
        .filter(
            models.Q(status=BatchStatus.CONFIRMED, confirmed_at__lte=cutoff)
            | models.Q(status=BatchStatus.CANCELLED, updated_at__lte=cutoff)
        )
    )


def candidates(org_id, record_type: str, months: int):
    """(object id, label, since) for each record of this type past its period."""
    cutoff = months_before(timezone.now(), months)
    if record_type == RecordType.CLOSED_QUERY:
        return [(q.pk, q.reference, q.closed_at) for q in _due_queries(org_id, cutoff)]
    return [(b.pk, b.source_filename, b.confirmed_at or b.updated_at) for b in _due_batches(org_id, cutoff)]


def _skip(org_id) -> set:
    """Already waiting, already disposed, or rejected less than a year ago."""
    return set(
        DisposalRecord.objects.in_org(org_id)
        .filter(
            models.Q(status__in=[DisposalStatus.PENDING, DisposalStatus.DISPOSED])
            | models.Q(status=DisposalStatus.REJECTED, decided_at__gte=timezone.now() - RECHECK_AFTER)
        )
        .values_list("object_id", flat=True)
    )


@transaction.atomic
def check_organization(org: Organization) -> int:
    made = []
    skip = _skip(org.pk)
    for rule in RetentionRule.objects.in_org(org.pk):
        for object_id, label, since in candidates(org.pk, rule.record_type, rule.retention_months):
            if object_id in skip:
                continue
            item = DisposalRecord.objects.create(
                organization=org,
                record_type=rule.record_type,
                object_id=object_id,
                label=label[:255],
                since=since,
                retention_months=rule.retention_months,
            )
            record(
                actor=None,
                action="disposal.flag",
                object_type="DisposalRecord",
                object_id=item.pk,
                new={"record_type": item.record_type, "object": str(object_id), "label": item.label},
                organization=org,
            )
            made.append(item)
    if made:
        notify.send(
            notify.chief_auditors(org.pk),
            f"{len(made)} record{'s' if len(made) != 1 else ''} due for disposal",
            "They passed their retention period. Approve or reject each one.",
            link="/compliance",
        )
    return len(made)


def check_retention() -> int:
    """Weekly (architecture.md 5.7), for every active organization."""
    return sum(check_organization(org) for org in Organization.objects.filter(status=OrgStatus.ACTIVE))


# Deciding and erasing --------------------------------------------------------------------------------


def _destroy_later(paths: list[str]) -> None:
    """Files go only once the erasure is committed, so a rollback never leaves a stub without its file."""

    def destroy() -> None:
        for path in paths:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                log.exception("A disposed file could not be removed; ICT should remove it by hand.")

    transaction.on_commit(destroy)


def _erase_query(query: Query, now) -> dict:
    update = models.QuerySet.update
    pk = query.pk
    evidence = list(Evidence.objects.filter(query_id=pk).values_list("stored_path", flat=True))
    counts = {
        "activities": update(FollowUpActivity.objects.filter(query_id=pk), body=""),
        "comments": update(Comment.objects.filter(query_id=pk), body=""),
        "revisions": update(
            QueryRevision.objects.filter(query_id=pk), old_value="", new_value="", reason=ERASED
        ),
        "evidence": update(
            Evidence.objects.filter(query_id=pk), stored_path="", original_filename="(destroyed)"
        ),
    }
    update(StatusChangeRequest.objects.filter(query_id=pk), proposed_reason="", decision_reason="")
    update(ReassignmentRequest.objects.filter(query_id=pk), reason="", decision_reason="")
    ImportRow.objects.filter(batch_id=query.batch_id, data__reference=query.reference).update(
        data={"reference": query.reference}, errors=[], warnings=[]
    )
    update(
        Query.objects.filter(pk=pk),
        title=ERASED,
        description_original="",
        description_current="",
        management_response="",
        recommendation="",
        audit_observation="",
        policy_title="",
        policy_reference="",
        notable_numbers="",
        responsible_officer="",
        disposed_at=now,
        updated_at=now,
    )
    _destroy_later([p for p in evidence if p])
    return counts


def _erase_batch(batch: ImportBatch) -> dict:
    path = batch.source_file_path
    rows = batch.rows.update(data={}, errors=[], warnings=[])
    batch.source_file_path = ""
    batch.save(update_fields=["source_file_path", "updated_at"])
    _destroy_later([path])
    return {"rows": rows}


def _still_due(item: DisposalRecord):
    """The record, if it is still past its period under the current rule; None otherwise."""
    rule = RetentionRule.objects.in_org(item.organization_id).filter(record_type=item.record_type).first()
    if rule is None:
        return None
    cutoff = months_before(timezone.now(), rule.retention_months)
    if item.record_type == RecordType.CLOSED_QUERY:
        source = _due_queries(item.organization_id, cutoff)
    else:
        source = _due_batches(item.organization_id, cutoff)
    return source.select_for_update().filter(pk=item.object_id).first()


@transaction.atomic
def decide(*, actor: User, item: DisposalRecord, approve: bool, reason: str, ip=None) -> DisposalRecord:
    item = DisposalRecord.objects.select_for_update().get(pk=item.pk)
    if actor.effective_role() != Role.CIA:
        raise DisposalError("Only the CIA decides disposals.")
    if item.status != DisposalStatus.PENDING:
        raise DisposalError(f"This disposal was already {item.status.lower()}.")
    if len((reason or "").strip()) < MIN_REASON:
        raise DisposalError(f"Give a reason of at least {MIN_REASON} characters. It is saved in the log.")
    now = timezone.now()
    erased = None
    if approve:
        target = _still_due(item)
        if target is None:
            raise DisposalError(
                "This record is no longer due: it was reopened, already removed, or the rule changed. "
                "Reject it instead."
            )
        erased = (
            _erase_query(target, now) if item.record_type == RecordType.CLOSED_QUERY else _erase_batch(target)
        )
    item.status = DisposalStatus.DISPOSED if approve else DisposalStatus.REJECTED
    item.approved_by = actor
    item.reason = reason.strip()
    item.decided_at = now
    item.disposed_at = now if approve else None
    item.save()
    record(
        actor=actor,
        action="disposal.approve" if approve else "disposal.reject",
        object_type="Query" if item.record_type == RecordType.CLOSED_QUERY else "ImportBatch",
        object_id=item.object_id,
        old={"status": DisposalStatus.PENDING},
        new={"status": item.status, "disposal": str(item.pk), "erased": erased},
        reason=item.reason,
        ip=ip,
    )
    return item
