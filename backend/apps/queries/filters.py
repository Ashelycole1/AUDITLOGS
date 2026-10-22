"""The query-list filters, shared by the list endpoint and by exports so both select the same rows."""

import csv
import io

from django.db.models import Q
from django.utils import timezone

from .models import Status

FILTER_KEYS = ("status", "risk", "department", "assignee", "overdue", "q")


def apply_filters(qs, params):
    if params.get("status"):
        qs = qs.filter(status=params["status"])
    if params.get("risk"):
        qs = qs.filter(risk_rating_current=params["risk"])
    if params.get("department"):
        qs = qs.filter(department=params["department"])
    if params.get("assignee") == "none":
        qs = qs.filter(current_assignee__isnull=True)
    elif params.get("assignee"):
        qs = qs.filter(current_assignee_id=params["assignee"])
    if str(params.get("overdue", "")).lower() in ("1", "true"):
        qs = qs.filter(deadline__lt=timezone.localdate()).exclude(status=Status.CLOSED)
    if params.get("q"):
        term = str(params["q"]).strip()
        qs = qs.filter(
            Q(reference__icontains=term) | Q(title__icontains=term) | Q(description_current__icontains=term)
        )
    return qs


EXPORT_COLUMNS = [
    "reference",
    "title",
    "risk",
    "status",
    "department",
    "responsible_officer",
    "deadline",
    "assignee",
]


def _cell(value) -> str:
    text = "" if value is None else str(value)
    # A leading =, +, - or @ would run as a formula when the file is opened in a spreadsheet.
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


def export_csv(queries) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(EXPORT_COLUMNS)
    for q in queries:
        writer.writerow(
            _cell(v)
            for v in (
                q.reference,
                q.title,
                q.risk_rating_current,
                q.status,
                q.department,
                q.responsible_officer,
                q.deadline.isoformat(),
                q.current_assignee.full_name if q.current_assignee_id else "",
            )
        )
    # With a byte-order mark so Excel reads the names correctly.
    return ("﻿" + out.getvalue()).encode("utf-8")
