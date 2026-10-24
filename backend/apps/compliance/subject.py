"""Data subject requests (design.md 12): find everything held about one person or query, and export
it. CIA only, within the CIA's own organization. Every search and export is logged with its term.
"""

from django.db.models import Q

from apps.accounts.models import Role, User
from apps.auditlog.models import AuditLog
from apps.auditlog.services import record
from apps.core.exceptions import RuleError
from apps.core.validators import MIN_REASON
from apps.queries.models import Query
from apps.queries.workbook import export_workbook

from . import breaches

MIN_TERM = 3
TEXT_FIELDS = (
    "reference",
    "title",
    "description_original",
    "description_current",
    "management_response",
    "recommendation",
    "audit_observation",
    "responsible_officer",
    "department",
    "notable_numbers",
)


class SubjectError(RuleError):
    status_code = 400


def _term(term: str) -> str:
    term = (term or "").strip()
    if len(term) < MIN_TERM:
        raise SubjectError(f"Search for at least {MIN_TERM} characters: a name, email or query reference.")
    return term[:150]


def _check(actor: User) -> None:
    if actor.effective_role() != Role.CIA:
        raise SubjectError("Only the CIA handles data subject requests.")


def matching_queries(actor: User, term: str):
    text = Q()
    for field in TEXT_FIELDS:
        text |= Q(**{f"{field}__icontains": term})
    text |= Q(activities__body__icontains=term) | Q(comments__body__icontains=term)
    return (
        Query.objects.for_user(actor)
        .filter(text)
        .distinct()
        .select_related("current_assignee", "criterion")
        .order_by("reference")
    )


def matching_people(actor: User, term: str):
    return User.objects.filter(organization_id=actor.organization_id).filter(
        Q(full_name__icontains=term) | Q(email__icontains=term)
    )


def search(*, actor: User, term: str, ip=None) -> dict:
    _check(actor)
    term = _term(term)
    queries = list(matching_queries(actor, term)[:200])
    people = list(matching_people(actor, term)[:50])
    log_counts = {
        str(p.pk): AuditLog.objects.filter(organization_id=actor.organization_id, actor=p).count()
        for p in people
    }
    record(
        actor=actor,
        action="subject.search",
        object_type="Query",
        object_id="search",
        new={"term": term, "queries": len(queries), "people": len(people)},
        ip=ip,
    )
    return {"term": term, "queries": queries, "people": people, "log_counts": log_counts}


def export(*, actor: User, term: str, reason: str, ip=None) -> tuple[bytes, int]:
    _check(actor)
    term = _term(term)
    if len((reason or "").strip()) < MIN_REASON:
        raise SubjectError(f"Say which request this answers, in at least {MIN_REASON} characters.")
    queries = list(matching_queries(actor, term))
    record(
        actor=actor,
        action="subject.export",
        object_type="Query",
        object_id="search",
        new={"term": term, "rows": len(queries)},
        reason=reason.strip(),
        ip=ip,
    )
    breaches.after_download(actor)
    return export_workbook(queries, actor=actor, filters={"q": term}), len(queries)
