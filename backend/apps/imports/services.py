"""Upload, preview, confirm and cancel (architecture.md 5.4). Every step writes its audit entry.

Everything stays inside the importer's organization: references are unique per organization, the source
file is kept under the organization's own folder, and criteria and reports are the organization's own
(auditlogs-additions_final.md 3.4, 7, 8 and 12).
"""

from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.auditlog.services import record
from apps.core.filestore import org_folder, read_encrypted, save_encrypted, sha256
from apps.queries.models import Query, Status
from apps.reports.models import AuditReport, Criterion

from .models import BatchStatus, ImportBatch, ImportRow
from .parsing import ImportFileError, parse_report_date, parse_rows, read_table, read_word, validate

ALLOWED_SUFFIXES = (".csv", ".xlsx", ".docx")
# Query fields copied from a row as they are. The originals of wording and risk are set separately.
RECORD_FIELDS = (
    "title",
    "management_response",
    "recommendation",
    "audit_observation",
    "policy_title",
    "policy_reference",
    "notable_numbers",
    "deadline",
    "responsible_officer",
    "department",
)


class ImportStateError(Exception):
    """The batch is not in a state where this step is allowed."""


def existing_references(organization_id) -> set[str]:
    return set(Query.objects.in_org(organization_id).values_list("reference", flat=True))


@transaction.atomic
def upload(
    *, actor, filename: str, content: bytes, report: AuditReport | None = None, ip=None
) -> ImportBatch:
    suffix = Path(filename).suffix.lower()
    if suffix in (".pdf", ".doc"):
        raise ImportFileError(
            "PDF and old Word (.doc) files cannot be imported. Save the report as a Word .docx file, "
            "or export the queries to Excel or CSV."
        )
    if suffix not in ALLOWED_SUFFIXES:
        raise ImportFileError("Upload the final queries as a Word (.docx), Excel (.xlsx) or CSV file.")
    if len(content) > settings.IMPORT_MAX_BYTES:
        raise ImportFileError(f"The file is larger than {settings.IMPORT_MAX_BYTES // (1024 * 1024)} MB.")
    org_id = actor.organization_id
    if report is not None and report.organization_id != org_id:
        raise ImportFileError("Choose one of your own organization's reports.")

    if suffix == ".docx":
        parsed, report_meta = read_word(content)
    else:
        parsed, report_meta = parse_rows(read_table(filename, content)), {}
    rows = validate(parsed, existing_references(org_id), timezone.localdate())
    digest = sha256(content)
    path = save_encrypted(content, org_folder(settings.IMPORT_DIR, org_id))
    errors = sum(1 for r in rows if r.errors)
    batch = ImportBatch.objects.create(
        organization_id=org_id,
        imported_by=actor,
        report=report,
        report_meta=report_meta,
        source_filename=Path(filename).name[:255],
        source_file_path=path,
        source_sha256=digest,
        row_count=len(rows),
        error_count=errors,
    )
    ImportRow.objects.bulk_create(
        ImportRow(
            organization_id=org_id,
            batch=batch,
            line=r.line,
            data=r.data,
            errors=r.errors,
            warnings=r.warnings,
        )
        for r in rows
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
            "report": str(report.pk) if report else None,
        },
        ip=ip,
    )
    return batch


def _locked(batch_id) -> ImportBatch:
    batch = ImportBatch.objects.select_for_update().get(pk=batch_id)
    if batch.status != BatchStatus.PREVIEWED:
        raise ImportStateError(f"This batch is already {batch.status.lower()}.")
    return batch


def _report_for(batch: ImportBatch, rows: list[ImportRow], actor, ip) -> AuditReport | None:
    """The batch's report: the one chosen at upload, or a new one from the Word report's header. A file
    that names criteria but no report gets a report named after the file, which the CIA can rename."""
    if batch.report is not None:
        return batch.report
    meta = batch.report_meta or {}
    if not meta.get("title") and not any(r.data.get("criterion") for r in rows):
        return None
    report = AuditReport.objects.create(
        organization_id=batch.organization_id,
        title=(meta.get("title") or f"Audit report: {batch.source_filename}")[:300],
        audit_period=(meta.get("audit_period") or "")[:100],
        report_date=parse_report_date(meta.get("report_date") or ""),
        prepared_by=(meta.get("prepared_by") or "")[:150],
        created_by=actor,
    )
    record(
        actor=actor,
        action="report.create",
        object_type="AuditReport",
        object_id=report.pk,
        new={"title": report.title, "audit_period": report.audit_period, "batch": str(batch.pk)},
        ip=ip,
    )
    return report


def _criteria_for(report: AuditReport | None, batch: ImportBatch, rows: list[ImportRow], actor, ip) -> dict:
    if report is None:
        return {}
    descriptions = {
        c["title"]: c.get("description", "") for c in (batch.report_meta or {}).get("criteria", [])
    }
    wanted = list(dict.fromkeys(r.data["criterion"] for r in rows if r.data.get("criterion")))
    found = {c.title: c for c in Criterion.objects.filter(report=report, title__in=wanted)}
    position = Criterion.objects.filter(report=report).count()
    for title in wanted:
        if title in found:
            continue
        position += 1
        found[title] = Criterion.objects.create(
            report=report, title=title, description=descriptions.get(title, ""), position=position
        )
        record(
            actor=actor,
            action="criterion.create",
            object_type="AuditReport",
            object_id=report.pk,
            new={"criterion": str(found[title].pk), "title": title},
            ip=ip,
        )
    return found


@transaction.atomic
def confirm(*, actor, batch_id, ip=None) -> ImportBatch:
    """Create every query in one transaction, or none (design.md 4)."""
    batch = _locked(batch_id)
    rows = list(batch.rows.all())
    if any(r.errors for r in rows):
        raise ImportStateError("Fix the rows with problems and upload the file again. Nothing was imported.")
    # Another batch may have been confirmed since this preview: check references again.
    clash = sorted({r.data["reference"] for r in rows} & existing_references(batch.organization_id))
    if clash:
        raise ImportStateError(f"These references were imported since the preview: {', '.join(clash)}.")

    report = _report_for(batch, rows, actor, ip)
    criteria = _criteria_for(report, batch, rows, actor, ip)
    queries = Query.objects.bulk_create(
        Query(
            organization_id=batch.organization_id,
            reference=r.data["reference"],
            batch=batch,
            criterion=criteria.get(r.data.get("criterion") or ""),
            description_original=r.data["description"],
            description_current=r.data["description"],
            risk_rating_original=r.data["risk_rating"],
            risk_rating_current=r.data["risk_rating"],
            status=Status.IMPORTED,
            **{f: r.data.get(f, "") for f in RECORD_FIELDS},
        )
        for r in rows
    )
    batch.status = BatchStatus.CONFIRMED
    batch.confirmed_at = timezone.now()
    batch.report = report
    batch.save(update_fields=["status", "confirmed_at", "report", "updated_at"])
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


def open_original(*, batch: ImportBatch, actor, ip=None) -> bytes:
    """The file exactly as it was uploaded: decrypted and checked against the SHA-256 taken on arrival,
    so a changed file is refused (auditlogs-additions_final.md 12). Every download is logged."""
    content = read_encrypted(batch.source_file_path, batch.source_sha256)
    record(
        actor=actor,
        action="import.download_original",
        object_type="ImportBatch",
        object_id=batch.pk,
        new={"filename": batch.source_filename, "sha256": batch.source_sha256},
        ip=ip,
    )
    return content
