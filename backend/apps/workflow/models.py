import uuid

from django.conf import settings
from django.db import models

from apps.queries.models import QueryChildQuerySet, Status


class Decision(models.TextChoices):
    PENDING = "Pending"
    APPROVED = "Approved"
    REJECTED = "Rejected"


class StatusChangeRequest(models.Model):
    """An IA's proposal to close a query, decided by the CIA (design.md 1, steps 5 and 6)."""

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
