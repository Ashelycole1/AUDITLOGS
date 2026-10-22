"""Changes to queries: CIA field edits with revisions, assignment and reassignment (design.md 6 and 7)."""

from datetime import date

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Role, User, can_assign
from apps.auditlog.services import record
from apps.core.validators import MIN_REASON
from apps.notifications import services as notify
from apps.workflow.models import Decision, ReassignmentRequest
from apps.workflow.services import REASSIGNABLE, WorkflowError, transition

from .models import Assignment, Query, QueryRevision, Status

# Fields the CIA may correct after import. The originals are kept (system.md 4.2).
EDITABLE_FIELDS = (
    "title",
    "description_current",
    "risk_rating_current",
    "deadline",
    "responsible_officer",
    "department",
)


def _text(value) -> str:
    return value.isoformat() if isinstance(value, date) else str(value)


def _has_reason(reason: str) -> bool:
    return len((reason or "").strip()) >= MIN_REASON


@transaction.atomic
def edit_query(*, query: Query, actor: User, changes: dict, reason: str, ip=None) -> Query:
    query = Query.objects.select_for_update().get(pk=query.pk)
    changed = {
        f: v for f, v in changes.items() if f in EDITABLE_FIELDS and _text(getattr(query, f)) != _text(v)
    }
    if not changed:
        return query
    old = {f: _text(getattr(query, f)) for f in changed}
    for field, value in changed.items():
        QueryRevision.objects.create(
            query=query,
            field=field,
            old_value=old[field],
            new_value=_text(value),
            edited_by=actor,
            reason=reason,
        )
        setattr(query, field, value)
    query.save(update_fields=[*changed, "updated_at"])
    record(
        actor=actor,
        action="query.edit",
        object_type="Query",
        object_id=query.pk,
        old=old,
        new={f: _text(v) for f, v in changed.items()},
        reason=reason,
        ip=ip,
    )
    return query


def _check_assignee(actor: User, assignee: User) -> None:
    # Assignment flows down the chain (owner, 2026-10-22): PIA and CIA assign an IA or an SIA.
    if not can_assign(actor, assignee):
        raise WorkflowError("Choose an active Internal Auditor or Senior Internal Auditor.")


def _move(query: Query, actor: User, assignee: User) -> User | None:
    """End the current assignment and start the new one. The old auditor loses access at once."""
    previous = query.current_assignee
    Assignment.objects.filter(query=query, active=True).update(active=False, ended_at=timezone.now())
    Assignment.objects.create(query=query, assignee=assignee, assigned_by=actor)
    query.current_assignee = assignee
    query.save(update_fields=["current_assignee", "updated_at"])
    return previous


@transaction.atomic
def assign(*, query: Query, actor: User, assignee: User, reason: str = "", ip=None) -> Query:
    """Assign, or reassign straight away (CIA only). The new auditor sees the full history; the old one
    loses access at once (design.md 7). A PIA's reassignment goes to the CIA instead (request_reassignment).
    """
    query = Query.objects.select_for_update().get(pk=query.pk)
    _check_assignee(actor, assignee)
    if query.status == Status.CLOSED:
        raise WorkflowError("This query is closed. Reopen it before changing the auditor.")
    if query.status == Status.PENDING_APPROVAL:
        raise WorkflowError("A reassignment of this query is waiting for the CIA. Decide it first.")
    previous = query.current_assignee
    if previous and previous.pk == assignee.pk:
        raise WorkflowError(f"{assignee.full_name} is already the auditor.")
    if previous and actor.effective_role() != Role.CIA:
        raise WorkflowError("Reassigning needs the CIA's approval. Request the reassignment instead.")
    if previous and not _has_reason(reason):
        raise WorkflowError(f"Give a reason of at least {MIN_REASON} characters for reassigning.")

    _move(query, actor, assignee)
    record(
        actor=actor,
        action="query.reassign" if previous else "query.assign",
        object_type="Query",
        object_id=query.pk,
        old={"assignee": str(previous.pk)} if previous else None,
        new={"assignee": str(assignee.pk)},
        reason=reason,
        ip=ip,
    )
    if query.status == Status.IMPORTED:
        query = transition(query, Status.ASSIGNED, actor, reason, ip=ip)
    notify.about_query(
        [assignee], query, "Reassigned to you" if previous else "Assigned to you", exclude=actor
    )
    return query


@transaction.atomic
def bulk_assign(
    *, queries: list[Query], actor: User, assignee: User, reason: str = "", ip=None
) -> list[Query]:
    """All or nothing: one failure leaves every query as it was."""
    return [assign(query=q, actor=actor, assignee=assignee, reason=reason, ip=ip) for q in queries]


@transaction.atomic
def request_reassignment(
    *, query: Query, actor: User, assignee: User, reason: str, ip=None
) -> ReassignmentRequest:
    """A PIA asks to move a query to another auditor. It is Pending Approval until the CIA decides,
    and the current auditor keeps it meanwhile (owner, 2026-10-22)."""
    query = Query.objects.select_for_update().select_related("current_assignee").get(pk=query.pk)
    _check_assignee(actor, assignee)
    if not query.current_assignee_id:
        raise WorkflowError("This query has no auditor yet. Assign it instead.")
    if query.current_assignee_id == assignee.pk:
        raise WorkflowError(f"{assignee.full_name} is already the auditor.")
    if query.status == Status.PENDING_APPROVAL:
        raise WorkflowError("A reassignment of this query is already waiting for the CIA.")
    if query.status == Status.PROPOSED:
        raise WorkflowError("This query is proposed for closure. Review the proposal first.")
    if query.status not in REASSIGNABLE:
        raise WorkflowError(f"A query that is {query.status} cannot be reassigned.")
    if not _has_reason(reason):
        raise WorkflowError(f"Give a reason of at least {MIN_REASON} characters for reassigning.")
    request = ReassignmentRequest.objects.create(
        query=query,
        from_assignee=query.current_assignee,
        to_assignee=assignee,
        from_status=query.status,
        requested_by=actor,
        reason=reason.strip(),
    )
    record(
        actor=actor,
        action="reassign.request",
        object_type="Query",
        object_id=query.pk,
        old={"assignee": str(query.current_assignee_id)},
        new={"assignee": str(assignee.pk), "request": str(request.pk)},
        reason=reason,
        ip=ip,
    )
    query = transition(query, Status.PENDING_APPROVAL, actor, reason, ip=ip)
    notify.about_query(
        notify.chief_auditors(),
        query,
        "Reassignment waiting for your approval",
        f"{actor.full_name} asks to move it from {request.from_assignee.full_name} to {assignee.full_name}.",
    )
    return request


@transaction.atomic
def decide_reassignment(
    *, request_id, actor: User, approve: bool, reason: str = "", ip=None
) -> ReassignmentRequest:
    """The CIA approves (the query moves to the new auditor and is Assigned) or rejects (it goes back
    to the status it had). The requester and, on approval, the new auditor are told."""
    request = (
        ReassignmentRequest.objects.select_for_update()
        .select_related("query", "to_assignee", "requested_by")
        .get(pk=request_id)
    )
    if request.decision != Decision.PENDING:
        raise WorkflowError(f"This request was already {request.decision.lower()}.")
    if request.requested_by_id == actor.pk:
        raise WorkflowError("You asked for this, so someone else must decide it.")
    if not approve and not _has_reason(reason):
        raise WorkflowError(f"Say why it is rejected, in at least {MIN_REASON} characters.")
    query = Query.objects.select_for_update().get(pk=request.query_id)
    if approve:
        if actor.effective_role() != Role.CIA:
            raise WorkflowError("Only the CIA decides reassignments.")
        if not request.to_assignee.is_active:
            raise WorkflowError(
                f"{request.to_assignee.full_name}'s account is disabled. Reject this request."
            )
        previous = _move(query, actor, request.to_assignee)
        record(
            actor=actor,
            action="reassign.approve",
            object_type="Query",
            object_id=query.pk,
            old={"assignee": str(previous.pk) if previous else None},
            new={"assignee": str(request.to_assignee_id), "request": str(request.pk)},
            reason=reason,
            ip=ip,
        )
        query = transition(query, Status.ASSIGNED, actor, reason, ip=ip)
    else:
        # The transition table allows only the CIA to move a query out of Pending Approval.
        query = transition(query, request.from_status, actor, reason, action="reassign.reject", ip=ip)
    request.decision = Decision.APPROVED if approve else Decision.REJECTED
    request.decided_by = actor
    request.decision_reason = (reason or "").strip()
    request.decided_at = timezone.now()
    request.save(update_fields=["decision", "decided_by", "decision_reason", "decided_at", "updated_at"])
    if approve:
        notify.about_query([request.requested_by], query, "Reassignment approved", exclude=actor)
        notify.about_query([request.to_assignee], query, "Reassigned to you", exclude=actor)
    else:
        notify.about_query(
            [request.requested_by], query, "Reassignment rejected", "The reason is on the query."
        )
    return request
