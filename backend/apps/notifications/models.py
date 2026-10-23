import uuid

from django.conf import settings
from django.db import models

from apps.organizations.models import OrgOwned


class Notification(OrgOwned):
    """An in-app message to one person: something they need to know or act on (owner, 2026-10-22).

    It names the query by reference and links to it; the details stay on the query, behind its
    own access checks. The recipient can only mark it read.
    """

    ORG_PARENT = "recipient"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    headline = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    query = models.ForeignKey(
        "queries.Query", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    # Where in the app it leads, e.g. /queries/<id> or /approvals.
    link = models.CharField(max_length=200, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "read_at"])]

    def __str__(self) -> str:
        return f"{self.recipient}: {self.headline}"
