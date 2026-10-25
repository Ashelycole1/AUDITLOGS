"""Counts behind the query status pie chart (auditlogs-additions_final.md 10).

"Worked on" means the auditor has started: the query has moved past Assigned (In Progress, proposed,
returned, kept in view or closed). A query waiting for a reassignment counts by the status it had before.
"Allocated" means it has an auditor. The three slices of the pie add up to the total:
worked on, allocated but not yet worked on, and not allocated.
"""

from django.db.models import Count, Exists, OuterRef, Q

from .models import Status

WORKED_STATUSES = (
    Status.IN_PROGRESS,
    Status.PROPOSED,
    Status.RETURNED,
    Status.KEPT_IN_VIEW,
    Status.CLOSED,
)


def worked_on_q() -> Q:
    from apps.workflow.models import Decision, ReassignmentRequest

    waiting_from_worked = Exists(
        ReassignmentRequest.objects.filter(
            query=OuterRef("pk"), decision=Decision.PENDING, from_status__in=WORKED_STATUSES
        )
    )
    return Q(status__in=WORKED_STATUSES) | (Q(status=Status.PENDING_APPROVAL) & waiting_from_worked)


def breakdown(queries) -> dict:
    """`queries` is a queryset already narrowed to one organization."""
    counts = queries.aggregate(
        total=Count("pk"),
        worked_on=Count("pk", filter=worked_on_q()),
        allocated=Count("pk", filter=Q(current_assignee__isnull=False)),
        allocated_not_worked=Count("pk", filter=Q(current_assignee__isnull=False) & ~worked_on_q()),
        unallocated_not_worked=Count("pk", filter=Q(current_assignee__isnull=True) & ~worked_on_q()),
    )
    total = counts["total"]

    def share(n: int) -> float:
        return round(100 * n / total, 1) if total else 0.0

    slices = [
        ("worked_on", "Worked on", counts["worked_on"], "The auditor has started: past Assigned."),
        (
            "allocated_not_worked",
            "Allocated, not yet worked on",
            counts["allocated_not_worked"],
            "Has an auditor who has not started yet.",
        ),
        (
            "unallocated",
            "Not allocated",
            counts["unallocated_not_worked"],
            "Imported but not yet given to an auditor.",
        ),
    ]
    not_worked = total - counts["worked_on"]
    return {
        "total": total,
        "worked_on": counts["worked_on"],
        "not_worked_on": not_worked,
        "allocated": counts["allocated"],
        "unallocated": total - counts["allocated"],
        "percent": {
            "worked_on": share(counts["worked_on"]),
            "not_worked_on": share(not_worked),
            "allocated": share(counts["allocated"]),
            "unallocated": share(total - counts["allocated"]),
        },
        "slices": [
            {"key": key, "label": label, "count": n, "percent": share(n), "meaning": meaning}
            for key, label, n, meaning in slices
        ],
    }


def by_assignee(queries) -> list[dict]:
    """How many queries each person holds, for the allocation pie (owner, 2026-10-25). Counts and names
    only: no reference, title or any other detail of the queries themselves, which stay private."""
    rows = (
        queries.filter(current_assignee__isnull=False)
        .values("current_assignee", "current_assignee__full_name", "current_assignee__role")
        .annotate(count=Count("pk"), worked_on=Count("pk", filter=worked_on_q()))
        .order_by("-count", "current_assignee__full_name")
    )
    return [
        {
            "id": str(r["current_assignee"]),
            "full_name": r["current_assignee__full_name"],
            "role": r["current_assignee__role"],
            "count": r["count"],
            "worked_on": r["worked_on"],
        }
        for r in rows
    ]


def by_field(queries, field: str) -> dict[str, int]:
    return {row[field]: row["n"] for row in queries.values(field).annotate(n=Count("pk")).order_by(field)}
