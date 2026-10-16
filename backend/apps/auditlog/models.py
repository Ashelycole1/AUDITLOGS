import uuid

from django.conf import settings
from django.db import models


class AppendOnlyError(Exception):
    """Raised by any application code path that tries to change or remove a log entry."""


class AuditLogQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise AppendOnlyError("The audit log is append-only.")

    def delete(self):
        raise AppendOnlyError("The audit log is append-only.")


class AuditLog(models.Model):
    """One entry in the tamper-evident log (design.md 10).

    Entries are only ever inserted, by apps.auditlog.services.record. The database refuses UPDATE,
    DELETE and TRUNCATE on this table (migration 0002), and the model refuses them too.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    seq = models.BigIntegerField(unique=True)
    timestamp = models.DateTimeField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT, related_name="+")
    actor_role = models.CharField(max_length=8, blank=True)
    action = models.CharField(max_length=64, db_index=True)
    object_type = models.CharField(max_length=64)
    object_id = models.CharField(max_length=64)
    old_value = models.JSONField(null=True)
    new_value = models.JSONField(null=True)
    reason = models.TextField(blank=True)
    ip_address = models.GenericIPAddressField(null=True)
    prev_hash = models.CharField(max_length=64)
    entry_hash = models.CharField(max_length=64, unique=True)

    objects = AuditLogQuerySet.as_manager()

    class Meta:
        ordering = ["seq"]
        indexes = [models.Index(fields=["object_type", "object_id"]), models.Index(fields=["timestamp"])]

    def __str__(self) -> str:
        return f"#{self.seq} {self.action}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise AppendOnlyError("The audit log is append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AppendOnlyError("The audit log is append-only.")
