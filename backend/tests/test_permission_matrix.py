"""Every endpoint x every role x allowed/denied (architecture.md 11).

Adding a route without adding it here (or to PUBLIC) fails test_every_route_is_covered.
"""

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from config.urls import api

from .conftest import ALL_ROLES

ALL = set(ALL_ROLES)
ORG = ALL - {"SYS"}

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
    ("users-send-enrolment", "post", "user", {"ICT"}),
    ("users-acting-cia", "post", "user", {"ICT"}),
    ("users-end-acting-cia", "post", "user", {"ICT"}),
    ("audit-log", "get", None, {"CIA"}),
    ("audit-log-verify", "post", None, {"CIA", "ICT"}),
    # Import moved from the PIA to the CIA (owner, 2026-10-22).
    ("imports-list", "get", None, {"CIA"}),
    ("imports-list", "post", None, {"CIA"}),
    ("imports-preview", "get", "batch", {"CIA"}),
    ("imports-confirm", "post", "batch", {"CIA"}),
    ("imports-cancel", "post", "batch", {"CIA"}),
    # The CEO reads every query and changes nothing (auditlogs-additions_final.md 9).
    ("queries-list", "get", None, READERS | {"CEO"}),
    # An IA or SIA who is not the assignee gets 404 here, which the scoping tests check.
    ("queries-detail", "get", "query", READERS | {"CEO"}),
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
    ("notifications-list", "get", None, ORG),
    ("notifications-read-all", "post", None, ORG),
    ("notifications-read", "post", "notification", ORG),
    ("dashboard-queries", "get", None, {"CEO"}),
    ("dashboard-cia-activity", "get", None, {"CEO"}),
    # Widgets switched per organization; every role of the organization sees its own counts.
    ("dashboard-status-summary", "get", None, ORG),
    ("dashboard-registered-numbers", "get", None, ORG),
    ("dashboard-system-stats", "get", None, ORG),
    # The original uploaded file (section 12).
    ("imports-original", "get", "batch", {"CIA", "PIA", "CEO"}),
    # Audit reports and criteria (section 8.1).
    ("reports-list", "get", None, READERS | {"CEO"}),
    ("reports-list", "post", None, {"CIA"}),
    ("reports-detail", "get", "report", READERS | {"CEO"}),
    ("reports-detail", "patch", "report", {"CIA"}),
    ("reports-criteria", "get", "report", READERS | {"CEO"}),
    ("reports-criteria", "post", "report", {"CIA"}),
    ("reports-update-criterion", "patch", "criterion", {"CIA"}),
    ("reports-pdf", "get", "report", {"CIA"}),
    # Compliance (design.md 12). ICT reads queries only under a break-glass grant (test_compliance.py).
    ("retention-rules-list", "get", None, {"CIA"}),
    ("retention-rules-list", "post", None, {"CIA"}),
    ("disposals-list", "get", None, {"CIA"}),
    ("disposals-check", "post", None, {"CIA"}),
    ("disposals-approve", "post", "disposal", {"CIA"}),
    ("disposals-reject", "post", "disposal", {"CIA"}),
    ("breaches-list", "get", None, {"CIA", "ICT"}),
    ("breaches-list", "post", None, {"CIA", "ICT"}),
    ("breaches-detail", "get", "breach", {"CIA", "ICT"}),
    ("breaches-detail", "patch", "breach", {"CIA", "ICT"}),
    ("breaches-close", "post", "breach", {"CIA", "ICT"}),
    ("subject-search", "get", None, {"CIA"}),
    ("subject-export", "post", None, {"CIA"}),
    ("access-requests-list", "get", None, {"CIA", "ICT"}),
    ("access-requests-list", "post", None, {"ICT"}),
    ("access-requests-approve", "post", "grant", {"CIA"}),
    ("access-requests-reject", "post", "grant", {"CIA"}),
    ("access-requests-end", "post", "grant", {"CIA", "ICT"}),
    # Platform administration: the System Administrator only (section 4).
    ("platform-organizations-list", "get", None, {"SYS"}),
    ("platform-organizations-list", "post", None, {"SYS"}),
    ("platform-organizations-detail", "get", "organization", {"SYS"}),
    ("platform-organizations-detail", "patch", "organization", {"SYS"}),
    ("platform-organizations-approve", "post", "organization", {"SYS"}),
    ("platform-organizations-reject", "post", "organization", {"SYS"}),
    ("platform-organizations-suspend", "post", "organization", {"SYS"}),
    ("platform-organizations-reactivate", "post", "organization", {"SYS"}),
    ("platform-organizations-deactivate", "post", "organization", {"SYS"}),
    ("platform-organizations-features", "get", "organization", {"SYS"}),
    ("platform-organizations-features", "put", "organization", {"SYS"}),
    ("platform-organizations-admin", "post", "organization", {"SYS"}),
    ("platform-stats", "get", None, {"SYS"}),
    ("platform-audit-log", "get", None, {"SYS"}),
    ("platform-audit-log-verify", "post", None, {"SYS"}),
]

# Reachable without signing in. Each says nothing about data.
PUBLIC = {
    "health",
    "auth-csrf",
    "auth-login",
    "auth-mfa",
    "auth-mfa-resend",
    "auth-set-password",
    "signup",
    "signup-verify",
}

IDS = [f"{m[1]} {m[0]}" for m in MATRIX]


def call(client: APIClient, method: str, url: str):
    return getattr(client, method)(url, {}, format="json")


@pytest.mark.parametrize("role", ALL_ROLES)
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
