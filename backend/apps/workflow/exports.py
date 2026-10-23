"""Query exports (system.md 4.9). The CIA exports directly; a PIA asks, and downloads only after the
CIA approves (owner, 2026-10-22). Every request, decision and download is in the audit log.

Two formats: the Excel register (DECISIONS 34) and the PDF report of auditlogs-additions_final.md 8.1
and 13. A PDF export filtered to one audit report carries that report's header and criteria."""

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.auditlog.services import record
from apps.core.validators import MIN_REASON
from apps.notifications import services as notify
from apps.queries.filters import FILTER_KEYS, apply_filters
from apps.queries.models import Query
from apps.queries.pdf import render_pdf
from apps.queries.workbook import export_workbook
from apps.reports.models import AuditReport

from .models import Decision, ExportFormat, ExportRequest
from .services import WorkflowError


def _rows(user: User, filters: dict):
    return apply_filters(
        Query.objects.for_user(user).select_related("current_assignee", "criterion"), filters
    ).order_by("criterion__position", "reference")


def _report(user: User, filters: dict) -> AuditReport | None:
    from apps.queries.filters import _is_id

    report_id = filters.get("report")
    if not report_id or not _is_id(report_id):
        return None
    return AuditReport.objects.in_org(user.organization_id).filter(pk=report_id).first()


def render(queries, *, actor: User, filters: dict, fmt: str, request=None) -> bytes:
    if fmt == ExportFormat.PDF:
        return render_pdf(
            queries, actor=actor, filters=filters, report=_report(actor, filters), request=request
        )
    return export_workbook(queries, actor=actor, filters=filters, request=request)


def clean_format(fmt) -> str:
    fmt = str(fmt or ExportFormat.XLSX).lower()
    if fmt not in ExportFormat.values:
        raise WorkflowError("Choose Excel (xlsx) or PDF.")
    return fmt


def clean_filters(filters: dict) -> dict:
    return {k: str(v) for k, v in (filters or {}).items() if k in FILTER_KEYS and v not in (None, "")}


def export_now(*, actor: User, filters: dict, fmt: str = ExportFormat.XLSX, ip=None) -> tuple[bytes, int]:
    if actor.effective_role() != Role.CIA:
        raise WorkflowError("Only the CIA can export without approval.")
    fmt = clean_format(fmt)
    filters = clean_filters(filters)
    queries = list(_rows(actor, filters))
    record(
        actor=actor,
        action="export.queries",
        object_type="Query",
        object_id="list",
        new={"rows": len(queries), "filters": filters, "format": fmt},
        ip=ip,
    )
    return render(queries, actor=actor, filters=filters, fmt=fmt), len(queries)


@transaction.atomic
def request_export(
    *, actor: User, filters: dict, reason: str, fmt: str = ExportFormat.XLSX, ip=None
) -> ExportRequest:
    if len((reason or "").strip()) < MIN_REASON:
        raise WorkflowError(f"Say why you need the export, in at least {MIN_REASON} characters.")
    if ExportRequest.objects.filter(requested_by=actor, decision=Decision.PENDING).exists():
        raise WorkflowError("You already have an export waiting for the CIA.")
    item = ExportRequest.objects.create(
        requested_by=actor, filters=clean_filters(filters), reason=reason.strip(), format=clean_format(fmt)
    )
    record(
        actor=actor,
        action="export.request",
        object_type="ExportRequest",
        object_id=item.pk,
        new={"filters": item.filters, "format": item.format},
        reason=item.reason,
        ip=ip,
    )
    notify.send(
        notify.chief_auditors(actor.organization_id),
        "Export waiting for your approval",
        f"{actor.full_name} asks to export queries.",
        link="/approvals",
        exclude=actor,
    )
    return item


@transaction.atomic
def decide_export(*, request_id, actor: User, approve: bool, reason: str = "", ip=None) -> ExportRequest:
    item = (
        ExportRequest.objects.select_for_update()
        .select_related("requested_by")
        .in_org(actor.organization_id)
        .get(pk=request_id)
    )
    if item.decision != Decision.PENDING:
        raise WorkflowError(f"This export was already {item.decision.lower()}.")
    if item.requested_by_id == actor.pk:
        raise WorkflowError("You asked for this export, so someone else must decide it.")
    if actor.effective_role() != Role.CIA:
        raise WorkflowError("Only the CIA decides exports.")
    if not approve and len((reason or "").strip()) < MIN_REASON:
        raise WorkflowError(f"Say why it is rejected, in at least {MIN_REASON} characters.")
    item.decision = Decision.APPROVED if approve else Decision.REJECTED
    item.decided_by = actor
    item.decision_reason = (reason or "").strip()
    item.decided_at = timezone.now()
    item.save(update_fields=["decision", "decided_by", "decision_reason", "decided_at", "updated_at"])
    record(
        actor=actor,
        action="export.approve" if approve else "export.reject",
        object_type="ExportRequest",
        object_id=item.pk,
        old={"decision": Decision.PENDING},
        new={"decision": item.decision},
        reason=item.decision_reason,
        ip=ip,
    )
    notify.send(
        [item.requested_by],
        "Export approved" if approve else "Export rejected",
        ("Download it from Reviews." if approve else "The reason is under Reviews."),
    )
    return item


@transaction.atomic
def download_export(*, request_id, actor: User, ip=None) -> tuple[bytes, int]:
    item = (
        ExportRequest.objects.select_for_update()
        .select_related("decided_by")
        .in_org(actor.organization_id)
        .get(pk=request_id)
    )
    if item.requested_by_id != actor.pk:
        raise WorkflowError("Only the person who asked for this export can download it.")
    if item.decision != Decision.APPROVED:
        raise WorkflowError("This export has not been approved by the CIA.")
    queries = list(_rows(actor, item.filters))
    item.downloads += 1
    item.save(update_fields=["downloads", "updated_at"])
    record(
        actor=actor,
        action="export.download",
        object_type="ExportRequest",
        object_id=item.pk,
        new={"rows": len(queries), "download": item.downloads},
        ip=ip,
    )
    return render(queries, actor=actor, filters=item.filters, fmt=item.format, request=item), len(queries)


def export_report(*, actor: User, report: AuditReport, ip=None) -> bytes:
    """The CIA's PDF of one audit report: its header, criteria, queries and summary (section 8.1)."""
    if actor.effective_role() != Role.CIA:
        raise WorkflowError("Only the CIA can export without approval. Ask through an export request.")
    if report.organization_id != actor.organization_id:
        raise WorkflowError("That report was not found.")
    filters = {"report": str(report.pk)}
    queries = list(_rows(actor, filters))
    record(
        actor=actor,
        action="export.report",
        object_type="AuditReport",
        object_id=report.pk,
        new={"rows": len(queries), "format": ExportFormat.PDF},
        ip=ip,
    )
    return render_pdf(queries, actor=actor, filters=filters, report=report)
