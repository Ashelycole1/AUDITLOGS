import uuid

from django.conf import settings
from django.db import models

from apps.core.permissions import is_fully_authenticated


class Status(models.TextChoices):
    IMPORTED = "Imported"
    ASSIGNED = "Assigned"
    IN_PROGRESS = "In Progress"
    PROPOSED = "Proposed for Closure"
    CLOSED = "Closed"
    RETURNED = "Returned"


class Risk(models.TextChoices):
    """Four tiers from the Standard Risk Matrix Color Mapping Reference (DECISIONS 31), most serious first."""

    CRITICAL = "Critical"
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class ImmutableFieldError(Exception):
    """Raised when code tries to change a value that must never change after import."""


class StatusChangeOutsideWorkflow(Exception):
    """Raised when a status is set anywhere but apps.workflow.services.transition (architecture.md 5.2)."""


# Set once at import and never changed again (system.md 4.2).
IMMUTABLE_FIELDS = ("reference", "batch_id", "description_original", "risk_rating_original")


class QueryQuerySet(models.QuerySet):
    def for_user(self, user) -> "QueryQuerySet":
        """The queries this person may see (design.md 2). Default deny for anyone else."""
        if not is_fully_authenticated(user):
            return self.none()
        role = user.effective_role()
        if role in ("CIA", "PIA", "CEO"):
            # PIA reads everything; CEO reaches only summary endpoints, which choose the fields.
            return self
        if role == "IA":
            return self.filter(current_assignee=user)
        # ICT has no rights over findings without an approved, logged, time-limited grant.
        return self.none()

    def update(self, **kwargs):
        if "status" in kwargs:
            raise StatusChangeOutsideWorkflow("Status changes go through the workflow service.")
        blocked = set(IMMUTABLE_FIELDS) | {"batch"}
        if blocked & set(kwargs):
            raise ImmutableFieldError("Original import values cannot be changed.")
        return super().update(**kwargs)

    def delete(self):
        raise PermissionError("Queries are never deleted. Disposal follows the retention rules.")


class Query(models.Model):
    """One final audit finding, followed until closed (system.md 2)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference = models.CharField(max_length=50, unique=True)
    batch = models.ForeignKey("imports.ImportBatch", on_delete=models.PROTECT, related_name="queries")
    title = models.CharField(max_length=300)
    description_original = models.TextField()
    description_current = models.TextField()
    risk_rating_original = models.CharField(max_length=8, choices=Risk.choices)
    risk_rating_current = models.CharField(max_length=8, choices=Risk.choices)
    # Changed only by the workflow service (architecture.md 5.2), never set directly by a view.
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.IMPORTED)
    deadline = models.DateField()
    responsible_officer = models.CharField(max_length=150)
    department = models.CharField(max_length=150)
    current_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = QueryQuerySet.as_manager()

    class Meta:
        ordering = ["deadline", "reference"]
        verbose_name_plural = "queries"
        indexes = [models.Index(fields=["status"]), models.Index(fields=["current_assignee", "status"])]

    def __str__(self) -> str:
        return self.reference

    def save(self, *args, **kwargs):
        if not self._state.adding:
            stored = type(self).objects.filter(pk=self.pk).values(*IMMUTABLE_FIELDS, "status").first()
            if stored and any(stored[f] != getattr(self, f) for f in IMMUTABLE_FIELDS):
                raise ImmutableFieldError("Original import values cannot be changed.")
            # The workflow service sets this flag for the one save that carries a status change.
            if stored and stored["status"] != self.status and not getattr(self, "_workflow_change", False):
                raise StatusChangeOutsideWorkflow("Status changes go through the workflow service.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError("Queries are never deleted. Disposal follows the retention rules.")


class QueryChildQuerySet(models.QuerySet):
    """For records that hang off a query: visible exactly when the query is (architecture.md 5.1)."""

    def for_user(self, user):
        return self.filter(query__in=Query.objects.for_user(user))


class QueryRevision(models.Model):
    """Every edit of a query field: old value, new value, editor and reason (system.md 4.2)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    query = models.ForeignKey(Query, on_delete=models.PROTECT, related_name="revisions")
    field = models.CharField(max_length=40)
    old_value = models.TextField()
    new_value = models.TextField()
    edited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    reason = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    objects = QueryChildQuerySet.as_manager()

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.query} {self.field}"


class Assignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    query = models.ForeignKey(Query, on_delete=models.PROTECT, related_name="assignments")
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    active = models.BooleanField(default=True)
    assigned_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["assigned_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["query"], condition=models.Q(active=True), name="one_active_assignment"
            )
        ]

    def __str__(self) -> str:
        return f"{self.query} to {self.assignee}"
