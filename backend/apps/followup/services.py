"""Follow-up notes, management responses and evidence (design.md 1, step 4)."""

from pathlib import Path

from django.conf import settings
from django.db import transaction

from apps.auditlog.services import record
from apps.core import notify
from apps.core.exceptions import RuleError
from apps.core.filestore import read_encrypted, save_encrypted, sha256
from apps.queries.models import Query, Status
from apps.workflow.services import AUDITORS, WorkflowError, transition

from .models import Comment, Evidence, FollowUpActivity

# design.md 13: allowed evidence types, each served back with a fixed content type.
CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "csv": "text/csv",
    "txt": "text/plain",
}


def _check_open_for_work(query: Query, actor) -> None:
    if query.status == Status.CLOSED:
        raise WorkflowError("This query is closed. The CIA can reopen it if more work is needed.")
    if actor.effective_role() in AUDITORS and query.current_assignee_id != actor.pk:
        raise WorkflowError("Only the assigned auditor can add follow-up.")


def _start_work(query: Query, actor, ip) -> None:
    """The auditor's first entry moves Assigned to In Progress; resuming a Returned or Kept in View
    query does too."""
    if actor.effective_role() in AUDITORS and query.status in (
        Status.ASSIGNED,
        Status.RETURNED,
        Status.KEPT_IN_VIEW,
    ):
        transition(query, Status.IN_PROGRESS, actor, ip=ip)


@transaction.atomic
def add_activity(*, query: Query, actor, kind: str, body: str, ip=None) -> FollowUpActivity:
    query = Query.objects.select_for_update().get(pk=query.pk)
    _check_open_for_work(query, actor)
    activity = FollowUpActivity.objects.create(query=query, author=actor, kind=kind, body=body.strip())
    record(
        actor=actor,
        action="activity.note" if kind == FollowUpActivity.Kind.NOTE else "activity.response",
        object_type="Query",
        object_id=query.pk,
        new={"activity": str(activity.pk), "kind": kind},
        ip=ip,
    )
    _start_work(query, actor, ip)
    return activity


class EvidenceError(RuleError):
    """The file cannot be accepted as evidence."""


@transaction.atomic
def add_evidence(*, query: Query, actor, filename: str, content: bytes, ip=None) -> Evidence:
    query = Query.objects.select_for_update().get(pk=query.pk)
    _check_open_for_work(query, actor)
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext not in CONTENT_TYPES:
        raise EvidenceError(
            f"{filename} is not an allowed type. Use PDF, Word, Excel, PNG, JPG, CSV or text."
        )
    if len(content) > settings.EVIDENCE_MAX_BYTES:
        raise EvidenceError(f"{filename} is larger than {settings.EVIDENCE_MAX_BYTES // (1024 * 1024)} MB.")
    if not content:
        raise EvidenceError(f"{filename} is empty.")
    evidence = Evidence.objects.create(
        query=query,
        uploaded_by=actor,
        original_filename=Path(filename).name[:255],
        stored_path=save_encrypted(content, settings.EVIDENCE_DIR),
        sha256=sha256(content),
        size_bytes=len(content),
        content_type=CONTENT_TYPES[ext],
    )
    record(
        actor=actor,
        action="evidence.upload",
        object_type="Query",
        object_id=query.pk,
        new={"evidence": str(evidence.pk), "filename": evidence.original_filename, "sha256": evidence.sha256},
        ip=ip,
    )
    _start_work(query, actor, ip)
    return evidence


def open_evidence(*, evidence: Evidence, actor, ip=None) -> bytes:
    """Decrypt and check the file. Every download is logged."""
    content = read_encrypted(evidence.stored_path, evidence.sha256)
    record(
        actor=actor,
        action="evidence.download",
        object_type="Query",
        object_id=evidence.query_id,
        new={"evidence": str(evidence.pk), "filename": evidence.original_filename},
        ip=ip,
    )
    return content


@transaction.atomic
def add_comment(*, query: Query, actor, body: str, ip=None) -> Comment:
    """An oversight comment by the CIA or the CEO (owner, 2026-10-22). It changes nothing on the
    query; the auditor who holds it is told by email."""
    role = actor.effective_role()
    if role not in ("CIA", "CEO"):
        raise WorkflowError("Only the CIA and the CEO can comment.")
    body = (body or "").strip()
    if len(body) < 3:
        raise WorkflowError("Write the comment before saving.")
    comment = Comment.objects.create(query=query, author=actor, author_role=role, body=body)
    record(
        actor=actor,
        action="comment.add",
        object_type="Query",
        object_id=query.pk,
        new={"comment": str(comment.pk)},
        ip=ip,
    )
    notify.about_query([query.current_assignee], query, f"New comment from the {role}", exclude=actor)
    return comment
