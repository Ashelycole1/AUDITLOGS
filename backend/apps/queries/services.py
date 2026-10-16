"""CIA changes to queries: field edits with revisions, and assignment (design.md 6 and 7)."""

from datetime import date

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.auditlog.services import record
from apps.workflow.services import WorkflowError, transition

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


@transaction.atomic
def assign(*, query: Query, actor: User, assignee: User, reason: str = "", ip=None) -> Query:
    """Assign or reassign. The new IA sees the full history; the old IA loses access at once (design.md 7)."""
    query = Query.objects.select_for_update().get(pk=query.pk)
    if not assignee.is_active or assignee.role != Role.IA:
        raise WorkflowError("Choose an active Internal Auditor.")
    if query.status == Status.CLOSED:
        raise WorkflowError("This query is closed. Reopen it before changing the auditor.")
    previous = query.current_assignee
    if previous and previous.pk == assignee.pk:
        raise WorkflowError(f"{assignee.full_name} is already the auditor.")
    if previous and len(reason.strip()) < 10:
        raise WorkflowError("Give a reason of at least 10 characters for reassigning.")

    now = timezone.now()
    Assignment.objects.filter(query=query, active=True).update(active=False, ended_at=now)
    Assignment.objects.create(query=query, assignee=assignee, assigned_by=actor)
    query.current_assignee = assignee
    query.save(update_fields=["current_assignee", "updated_at"])
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
    return query


@transaction.atomic
def bulk_assign(
    *, queries: list[Query], actor: User, assignee: User, reason: str = "", ip=None
) -> list[Query]:
    """All or nothing: one failure leaves every query as it was."""
    return [assign(query=q, actor=actor, assignee=assignee, reason=reason, ip=ip) for q in queries]
