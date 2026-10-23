"""The query-list filters, shared by the list endpoint and by exports so both select the same rows."""

import uuid

from django.db.models import Q
from django.utils import timezone

from .models import Status

FILTER_KEYS = ("status", "risk", "department", "assignee", "overdue", "q", "report", "criterion", "worked")


def _is_id(value) -> bool:
    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


def apply_filters(qs, params):
    from .stats import worked_on_q

    if params.get("status"):
        qs = qs.filter(status=params["status"])
    if params.get("risk"):
        qs = qs.filter(risk_rating_current=params["risk"])
    if params.get("department"):
        qs = qs.filter(department=params["department"])
    if params.get("assignee") == "none":
        qs = qs.filter(current_assignee__isnull=True)
    elif params.get("assignee") == "any":
        qs = qs.filter(current_assignee__isnull=False)
    elif params.get("assignee"):
        qs = qs.filter(current_assignee_id=params["assignee"]) if _is_id(params["assignee"]) else qs.none()
    if str(params.get("overdue", "")).lower() in ("1", "true"):
        qs = qs.filter(deadline__lt=timezone.localdate()).exclude(status=Status.CLOSED)
    # The pie chart's slices (auditlogs-additions_final.md 10): worked=yes or worked=no.
    worked = str(params.get("worked", "")).lower()
    if worked in ("yes", "true", "1"):
        qs = qs.filter(worked_on_q())
    elif worked in ("no", "false", "0"):
        qs = qs.exclude(worked_on_q())
    for key, lookup in (("report", "criterion__report_id"), ("criterion", "criterion_id")):
        if params.get(key):
            qs = qs.filter(**{lookup: params[key]}) if _is_id(params[key]) else qs.none()
    if params.get("q"):
        term = str(params["q"]).strip()
        qs = qs.filter(
            Q(reference__icontains=term) | Q(title__icontains=term) | Q(description_current__icontains=term)
        )
    return qs
