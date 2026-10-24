import re
import secrets
import uuid

import pytest
from django.core import mail
from django.urls import reverse
from django_otp import DEVICE_ID_SESSION_KEY
from django_otp.plugins.otp_email.models import EmailDevice
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.permissions import SESSION_ORG_KEY, session_org_value

# Generated per test run: no password is ever written in the repository.
PASSWORD = secrets.token_urlsafe(16)
WRONG_PASSWORD = secrets.token_urlsafe(16)
ROLES = ["PIA", "CIA", "IA", "SIA", "CEO", "ICT"]
# Every role, the platform's System Administrator included.
ALL_ROLES = [*ROLES, "SYS"]
MODEL_BACKEND = "django.contrib.auth.backends.ModelBackend"


def emailed_pin(to: str) -> str:
    """The PIN from the most recent sign-in email sent to this address."""
    message = [m for m in mail.outbox if to in m.to][-1]
    return re.search(r"\b(\d{6})\b", message.body).group(1)


@pytest.fixture
def make_org(db):
    """An organization with the given status and features (all on by default)."""
    from apps.organizations import features as catalogue
    from apps.organizations.models import Organization, OrganizationFeature

    def _make(name: str = "Test organisation", *, status: str = "Active", features: dict | None = None):
        org = Organization.objects.create(
            name=name,
            country="Uganda",
            contact_person="Test contact",
            email=f"contact-{uuid.uuid4().hex[:8]}@org.test",
            status=status,
        )
        wanted = {**catalogue.PRESETS["full"], **(features or {})}
        OrganizationFeature.objects.bulk_create(
            OrganizationFeature(organization=org, feature_key=k, enabled=v) for k, v in wanted.items()
        )
        return org

    return _make


@pytest.fixture
def org(make_org):
    """The organization people belong to unless a test says otherwise."""
    return make_org()


@pytest.fixture
def make_user(org):
    def _make(role: str = "IA", *, email: str | None = None, active: bool = True, organization=None) -> User:
        user = User.objects.create_user(
            email=email or f"{role.lower()}-{uuid.uuid4().hex[:8]}@auditlogs.test",
            full_name=f"Test {role}",
            role=role,
            password=PASSWORD,
            organization=None if role == "SYS" else (organization or org),
        )
        if not active:
            user.is_active = False
            user.save(update_fields=["is_active"])
        return user

    return _make


@pytest.fixture
def client_for(make_user):
    """A client signed in with password AND a verified PIN, the only state the API trusts."""

    def _client(user_or_role) -> APIClient:
        user = make_user(user_or_role) if isinstance(user_or_role, str) else user_or_role
        device, _ = EmailDevice.objects.get_or_create(
            user=user, defaults={"name": "Email PIN", "confirmed": True}
        )
        client = APIClient()
        client.force_login(user, backend=MODEL_BACKEND)
        session = client.session
        session[DEVICE_ID_SESSION_KEY] = device.persistent_id
        session[SESSION_ORG_KEY] = session_org_value(user)
        session.save()
        client.user = user
        return client

    return _client


@pytest.fixture
def password_only_client(make_user):
    """Signed in with a password but never passed the PIN step. Must be refused everywhere."""

    def _client(role: str) -> APIClient:
        client = APIClient()
        client.force_login(make_user(role), backend=MODEL_BACKEND)
        return client

    return _client


@pytest.fixture(autouse=True)
def file_storage(settings, tmp_path):
    """Uploaded files go to throwaway folders, encrypted with a key made for this test."""
    from cryptography.fernet import Fernet

    settings.IMPORT_DIR = str(tmp_path / "imports")
    settings.EVIDENCE_DIR = str(tmp_path / "evidence")
    settings.FILE_ENCRYPTION_KEY = Fernet.generate_key()
    return tmp_path


@pytest.fixture
def make_batch(make_user):
    from apps.imports.models import BatchStatus, ImportBatch

    def _make(status: str = BatchStatus.CONFIRMED) -> ImportBatch:
        return ImportBatch.objects.create(
            imported_by=make_user("CIA"),
            source_filename="final-queries.csv",
            source_file_path="unused",
            source_sha256="0" * 64,
            status=status,
        )

    return _make


@pytest.fixture
def make_query(make_batch):
    from datetime import date

    from apps.queries.models import Query

    batch_holder = {}

    def _make(*, assignee=None, reference: str | None = None, **fields) -> Query:
        batch = batch_holder.setdefault("batch", make_batch())
        values = {
            "reference": reference or f"IA/2026/{uuid.uuid4().hex[:6]}",
            "batch": batch,
            "title": "Stock count differences not investigated",
            "description_original": "Differences from the June stock count were written off.",
            "description_current": "Differences from the June stock count were written off.",
            "risk_rating_original": "Medium",
            "risk_rating_current": "Medium",
            "deadline": date(2030, 1, 31),
            "responsible_officer": "Stores Supervisor",
            "department": "Stores",
            "current_assignee": assignee,
            **fields,
        }
        return Query.objects.create(**values)

    return _make


# Records for the permission matrix and the isolation tests: one of each kind a route can target.


@pytest.fixture
def make_evidence(make_user):
    from apps.followup.models import Evidence

    def _make(query):
        return Evidence.objects.create(
            query=query,
            uploaded_by=make_user("IA"),
            original_filename="a.txt",
            stored_path="missing",
            sha256="0" * 64,
            size_bytes=1,
            content_type="text/plain",
        )

    return _make


@pytest.fixture
def make_request(make_user):
    from apps.workflow.models import StatusChangeRequest

    def _make(query):
        return StatusChangeRequest.objects.create(
            query=query,
            from_status="In Progress",
            to_status="Proposed for Closure",
            proposed_by=make_user("IA"),
            proposed_reason="Matrix test proposal",
        )

    return _make


@pytest.fixture
def make_reassignment(make_user):
    from apps.workflow.models import ReassignmentRequest

    def _make(query):
        return ReassignmentRequest.objects.create(
            query=query,
            from_assignee=make_user("IA"),
            to_assignee=make_user("SIA"),
            from_status="Assigned",
            requested_by=make_user("PIA"),
            reason="Matrix test reassignment",
        )

    return _make


@pytest.fixture
def make_export(make_user):
    from apps.workflow.models import ExportRequest

    def _make():
        return ExportRequest.objects.create(requested_by=make_user("PIA"), reason="Matrix test export")

    return _make


@pytest.fixture
def make_notification(make_user):
    from apps.notifications.models import Notification

    def _make():
        return Notification.objects.create(recipient=make_user("IA"), headline="Matrix test")

    return _make


@pytest.fixture
def make_report(make_user):
    from apps.reports.models import AuditReport

    def _make():
        return AuditReport.objects.create(
            organization=make_user("CIA").organization,
            title="Matrix test report",
            created_by=make_user("CIA"),
        )

    return _make


@pytest.fixture
def make_disposal(make_query):
    from django.utils import timezone

    from apps.compliance.models import DisposalRecord

    def _make():
        query = make_query()
        return DisposalRecord.objects.create(
            organization=query.organization,
            record_type="closed_query",
            object_id=query.pk,
            label=query.reference,
            since=timezone.now(),
            retention_months=12,
        )

    return _make


@pytest.fixture
def make_breach(org):
    from apps.compliance.models import BreachRecord

    def _make():
        return BreachRecord.objects.create(organization=org, description="Matrix test breach")

    return _make


@pytest.fixture
def make_grant(make_user):
    from apps.compliance.models import AccessGrant

    def _make():
        return AccessGrant.objects.create(requested_by=make_user("ICT"), reason="Matrix test grant")

    return _make


@pytest.fixture
def url_for(
    make_user,
    make_batch,
    make_query,
    make_evidence,
    make_request,
    make_reassignment,
    make_export,
    make_notification,
    make_report,
    make_org,
    make_disposal,
    make_breach,
    make_grant,
):
    def _url(name: str, target: str | None) -> str:
        if target is None:
            return reverse(name)
        if target == "criterion":
            from apps.reports.models import Criterion

            report = make_report()
            criterion = Criterion.objects.create(report=report, title="Matrix criterion")
            return reverse(name, kwargs={"pk": report.pk, "criterion_id": criterion.pk})
        obj = {
            "user": lambda: make_user("IA"),
            "batch": lambda: make_batch("Previewed"),
            "query": make_query,
            "evidence": lambda: make_evidence(make_query()),
            "request": lambda: make_request(make_query()),
            "reassignment": lambda: make_reassignment(make_query()),
            "export": make_export,
            "notification": make_notification,
            "report": make_report,
            "organization": lambda: make_org("Matrix organisation", status="Pending"),
            "disposal": make_disposal,
            "breach": make_breach,
            "grant": make_grant,
        }[target]()
        return reverse(name, kwargs={"pk": obj.pk})

    return _url
