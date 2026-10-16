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

# (url name, method, needs a target user id, roles allowed)
MATRIX = [
    ("auth-logout", "post", False, ALL),
    ("auth-me", "get", False, ALL),
    ("users-list", "get", False, {"ICT"}),
    ("users-list", "post", False, {"ICT"}),
    ("users-detail", "get", True, {"ICT"}),
    ("users-detail", "patch", True, {"ICT"}),
    ("users-disable", "post", True, {"ICT"}),
    ("users-enable", "post", True, {"ICT"}),
    ("audit-log", "get", False, {"CIA"}),
    ("audit-log-verify", "post", False, {"CIA", "ICT"}),
]

# Reachable without signing in. Each says nothing about data.
PUBLIC = {"health", "auth-csrf", "auth-login", "auth-mfa", "auth-mfa-resend"}


def url_for(name: str, needs_target: bool, make_user) -> str:
    return reverse(name, kwargs={"pk": make_user("IA").pk}) if needs_target else reverse(name)


def call(client: APIClient, method: str, url: str):
    return getattr(client, method)(url, {}, format="json")


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize(
    ("name", "method", "needs_target", "allowed"), MATRIX, ids=[f"{m[1]} {m[0]}" for m in MATRIX]
)
def test_role_access(role, name, method, needs_target, allowed, client_for, make_user):
    response = call(client_for(role), method, url_for(name, needs_target, make_user))
    if role in allowed:
        assert response.status_code != 403, response.content
    else:
        assert response.status_code == 403


@pytest.mark.parametrize(
    ("name", "method", "needs_target", "allowed"), MATRIX, ids=[f"{m[1]} {m[0]}" for m in MATRIX]
)
def test_anonymous_is_refused(name, method, needs_target, allowed, make_user):
    assert call(APIClient(), method, url_for(name, needs_target, make_user)).status_code == 403


@pytest.mark.parametrize(
    ("name", "method", "needs_target", "allowed"), MATRIX, ids=[f"{m[1]} {m[0]}" for m in MATRIX]
)
def test_password_without_mfa_is_refused(
    name, method, needs_target, allowed, password_only_client, make_user
):
    for role in allowed:
        assert (
            call(password_only_client(role), method, url_for(name, needs_target, make_user)).status_code
            == 403
        )


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
