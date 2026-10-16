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
    ("imports-list", "get", None, {"PIA"}),
    ("imports-list", "post", None, {"PIA"}),
    ("imports-preview", "get", "batch", {"PIA"}),
    ("imports-confirm", "post", "batch", {"PIA"}),
    ("imports-cancel", "post", "batch", {"PIA"}),
    ("queries-list", "get", None, {"PIA", "CIA", "IA"}),
    # An IA who is not the assignee gets 404 here, which the scoping tests check.
    ("queries-detail", "get", "query", {"PIA", "CIA", "IA"}),
]

# Reachable without signing in. Each says nothing about data.
PUBLIC = {"health", "auth-csrf", "auth-login", "auth-mfa", "auth-mfa-resend"}

IDS = [f"{m[1]} {m[0]}" for m in MATRIX]


@pytest.fixture
def url_for(make_user, make_batch, make_query):
    def _url(name: str, target: str | None) -> str:
        if target is None:
            return reverse(name)
        obj = {
            "user": lambda: make_user("IA"),
            "batch": lambda: make_batch("Previewed"),
            "query": make_query,
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
