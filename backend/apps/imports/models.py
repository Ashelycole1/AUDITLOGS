import uuid

from django.conf import settings
from django.db import models


class BatchStatus(models.TextChoices):
    PREVIEWED = "Previewed"
    CONFIRMED = "Confirmed"
    CANCELLED = "Cancelled"


class ImportBatch(models.Model):
    """One uploaded final-queries file (design.md 4). The source file is kept with its SHA-256."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    imported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    source_filename = models.CharField(max_length=255)
    source_file_path = models.CharField(max_length=500)
    source_sha256 = models.CharField(max_length=64)
    status = models.CharField(max_length=10, choices=BatchStatus.choices, default=BatchStatus.PREVIEWED)
    row_count = models.PositiveIntegerField(default=0)
    error_count = models.PositiveIntegerField(default=0)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.source_filename

    def delete(self, *args, **kwargs):
        raise PermissionError("Import batches are never deleted.")


class ImportRow(models.Model):
    """A parsed row held for preview until the batch is confirmed or cancelled (architecture.md 5.4)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(ImportBatch, on_delete=models.PROTECT, related_name="rows")
    line = models.PositiveIntegerField()
    data = models.JSONField()
    errors = models.JSONField(default=list)
    warnings = models.JSONField(default=list)

    class Meta:
        ordering = ["line"]
        constraints = [models.UniqueConstraint(fields=["batch", "line"], name="one_row_per_line")]

    def __str__(self) -> str:
        return f"{self.batch} line {self.line}"
