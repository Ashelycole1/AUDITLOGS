"""Account management by ICT (design.md 6), every change logged with its reason."""

import pytest
from django.urls import reverse
from django_otp.plugins.otp_totp.models import TOTPDevice

from apps.accounts.models import User
from apps.auditlog.models import AuditLog

pytestmark = pytest.mark.django_db

REASON = "Written request from the CIA, ref HR-2026-14"


def last_entry() -> AuditLog:
    return AuditLog.objects.order_by("-seq").first()


def test_create_account(client_for):
    ict = client_for("ICT")
    response = ict.post(
        reverse("users-list"),
        {"email": "New.Person@AuditLogs.test", "full_name": "New Person", "role": "IA"},
        format="json",
    )
    assert response.status_code == 201
    user = User.objects.get(pk=response.json()["id"])
    assert user.email == "new.person@auditlogs.test"
    assert not user.has_usable_password()
    entry = last_entry()
    assert (entry.action, entry.actor_id, entry.new_value["role"]) == ("user.create", ict.user.pk, "IA")


def test_duplicate_email_is_refused(client_for, make_user):
    existing = make_user("IA")
    response = client_for("ICT").post(
        reverse("users-list"), {"email": existing.email, "full_name": "X", "role": "IA"}, format="json"
    )
    assert response.status_code == 400


def test_disable_needs_a_reason_and_is_logged(client_for, make_user):
    ict = client_for("ICT")
    target = make_user("IA")
    url = reverse("users-disable", kwargs={"pk": target.pk})

    assert ict.post(url, {"reason": "too short"}, format="json").status_code == 400
    assert ict.post(url, {"reason": REASON}, format="json").status_code == 200
    target.refresh_from_db()
    assert not target.is_active
    entry = last_entry()
    assert (entry.action, entry.reason, entry.old_value, entry.new_value) == (
        "user.disable",
        REASON,
        {"is_active": True},
        {"is_active": False},
    )


def test_enable_restores_access(client_for, make_user):
    target = make_user("IA", active=False)
    response = client_for("ICT").post(
        reverse("users-enable", kwargs={"pk": target.pk}), {"reason": REASON}, format="json"
    )
    assert response.status_code == 200
    target.refresh_from_db()
    assert target.is_active


def test_ict_cannot_disable_or_demote_themselves(client_for):
    ict = client_for("ICT")
    me = ict.user
    assert (
        ict.post(
            reverse("users-disable", kwargs={"pk": me.pk}), {"reason": REASON}, format="json"
        ).status_code
        == 400
    )
    assert (
        ict.patch(
            reverse("users-detail", kwargs={"pk": me.pk}), {"role": "CIA", "reason": REASON}, format="json"
        ).status_code
        == 400
    )
    me.refresh_from_db()
    assert me.is_active and me.role == "ICT"


def test_role_change_is_logged_with_old_and_new(client_for, make_user):
    target = make_user("IA")
    response = client_for("ICT").patch(
        reverse("users-detail", kwargs={"pk": target.pk}), {"role": "PIA", "reason": REASON}, format="json"
    )
    assert response.status_code == 200
    entry = last_entry()
    assert entry.action == "user.role_change"
    assert (entry.old_value["role"], entry.new_value["role"]) == ("IA", "PIA")


def test_reset_mfa_removes_the_authenticator(client_for, make_user):
    target = make_user("IA")
    assert TOTPDevice.objects.filter(user=target).exists()
    response = client_for("ICT").post(
        reverse("users-reset-mfa", kwargs={"pk": target.pk}), {"reason": REASON}, format="json"
    )
    assert response.status_code == 200
    assert not TOTPDevice.objects.filter(user=target).exists()
    assert last_entry().action == "user.reset_mfa"


def test_accounts_are_never_deleted(client_for, make_user):
    target = make_user("IA")
    assert client_for("ICT").delete(reverse("users-detail", kwargs={"pk": target.pk})).status_code == 405
    with pytest.raises(PermissionError):
        target.delete()
