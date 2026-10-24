"""Organizations: the institutions that use AuditLogs, each walled off from the others
(auditlogs-additions_final.md 3.2 and 7).

Every record that holds an organization's data carries `organization` (OrgOwned). Records that hang off
another record take the organization from it (ORG_PARENT) and may never point across organizations.
"""

import uuid

from django.conf import settings
from django.db import models


class OrgStatus(models.TextChoices):
    PENDING = "Pending"
    ACTIVE = "Active"
    SUSPENDED = "Suspended"
    DEACTIVATED = "Deactivated"
    REJECTED = "Rejected"


class CrossOrganizationError(Exception):
    """Raised when a record would point at a record of another organization."""


class Organization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    country = models.CharField(max_length=100)
    contact_person = models.CharField(max_length=150)
    email = models.EmailField()
    phone = models.CharField(max_length=40, blank=True)
    # Shown to the organization's own people with its name (owner, 2026-10-25). Set by the System
    # Administrator. The logo is kept in the database as a re-encoded PNG, never as the uploaded file.
    address = models.TextField(blank=True, default="")
    website = models.URLField(max_length=200, blank=True, default="")
    logo = models.BinaryField(null=True, blank=True, editable=False)
    logo_sha256 = models.CharField(max_length=64, blank=True, default="")
    logo_updated_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=OrgStatus.choices, default=OrgStatus.PENDING)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["status"])]

    def __str__(self) -> str:
        return self.name

    @property
    def is_active(self) -> bool:
        return self.status == OrgStatus.ACTIVE

    def delete(self, *args, **kwargs):
        # An organization's records stay with it; it is deactivated instead (section 4).
        raise PermissionError("Organizations are deactivated, never deleted.")


class OrganizationFeature(models.Model):
    """One switch of an organization's package, set by the System Administrator (section 5)."""

    id = models.BigAutoField(primary_key=True)
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, related_name="features")
    feature_key = models.CharField(max_length=40)
    enabled = models.BooleanField(default=False)
    config = models.JSONField(default=dict, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["feature_key"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "feature_key"], name="one_row_per_feature")
        ]

    def __str__(self) -> str:
        return f"{self.organization}: {self.feature_key}={'on' if self.enabled else 'off'}"


class OrgQuerySet(models.QuerySet):
    def in_org(self, organization):
        """The data-access rule of section 3.3: rows of this one organization, or nothing."""
        org_id = getattr(organization, "pk", organization)
        if org_id is None:
            return self.none()
        return self.filter(organization_id=org_id)


class OrgOwned(models.Model):
    """Base for every model that holds an organization's data.

    ORG_PARENT names a foreign key whose organization this record shares. On save the organization is
    taken from it when unset, and a mismatch is refused, so a record can never link two organizations.
    """

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, related_name="+")

    ORG_PARENT: str | None = None

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self.ORG_PARENT:
            parent = getattr(self, self.ORG_PARENT)
            if parent is not None:
                if self.organization_id is None:
                    self.organization_id = parent.organization_id
                elif parent.organization_id != self.organization_id:
                    raise CrossOrganizationError("A record cannot link two organizations.")
        super().save(*args, **kwargs)
