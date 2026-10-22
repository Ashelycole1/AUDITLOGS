"""Query exports (system.md 4.9). The CIA exports directly; a PIA asks, and downloads only after the
CIA approves (owner, 2026-10-22). Every request, decision and download is in the audit log."""

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.auditlog.services import record
from apps.core import notify
from apps.core.validators import MIN_REASON
from apps.queries.filters import FILTER_KEYS, apply_filters, export_csv
from apps.queries.models import Query

from .models import Decision, ExportRequest
from .services import WorkflowError


def _rows(user: User, filters: dict):
    return apply_filters(Query.objects.for_user(user).select_related("current_assignee"), filters)


def clean_filters(filters: dict) -> dict:
    return {k: str(v) for k, v in (filters or {}).items() if k in FILTER_KEYS and v not in (None, "")}


def export_now(*, actor: User, filters: dict, ip=None) -> tuple[bytes, int]:
    if actor.effective_role() != Role.CIA:
        raise WorkflowError("Only the CIA can export without approval.")
    filters = clean_filters(filters)
    queries = list(_rows(actor, filters))
    record(
        actor=actor,
        action="export.queries",
        object_type="Query",
        object_id="list",
        new={"rows": len(queries), "filters": filters},
        ip=ip,
    )
    return export_csv(queries), len(queries)


@transaction.atomic
def request_export(*, actor: User, filters: dict, reason: str, ip=None) -> ExportRequest:
    if len((reason or "").strip()) < MIN_REASON:
        raise WorkflowError(f"Say why you need the export, in at least {MIN_REASON} characters.")
    if ExportRequest.objects.filter(requested_by=actor, decision=Decision.PENDING).exists():
        raise WorkflowError("You already have an export waiting for the CIA.")
    item = ExportRequest.objects.create(
        requested_by=actor, filters=clean_filters(filters), reason=reason.strip()
    )
    record(
        actor=actor,
        action="export.request",
        object_type="ExportRequest",
        object_id=item.pk,
        new={"filters": item.filters},
        reason=item.reason,
        ip=ip,
    )
    notify.send(
        notify.chief_auditors(),
        "Export waiting for your approval",
        f"{actor.full_name} asks to export queries. Decide it under Approvals in AuditLogs.",
        exclude=actor,
    )
    return item


@transaction.atomic
def decide_export(*, request_id, actor: User, approve: bool, reason: str = "", ip=None) -> ExportRequest:
    item = ExportRequest.objects.select_for_update().select_related("requested_by").get(pk=request_id)
    if item.decision != Decision.PENDING:
        raise WorkflowError(f"This export was already {item.decision.lower()}.")
    if item.requested_by_id == actor.pk:
        raise WorkflowError("You asked for this export, so someone else must decide it.")
    if actor.effective_role() != Role.CIA:
        raise WorkflowError("Only the CIA decides exports.")
    if not approve and len((reason or "").strip()) < MIN_REASON:
        raise WorkflowError(f"Say why it is rejected, in at least {MIN_REASON} characters.")
    item.decision = Decision.APPROVED if approve else Decision.REJECTED
    item.decided_by = actor
    item.decision_reason = (reason or "").strip()
    item.decided_at = timezone.now()
    item.save(update_fields=["decision", "decided_by", "decision_reason", "decided_at", "updated_at"])
    record(
        actor=actor,
        action="export.approve" if approve else "export.reject",
        object_type="ExportRequest",
        object_id=item.pk,
        old={"decision": Decision.PENDING},
        new={"decision": item.decision},
        reason=item.decision_reason,
        ip=ip,
    )
    notify.send(
        [item.requested_by],
        "Export approved" if approve else "Export rejected",
        (
            "The CIA approved your export. Download it from Approvals in AuditLogs."
            if approve
            else "The CIA rejected your export. The reason is under Reviews in AuditLogs."
        ),
    )
    return item


@transaction.atomic
def download_export(*, request_id, actor: User, ip=None) -> tuple[bytes, int]:
    item = ExportRequest.objects.select_for_update().get(pk=request_id)
    if item.requested_by_id != actor.pk:
        raise WorkflowError("Only the person who asked for this export can download it.")
    if item.decision != Decision.APPROVED:
        raise WorkflowError("This export has not been approved by the CIA.")
    queries = list(_rows(actor, item.filters))
    item.downloads += 1
    item.save(update_fields=["downloads", "updated_at"])
    record(
        actor=actor,
        action="export.download",
        object_type="ExportRequest",
        object_id=item.pk,
        new={"rows": len(queries), "download": item.downloads},
        ip=ip,
    )
    return export_csv(queries), len(queries)
