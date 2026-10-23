import uuid

from django.conf import settings
from django.db import models

from apps.core.permissions import is_fully_authenticated
from apps.organizations.models import CrossOrganizationError, OrgOwned, OrgQuerySet


class Status(models.TextChoices):
    IMPORTED = "Imported"
    ASSIGNED = "Assigned"
    IN_PROGRESS = "In Progress"
    PROPOSED = "Proposed for Closure"
    CLOSED = "Closed"
    RETURNED = "Returned"
    # Added at the owner's request (2026-10-22): a reassignment waiting for the CIA, and a query the
    # PIA keeps under watch instead of closing.
    PENDING_APPROVAL = "Pending Approval"
    KEPT_IN_VIEW = "Kept in View"


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


class QueryQuerySet(OrgQuerySet):
    def for_user(self, user) -> "QueryQuerySet":
        """The queries this person may see (design.md 2): never outside their own organization
        (auditlogs-additions_final.md 7). Default deny for anyone else."""
        if not is_fully_authenticated(user):
            return self.none()
        own = self.in_org(user.organization_id)
        role = user.effective_role()
        if role in ("CIA", "PIA", "CEO"):
            # PIA reads everything; the CEO reads everything without changing anything (section 9).
            return own
        if role in ("IA", "SIA"):
            return own.filter(current_assignee=user)
        # ICT has no rights over findings without an approved, logged, time-limited grant.
        return self.none()

    def update(self, **kwargs):
        if "status" in kwargs:
            raise StatusChangeOutsideWorkflow("Status changes go through the workflow service.")
        blocked = set(IMMUTABLE_FIELDS) | {"batch", "organization", "organization_id"}
        if blocked & set(kwargs):
            raise ImmutableFieldError("Original import values cannot be changed.")
        return super().update(**kwargs)

    def delete(self):
        raise PermissionError("Queries are never deleted. Disposal follows the retention rules.")


class Query(OrgOwned):
    """One final audit finding, followed until closed (system.md 2).

    The query record of auditlogs-additions_final.md 8.2, in its order: the query (title and
    description), management response, risk rating, recommendation, audit observation, policy
    reference (title, then the text or clause), action party and time (responsible officer and
    deadline), and notable numbers. Each query may sit under a criterion of an audit report (8.1).
    """

    ORG_PARENT = "batch"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Unique within the organization: two institutions may number their findings the same way.
    reference = models.CharField(max_length=50)
    batch = models.ForeignKey("imports.ImportBatch", on_delete=models.PROTECT, related_name="queries")
    criterion = models.ForeignKey(
        "reports.Criterion", null=True, blank=True, on_delete=models.PROTECT, related_name="queries"
    )
    title = models.CharField(max_length=300)
    description_original = models.TextField()
    description_current = models.TextField()
    management_response = models.TextField(blank=True, default="")
    risk_rating_original = models.CharField(max_length=8, choices=Risk.choices)
    risk_rating_current = models.CharField(max_length=8, choices=Risk.choices)
    recommendation = models.TextField(blank=True, default="")
    audit_observation = models.TextField(blank=True, default="")
    policy_title = models.CharField(max_length=300, blank=True, default="")
    policy_reference = models.TextField(blank=True, default="")
    notable_numbers = models.TextField(blank=True, default="")
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
        indexes = [
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["current_assignee", "status"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "reference"], name="one_reference_per_organization"
            )
        ]

    def __str__(self) -> str:
        return self.reference

    def save(self, *args, **kwargs):
        if self.criterion_id is not None and self.organization_id is not None:
            if self.criterion.organization_id != self.organization_id:
                raise CrossOrganizationError("A query's criterion must belong to the same organization.")
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


class QueryChildQuerySet(OrgQuerySet):
    """For records that hang off a query: visible exactly when the query is (architecture.md 5.1)."""

    def for_user(self, user):
        if not is_fully_authenticated(user):
            return self.none()
        return self.in_org(user.organization_id).filter(query__in=Query.objects.for_user(user))


class QueryRevision(OrgOwned):
    """Every edit of a query field: old value, new value, editor and reason (system.md 4.2)."""

    ORG_PARENT = "query"

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


class Assignment(OrgOwned):
    """Who a query was given to, by whom and when: the history behind the assignee's name (section 11)."""

    ORG_PARENT = "query"

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
