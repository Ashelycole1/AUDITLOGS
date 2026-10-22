"""Every endpoint x every role x allowed/denied (architecture.md 11).

Adding a route without adding it here (or to PUBLIC) fails test_every_route_is_covered.
"""

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from config.urls import api

from .conftest import ROLES

ALL = set(ROLES)

# (url name, method, target object or None, roles allowed)
READERS = {"PIA", "CIA", "IA", "SIA"}
MATRIX = [
    ("auth-logout", "post", None, ALL),
    ("auth-me", "get", None, ALL),
    ("users-list", "get", None, {"ICT"}),
    ("users-list", "post", None, {"ICT"}),
    ("users-detail", "get", "user", {"ICT"}),
    ("users-detail", "patch", "user", {"ICT"}),
    ("users-disable", "post", "user", {"ICT"}),
    ("users-enable", "post", "user", {"ICT"}),
    ("audit-log", "get", None, {"CIA"}),
    ("audit-log-verify", "post", None, {"CIA", "ICT"}),
    # Import moved from the PIA to the CIA (owner, 2026-10-22).
    ("imports-list", "get", None, {"CIA"}),
    ("imports-list", "post", None, {"CIA"}),
    ("imports-preview", "get", "batch", {"CIA"}),
    ("imports-confirm", "post", "batch", {"CIA"}),
    ("imports-cancel", "post", "batch", {"CIA"}),
    ("queries-list", "get", None, READERS),
    # An IA or SIA who is not the assignee gets 404 here, which the scoping tests check.
    ("queries-detail", "get", "query", READERS),
    ("queries-detail", "patch", "query", {"CIA"}),
    ("queries-assign", "post", "query", {"PIA", "CIA"}),
    ("queries-bulk-assign", "post", None, {"PIA", "CIA"}),
    ("queries-revisions", "get", "query", READERS),
    ("queries-history", "get", "query", READERS),
    ("queries-activities", "get", "query", READERS),
    ("queries-activities", "post", "query", READERS),
    ("queries-evidence", "get", "query", READERS),
    ("queries-evidence", "post", "query", READERS),
    ("queries-comments", "get", "query", READERS | {"CEO"}),
    ("queries-comments", "post", "query", READERS | {"CEO"}),
    ("queries-propose-status", "post", "query", {"IA", "SIA"}),
    ("queries-change-status", "post", "query", {"CIA"}),
    ("queries-export", "get", None, {"CIA"}),
    ("evidence-download", "get", "evidence", READERS),
    ("status-requests-list", "get", None, {"PIA", "CIA"}),
    ("status-requests-approve", "post", "request", {"CIA"}),
    ("status-requests-reject", "post", "request", {"PIA", "CIA"}),
    ("status-requests-keep-in-view", "post", "request", {"PIA", "CIA"}),
    ("reassignment-requests-list", "get", None, {"PIA", "CIA"}),
    ("reassignment-requests-approve", "post", "reassignment", {"CIA"}),
    ("reassignment-requests-reject", "post", "reassignment", {"CIA"}),
    ("export-requests-list", "get", None, {"PIA", "CIA"}),
    ("export-requests-list", "post", None, {"PIA"}),
    ("export-requests-approve", "post", "export", {"CIA"}),
    ("export-requests-reject", "post", "export", {"CIA"}),
    ("export-requests-download", "get", "export", {"PIA"}),
    ("auditors", "get", None, {"PIA", "CIA"}),
    ("notifications-list", "get", None, ALL),
    ("notifications-read-all", "post", None, ALL),
    ("notifications-read", "post", "notification", ALL),
    ("dashboard-queries", "get", None, {"CEO"}),
    ("dashboard-cia-activity", "get", None, {"CEO"}),
]

# Reachable without signing in. Each says nothing about data.
PUBLIC = {"health", "auth-csrf", "auth-login", "auth-mfa", "auth-mfa-resend"}

IDS = [f"{m[1]} {m[0]}" for m in MATRIX]


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
def url_for(
    make_user,
    make_batch,
    make_query,
    make_evidence,
    make_request,
    make_reassignment,
    make_export,
    make_notification,
):
    def _url(name: str, target: str | None) -> str:
        if target is None:
            return reverse(name)
        obj = {
            "user": lambda: make_user("IA"),
            "batch": lambda: make_batch("Previewed"),
            "query": make_query,
            "evidence": lambda: make_evidence(make_query()),
            "request": lambda: make_request(make_query()),
            "reassignment": lambda: make_reassignment(make_query()),
            "export": make_export,
            "notification": make_notification,
        }[target]()
        return reverse(name, kwargs={"pk": obj.pk})

    return _url


def call(client: APIClient, method: str, url: str):
    return getattr(client, method)(url, {}, format="json")


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize(("name", "method", "target", "allowed"), MATRIX, ids=IDS)
def test_role_access(role, name, method, target, allowed, client_for, url_for):
    response = call(client_for(role), method, url_for(name, target))
    if role in allowed:
        assert response.status_code != 403, response.content
    else:
        assert response.status_code == 403


@pytest.mark.parametrize(("name", "method", "target", "allowed"), MATRIX, ids=IDS)
def test_anonymous_is_refused(name, method, target, allowed, url_for):
    assert call(APIClient(), method, url_for(name, target)).status_code == 403


@pytest.mark.parametrize(("name", "method", "target", "allowed"), MATRIX, ids=IDS)
def test_password_without_pin_is_refused(name, method, target, allowed, password_only_client, url_for):
    for role in allowed:
        assert call(password_only_client(role), method, url_for(name, target)).status_code == 403


def test_every_route_is_covered():
    names = {p.name for p in api}
    covered = {m[0] for m in MATRIX} | PUBLIC
    assert names - covered == set(), "Add these routes to MATRIX or PUBLIC"


def test_acting_cia_has_cia_rights_only_while_the_grant_lasts(client_for, make_user):
    ia = make_user("IA")
    ia.acting_cia_until = timezone.now() + timedelta(hours=2)
    ia.save()
    assert client_for(ia).get(reverse("audit-log")).status_code == 200

    ia.acting_cia_until = timezone.now() - timedelta(minutes=1)
    ia.save()
    assert client_for(ia).get(reverse("audit-log")).status_code == 403


def test_disabled_user_loses_access_at_once(client_for, make_user):
    user = make_user("CIA")
    client = client_for(user)
    user.is_active = False
    user.save()
    assert client.get(reverse("auth-me")).status_code == 403
