import uuid

from django.conf import settings
from django.db import models

from apps.queries.models import QueryChildQuerySet, Status


class Decision(models.TextChoices):
    PENDING = "Pending"
    APPROVED = "Approved"
    REJECTED = "Rejected"


class StatusChangeRequest(models.Model):
    """An auditor's proposal to close a query. The CIA closes or returns it; the PIA may return it or
    keep it in view (design.md 1, steps 5 and 6; owner, 2026-10-22)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    query = models.ForeignKey("queries.Query", on_delete=models.PROTECT, related_name="status_requests")
    from_status = models.CharField(max_length=24, choices=Status.choices)
    to_status = models.CharField(max_length=24, choices=Status.choices)
    proposed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    proposed_reason = models.TextField()
    decision = models.CharField(max_length=8, choices=Decision.choices, default=Decision.PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    decision_reason = models.TextField(blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    # Where the decision took the query: Closed, Returned or Kept in View (blank while pending).
    decided_status = models.CharField(max_length=24, choices=Status.choices, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = QueryChildQuerySet.as_manager()

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["query"], condition=models.Q(decision="Pending"), name="one_pending_request_per_query"
            )
        ]

    def __str__(self) -> str:
        return f"{self.query}: {self.from_status} to {self.to_status} ({self.decision})"


class ReassignmentRequest(models.Model):
    """A PIA's request to move a query to another auditor, approved by the CIA (owner, 2026-10-22).

    While it waits the query is Pending Approval and the current auditor keeps it. A rejection puts
    the query back in the status it had before.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    query = models.ForeignKey("queries.Query", on_delete=models.PROTECT, related_name="reassignment_requests")
    from_assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    to_assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    from_status = models.CharField(max_length=24, choices=Status.choices)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    reason = models.TextField()
    decision = models.CharField(max_length=8, choices=Decision.choices, default=Decision.PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    decision_reason = models.TextField(blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = QueryChildQuerySet.as_manager()

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["query"],
                condition=models.Q(decision="Pending"),
                name="one_pending_reassignment_per_query",
            )
        ]

    def __str__(self) -> str:
        return f"{self.query}: {self.from_assignee} to {self.to_assignee} ({self.decision})"


class ExportRequest(models.Model):
    """A PIA's request to export queries. Only after the CIA approves can the PIA download it
    (owner, 2026-10-22; system.md 4.9). `filters` are the query-list filters the export applies."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    filters = models.JSONField(default=dict, blank=True)
    reason = models.TextField()
    decision = models.CharField(max_length=8, choices=Decision.choices, default=Decision.PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    decision_reason = models.TextField(blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    downloads = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"Export by {self.requested_by} ({self.decision})"
