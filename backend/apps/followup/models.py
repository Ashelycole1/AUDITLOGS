import uuid

from django.conf import settings
from django.db import models

from apps.queries.models import QueryChildQuerySet


class AppendOnlyQuerySet(QueryChildQuerySet):
    def update(self, **kwargs):
        raise PermissionError("Saved follow-up cannot be edited.")

    def delete(self):
        raise PermissionError("Saved follow-up cannot be deleted.")


class FollowUpActivity(models.Model):
    """A note or management response on a query. Saved entries are never edited (design.md 6)."""

    class Kind(models.TextChoices):
        NOTE = "Note"
        MANAGEMENT_RESPONSE = "ManagementResponse"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    query = models.ForeignKey("queries.Query", on_delete=models.PROTECT, related_name="activities")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        ordering = ["created_at"]
        verbose_name_plural = "follow-up activities"

    def __str__(self) -> str:
        return f"{self.query} {self.kind}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise PermissionError("Saved follow-up cannot be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError("Saved follow-up cannot be deleted.")


class Evidence(models.Model):
    """A file supporting the follow-up, stored encrypted under a random name (architecture.md 5.5)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    query = models.ForeignKey("queries.Query", on_delete=models.PROTECT, related_name="evidence")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    original_filename = models.CharField(max_length=255)
    stored_path = models.CharField(max_length=500)
    sha256 = models.CharField(max_length=64)
    size_bytes = models.PositiveBigIntegerField()
    content_type = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        ordering = ["created_at"]
        verbose_name_plural = "evidence"

    def __str__(self) -> str:
        return self.original_filename

    def delete(self, *args, **kwargs):
        raise PermissionError("Evidence is never deleted. Disposal follows the retention rules.")
