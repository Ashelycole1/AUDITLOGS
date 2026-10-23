"""Audit reports and their criteria (auditlogs-additions_final.md 8.1).

A report has a header (organization, title, audit period, date, prepared by) and one or more criteria:
the standard, policy, law or benchmark the audit is measured against. Queries are raised against a
criterion. Reports and criteria are corrected, never deleted, so the queries under them keep their place.
"""

import uuid

from django.conf import settings
from django.db import models

from apps.organizations.models import OrgOwned, OrgQuerySet


class AuditReport(OrgOwned):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=300)
    audit_period = models.CharField(max_length=100, blank=True)
    report_date = models.DateField(null=True, blank=True)
    prepared_by = models.CharField(max_length=150, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = OrgQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title

    def delete(self, *args, **kwargs):
        raise PermissionError("Audit reports are never deleted.")


class Criterion(OrgOwned):
    ORG_PARENT = "report"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(AuditReport, on_delete=models.PROTECT, related_name="criteria")
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = OrgQuerySet.as_manager()

    class Meta:
        ordering = ["position", "created_at"]
        verbose_name_plural = "criteria"
        constraints = [
            models.UniqueConstraint(fields=["report", "title"], name="one_criterion_title_per_report")
        ]

    def __str__(self) -> str:
        return self.title

    def delete(self, *args, **kwargs):
        raise PermissionError("Criteria are never deleted.")
