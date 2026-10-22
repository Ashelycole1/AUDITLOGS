"""The workflow service: the only code that changes a query's status (architecture.md 5.2).

It checks the transition is allowed, the actor's role, that nobody decides their own proposal, and
that a reason is given where required. It writes the audit entry in the same transaction.
"""

from django.db import transaction
from django.utils import timezone

from apps.auditlog.services import record
from apps.core.exceptions import RuleError
from apps.core.validators import MIN_REASON
from apps.notifications import services as notify
from apps.queries.models import Query, Status

from .models import Decision, StatusChangeRequest

AUDITORS = {"IA", "SIA"}
# Statuses a reassignment can start from and, if the CIA rejects it, return to.
REASSIGNABLE = (Status.ASSIGNED, Status.IN_PROGRESS, Status.RETURNED, Status.KEPT_IN_VIEW)

# design.md 5, with the owner's changes of 2026-10-22. (from, to) -> roles that may make the move.
# Anything else is rejected.
TRANSITIONS: dict[tuple[str, str], set[str]] = {
    (Status.IMPORTED, Status.ASSIGNED): {"PIA", "CIA"},
    (Status.ASSIGNED, Status.IN_PROGRESS): AUDITORS,
    (Status.IN_PROGRESS, Status.PROPOSED): AUDITORS,
    (Status.PROPOSED, Status.CLOSED): {"CIA"},
    (Status.PROPOSED, Status.RETURNED): {"PIA", "CIA"},
    (Status.PROPOSED, Status.KEPT_IN_VIEW): {"PIA", "CIA"},
    (Status.RETURNED, Status.IN_PROGRESS): AUDITORS,
    (Status.KEPT_IN_VIEW, Status.IN_PROGRESS): AUDITORS,
    (Status.KEPT_IN_VIEW, Status.RETURNED): {"PIA", "CIA"},
    (Status.CLOSED, Status.IN_PROGRESS): {"CIA"},
    # A PIA's reassignment waits for the CIA, who approves (Assigned) or rejects (back where it was).
    **{(s, Status.PENDING_APPROVAL): {"PIA"} for s in REASSIGNABLE},
    **{(Status.PENDING_APPROVAL, s): {"CIA"} for s in REASSIGNABLE},
}
# Moves that must carry a reason.
REASON_REQUIRED = {
    (Status.IN_PROGRESS, Status.PROPOSED),
    (Status.PROPOSED, Status.RETURNED),
    (Status.PROPOSED, Status.KEPT_IN_VIEW),
    (Status.KEPT_IN_VIEW, Status.RETURNED),
    (Status.CLOSED, Status.IN_PROGRESS),
    *((s, Status.PENDING_APPROVAL) for s in REASSIGNABLE),
}


class WorkflowError(RuleError):
    """The requested change breaks a workflow rule. The message says which one, in plain words."""

    status_code = 409


def _has_reason(reason: str) -> bool:
    return len((reason or "").strip()) >= MIN_REASON


@transaction.atomic
def transition(
    query: Query,
    to_status: str,
    actor,
    reason: str = "",
    *,
    direct: bool = False,
    action: str = "status.change",
    ip=None,
) -> Query:
    query = Query.objects.select_for_update().get(pk=query.pk)
    from_status = query.status
    role = actor.effective_role()
    if from_status == to_status:
        raise WorkflowError(f"The query is already {to_status}.")

    if direct:
        # A CIA correction outside the normal path: allowed, but it needs a reason and it is shown
        # on the CIA Activity view (design.md 5 and 11).
        if role != "CIA":
            raise WorkflowError("Only the CIA can change a status directly.")
        if not _has_reason(reason):
            raise WorkflowError(f"Give a reason of at least {MIN_REASON} characters for a direct change.")
        if to_status == Status.PROPOSED:
            raise WorkflowError("Only the assigned auditor can propose closure.")
        if Status.PENDING_APPROVAL in (from_status, to_status):
            raise WorkflowError(
                "Pending Approval belongs to a reassignment request. Decide the request instead."
            )
        action = "status.direct"
    if to_status not in (Status.IMPORTED, Status.CLOSED) and not query.current_assignee_id:
        raise WorkflowError("Assign an auditor first.")
    if not direct:
        allowed = TRANSITIONS.get((from_status, to_status))
        if allowed is None:
            raise WorkflowError(f"A query cannot move from {from_status} to {to_status}.")
        if role not in allowed:
            raise WorkflowError(f"Your role cannot move a query from {from_status} to {to_status}.")
        if (from_status, to_status) in REASON_REQUIRED and not _has_reason(reason):
            raise WorkflowError(f"Give a reason of at least {MIN_REASON} characters.")

    query.status = to_status
    query.closed_at = timezone.now() if to_status == Status.CLOSED else None
    query._workflow_change = True
    query.save(update_fields=["status", "closed_at", "updated_at"])
    query._workflow_change = False
    record(
        actor=actor,
        action=action,
        object_type="Query",
        object_id=query.pk,
        old={"status": from_status},
        new={"status": to_status},
        reason=reason,
        ip=ip,
    )
    return query


def evidence_of_resolution(query: Query) -> bool:
    """At least one management response or evidence file (design.md 5)."""
    return query.activities.filter(kind="ManagementResponse").exists() or query.evidence.exists()


@transaction.atomic
def propose_closure(*, query: Query, actor, reason: str, ip=None) -> StatusChangeRequest:
    query = Query.objects.select_for_update().get(pk=query.pk)
    if query.current_assignee_id != actor.pk:
        raise WorkflowError("Only the assigned auditor can propose closure.")
    if query.status != Status.IN_PROGRESS:
        raise WorkflowError("Only a query that is In Progress can be proposed for closure.")
    if StatusChangeRequest.objects.filter(query=query, decision=Decision.PENDING).exists():
        raise WorkflowError("A proposal for this query is already waiting for the CIA.")
    if not evidence_of_resolution(query):
        raise WorkflowError("Add at least one management response or evidence file before proposing closure.")
    request = StatusChangeRequest.objects.create(
        query=query,
        from_status=query.status,
        to_status=Status.PROPOSED,
        proposed_by=actor,
        proposed_reason=reason.strip(),
    )
    transition(query, Status.PROPOSED, actor, reason, action="status.propose", ip=ip)
    return request


# A closure proposal's possible outcomes and the audit action each one writes.
OUTCOMES = {
    Status.CLOSED: "status.approve",
    Status.RETURNED: "status.reject",
    Status.KEPT_IN_VIEW: "status.keep",
}


@transaction.atomic
def decide(
    *, request_id, actor, approve: bool = False, outcome: str | None = None, reason: str = "", ip=None
) -> StatusChangeRequest:
    """Decide a closure proposal. The CIA closes it; the CIA or the PIA may return it or keep it in view
    (owner, 2026-10-22). Who may reach which outcome is the transition table's call."""
    to = outcome or (Status.CLOSED if approve else Status.RETURNED)
    if to not in OUTCOMES:
        raise WorkflowError("A proposal can only be closed, returned or kept in view.")
    request = StatusChangeRequest.objects.select_for_update().select_related("query").get(pk=request_id)
    if request.decision != Decision.PENDING:
        raise WorkflowError(f"This proposal was already {request.decision.lower()}.")
    if request.proposed_by_id == actor.pk:
        # No self-approval, ever (system.md 4.3), including an IA who holds acting-CIA rights.
        raise WorkflowError("You proposed this, so someone else must decide it.")
    if to != Status.CLOSED and not _has_reason(reason):
        raise WorkflowError(f"Say what is still missing, in at least {MIN_REASON} characters.")
    query = transition(request.query, to, actor, reason, action=OUTCOMES[to], ip=ip)
    request.decision = Decision.APPROVED if to == Status.CLOSED else Decision.REJECTED
    request.decided_by = actor
    request.decision_reason = (reason or "").strip()
    request.decided_at = timezone.now()
    request.decided_status = to
    request.save(
        update_fields=[
            "decision",
            "decided_by",
            "decision_reason",
            "decided_at",
            "decided_status",
            "updated_at",
        ]
    )
    if to == Status.RETURNED:
        notify.about_query([query.current_assignee], query, "Returned to you", "The reason is on the query.")
    elif to == Status.KEPT_IN_VIEW:
        notify.about_query([query.current_assignee], query, "Kept in view", "The reason is on the query.")
    return request


@transaction.atomic
def change_directly(*, query: Query, actor, to_status: str, reason: str, ip=None) -> Query:
    if StatusChangeRequest.objects.filter(query=query, decision=Decision.PENDING).exists():
        raise WorkflowError("Decide the waiting closure proposal first.")
    if query.status == Status.PENDING_APPROVAL:
        raise WorkflowError("Decide the waiting reassignment request first.")
    return transition(query, to_status, actor, reason, direct=True, ip=ip)
