"""Upload, preview, confirm and cancel (architecture.md 5.4). Every step writes its audit entry."""

from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.auditlog.services import record
from apps.core.filestore import save_encrypted, sha256
from apps.queries.models import Query, Status

from .models import BatchStatus, ImportBatch, ImportRow
from .parsing import ImportFileError, parse_rows, read_table, validate

ALLOWED_SUFFIXES = (".csv", ".xlsx")


class ImportStateError(Exception):
    """The batch is not in a state where this step is allowed."""


def existing_references() -> set[str]:
    return set(Query.objects.values_list("reference", flat=True))


@transaction.atomic
def upload(*, actor, filename: str, content: bytes, ip=None) -> ImportBatch:
    suffix = Path(filename).suffix.lower()
    if suffix in (".pdf", ".doc", ".docx"):
        raise ImportFileError(
            "PDF and Word imports are not available yet. Export the queries to Excel or CSV."
        )
    if suffix not in ALLOWED_SUFFIXES:
        raise ImportFileError("Upload the final queries as an Excel (.xlsx) or CSV file.")
    if len(content) > settings.IMPORT_MAX_BYTES:
        raise ImportFileError(f"The file is larger than {settings.IMPORT_MAX_BYTES // (1024 * 1024)} MB.")

    rows = validate(parse_rows(read_table(filename, content)), existing_references(), timezone.localdate())
    digest = sha256(content)
    path = save_encrypted(content, settings.IMPORT_DIR)
    errors = sum(1 for r in rows if r.errors)
    batch = ImportBatch.objects.create(
        imported_by=actor,
        source_filename=Path(filename).name[:255],
        source_file_path=path,
        source_sha256=digest,
        row_count=len(rows),
        error_count=errors,
    )
    ImportRow.objects.bulk_create(
        ImportRow(batch=batch, line=r.line, data=r.data, errors=r.errors, warnings=r.warnings) for r in rows
    )
    record(
        actor=actor,
        action="import.upload",
        object_type="ImportBatch",
        object_id=batch.pk,
        new={
            "filename": batch.source_filename,
            "sha256": digest,
            "rows": len(rows),
            "rows_with_errors": errors,
        },
        ip=ip,
    )
    return batch


def _locked(batch_id) -> ImportBatch:
    batch = ImportBatch.objects.select_for_update().get(pk=batch_id)
    if batch.status != BatchStatus.PREVIEWED:
        raise ImportStateError(f"This batch is already {batch.status.lower()}.")
    return batch


@transaction.atomic
def confirm(*, actor, batch_id, ip=None) -> ImportBatch:
    """Create every query in one transaction, or none (design.md 4)."""
    batch = _locked(batch_id)
    rows = list(batch.rows.all())
    if any(r.errors for r in rows):
        raise ImportStateError("Fix the rows with problems and upload the file again. Nothing was imported.")
    # Another batch may have been confirmed since this preview: check references again.
    clash = sorted({r.data["reference"] for r in rows} & existing_references())
    if clash:
        raise ImportStateError(f"These references were imported since the preview: {', '.join(clash)}.")

    queries = Query.objects.bulk_create(
        Query(
            reference=r.data["reference"],
            batch=batch,
            title=r.data["title"],
            description_original=r.data["description"],
            description_current=r.data["description"],
            risk_rating_original=r.data["risk_rating"],
            risk_rating_current=r.data["risk_rating"],
            status=Status.IMPORTED,
            deadline=r.data["deadline"],
            responsible_officer=r.data["responsible_officer"],
            department=r.data["department"],
        )
        for r in rows
    )
    batch.status = BatchStatus.CONFIRMED
    batch.confirmed_at = timezone.now()
    batch.save(update_fields=["status", "confirmed_at", "updated_at"])
    record(
        actor=actor,
        action="import.confirm",
        object_type="ImportBatch",
        object_id=batch.pk,
        old={"status": BatchStatus.PREVIEWED},
        new={"status": BatchStatus.CONFIRMED, "queries": len(queries)},
        ip=ip,
    )
    for q in queries:
        record(
            actor=actor,
            action="query.create",
            object_type="Query",
            object_id=q.pk,
            new={"reference": q.reference, "batch": str(batch.pk), "status": Status.IMPORTED},
            ip=ip,
        )
    return batch


@transaction.atomic
def cancel(*, actor, batch_id, reason: str = "", ip=None) -> ImportBatch:
    batch = _locked(batch_id)
    batch.status = BatchStatus.CANCELLED
    batch.save(update_fields=["status", "updated_at"])
    record(
        actor=actor,
        action="import.cancel",
        object_type="ImportBatch",
        object_id=batch.pk,
        old={"status": BatchStatus.PREVIEWED},
        new={"status": BatchStatus.CANCELLED},
        reason=reason,
        ip=ip,
    )
    return batch
