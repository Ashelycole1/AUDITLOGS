"""Compliance records (design.md 3 and 12): retention rules and disposals, the breach register, and
break-glass access for ICT. Each belongs to one organization and changes only through services.py,
which writes the audit entry in the same transaction.
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.organizations.models import OrgOwned, OrgQuerySet


class RecordType(models.TextChoices):
    # A closed query with its follow-up, evidence, comments, revisions and requests.
    CLOSED_QUERY = "closed_query", "Closed queries"
    # The uploaded file of a confirmed or cancelled import, and its preview rows.
    IMPORT_FILE = "import_file", "Import source files"


class RetentionRule(OrgOwned):
    """How long one record type is kept before it is due for disposal. Set by the CIA; there are no
    defaults, because the periods are an open question (system.md 9)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    record_type = models.CharField(max_length=20, choices=RecordType.choices)
    retention_months = models.PositiveIntegerField()
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    approved_at = models.DateTimeField(default=timezone.now)
    reason = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = OrgQuerySet.as_manager()

    class Meta:
        ordering = ["record_type"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "record_type"], name="one_rule_per_record_type")
        ]

    def __str__(self) -> str:
        return f"{self.get_record_type_display()}: {self.retention_months} months"

    def delete(self, *args, **kwargs):
        raise PermissionError("Retention rules are changed, never deleted.")


class DisposalStatus(models.TextChoices):
    PENDING = "Pending"
    DISPOSED = "Disposed"
    REJECTED = "Rejected"


class DisposalRecord(OrgOwned):
    """One record found past its retention period by check_retention, and the CIA's decision on it.

    Disposal erases the content and keeps a stub (owner, 2026-10-24): the reference, dates and this
    record stay, so totals and the audit trail still add up. The audit log keeps its entries.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    record_type = models.CharField(max_length=20, choices=RecordType.choices)
    object_id = models.UUIDField()
    # What a person recognises it by: a query reference or an import file name.
    label = models.CharField(max_length=255)
    # The date the retention period ran from (closure, or confirmation of the import).
    since = models.DateTimeField()
    retention_months = models.PositiveIntegerField()
    status = models.CharField(max_length=10, choices=DisposalStatus.choices, default=DisposalStatus.PENDING)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    reason = models.TextField(blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    disposed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = OrgQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["object_id"], condition=models.Q(status="Pending"), name="one_pending_disposal"
            )
        ]

    def __str__(self) -> str:
        return f"{self.label} ({self.status})"

    def delete(self, *args, **kwargs):
        raise PermissionError("Disposal records are never deleted.")


class BreachKind(models.TextChoices):
    MANUAL = "manual", "Recorded by hand"
    CHAIN = "chain", "Audit chain verification failed"
    LOCKOUT = "lockout", "Account locked after failed sign-ins"
    DOWNLOADS = "downloads", "Unusual download volume"


class BreachRecord(OrgOwned):
    """An entry in the breach register (design.md 3 and 12). The CIA and ICT keep it (owner, 2026-10-24).

    Alerts create drafts automatically. A draft becomes a confirmed entry when someone reviews it;
    an entry is closed, never deleted.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=10, choices=BreachKind.choices, default=BreachKind.MANUAL)
    is_draft = models.BooleanField(default=False)
    detected_at = models.DateTimeField(default=timezone.now)
    description = models.TextField()
    data_affected = models.TextField(blank=True)
    people_affected = models.TextField(blank=True)
    actions_taken = models.TextField(blank=True)
    pdpo_notified_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    # The person an automatic alert is about (the locked account, the heavy downloader), if any.
    subject_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    # Blank for automatic drafts.
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = OrgQuerySet.as_manager()

    class Meta:
        ordering = ["-detected_at"]

    def __str__(self) -> str:
        return f"{self.get_kind_display()} {self.detected_at:%Y-%m-%d}"

    def delete(self, *args, **kwargs):
        raise PermissionError("Breach register entries are closed, never deleted.")


class GrantStatus(models.TextChoices):
    PENDING = "Pending"
    APPROVED = "Approved"
    REJECTED = "Rejected"
    ENDED = "Ended"


class AccessGrantQuerySet(OrgQuerySet):
    def active(self):
        return self.filter(status=GrantStatus.APPROVED, expires_at__gt=timezone.now())


class AccessGrant(OrgOwned):
    """Break-glass: ICT asks to read audit content, with a reason; the CIA approves; access ends by
    itself after the approved hours (design.md 12). While it lasts ICT reads the organization's
    queries, history and evidence and changes nothing; every read is logged (owner, 2026-10-24)."""

    ORG_PARENT = "requested_by"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    reason = models.TextField()
    hours = models.PositiveSmallIntegerField(default=2)
    status = models.CharField(max_length=10, choices=GrantStatus.choices, default=GrantStatus.PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    decision_reason = models.TextField(blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = AccessGrantQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["requested_by"],
                condition=models.Q(status__in=["Pending", "Approved"]),
                name="one_open_grant_per_person",
            )
        ]

    def __str__(self) -> str:
        return f"{self.requested_by} ({self.status})"

    @property
    def is_active(self) -> bool:
        return (
            self.status == GrantStatus.APPROVED
            and self.expires_at is not None
            and self.expires_at > timezone.now()
        )

    def delete(self, *args, **kwargs):
        raise PermissionError("Access grants are never deleted.")


def has_active_grant(user) -> bool:
    """Whether this ICT person holds an approved, unexpired break-glass grant, checked at the moment of
    asking, so access ends on time even before expire_grants records it."""
    return (
        user.organization_id is not None
        and AccessGrant.objects.in_org(user.organization_id).active().filter(requested_by=user).exists()
    )
