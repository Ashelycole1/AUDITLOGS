"""Sign-in with password then TOTP, lockout, session rules (design.md 6, architecture.md 5.6)."""

import time

import pytest
from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.urls import reverse
from django_otp.plugins.otp_totp.models import TOTPDevice
from rest_framework.test import APIClient

from apps.auditlog.models import AuditLog
from apps.auditlog.services import verify_chain

from .conftest import PASSWORD, totp_code

pytestmark = pytest.mark.django_db

LOGIN = reverse("auth-login")
MFA = reverse("auth-mfa")
ME = reverse("auth-me")


def actions() -> list[str]:
    return list(AuditLog.objects.values_list("action", flat=True))


def test_password_then_code_signs_in(make_user):
    user = make_user("CIA")
    client = APIClient()

    response = client.post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json")
    assert response.json() == {"mfa": "verify"}
    # A correct password alone opens nothing.
    assert client.get(ME).status_code == 403

    device = TOTPDevice.objects.get(user=user)
    response = client.post(MFA, {"code": totp_code(device)}, format="json")
    assert response.status_code == 200
    assert response.json()["role"] == "CIA"
    assert client.get(ME).json()["email"] == user.email
    assert "auth.login" in actions()
    assert verify_chain().ok


def test_email_is_matched_case_insensitively(make_user):
    user = make_user("IA")
    response = APIClient().post(LOGIN, {"email": user.email.upper(), "password": PASSWORD}, format="json")
    assert response.status_code == 200


def test_wrong_password_and_unknown_email_get_the_same_answer(make_user):
    user = make_user("IA")
    client = APIClient()
    wrong = client.post(LOGIN, {"email": user.email, "password": "not-the-password"}, format="json")
    unknown = client.post(
        LOGIN, {"email": "nobody@auditlogs.test", "password": "not-the-password"}, format="json"
    )
    assert wrong.status_code == unknown.status_code == 400
    assert wrong.json() == unknown.json()
    assert actions().count("auth.login_failed") == 2


def test_account_locks_after_five_failures(make_user):
    user = make_user("IA")
    client = APIClient()
    codes = [
        client.post(LOGIN, {"email": user.email, "password": "wrong-password-x"}, format="json").status_code
        for _ in range(settings.AXES_FAILURE_LIMIT)
    ]
    assert codes == [400] * (settings.AXES_FAILURE_LIMIT - 1) + [403]

    # Even the right password is refused while locked.
    response = client.post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json")
    assert response.status_code == 403
    assert response.json()["code"] == "locked"
    assert "15 minutes" in response.json()["detail"]


def test_lockout_counts_email_case_variants_together(make_user):
    user = make_user("IA")
    client = APIClient()
    variants = [user.email, user.email.upper(), user.email.title(), user.email, user.email.upper()]
    for email in variants:
        client.post(LOGIN, {"email": email, "password": "wrong-password-x"}, format="json")
    response = client.post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json")
    assert response.status_code == 403
    assert response.json()["code"] == "locked"


def test_disabled_account_cannot_sign_in(make_user):
    user = make_user("IA", active=False)
    response = APIClient().post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json")
    assert response.status_code == 400


def test_first_sign_in_enrols_an_authenticator(make_user):
    user = make_user("PIA", mfa=False)
    client = APIClient()

    response = client.post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json")
    body = response.json()
    assert body["mfa"] == "setup"
    assert body["otpauth_uri"].startswith("otpauth://totp/")
    assert len(body["secret"]) >= 16

    device = TOTPDevice.objects.get(user=user, confirmed=False)
    assert client.post(MFA, {"code": totp_code(device)}, format="json").status_code == 200
    device.refresh_from_db()
    assert device.confirmed
    assert {"user.mfa_setup", "auth.login"} <= set(actions())


def test_mfa_step_needs_the_password_step_first(make_user):
    response = APIClient().post(MFA, {"code": "123456"}, format="json")
    assert response.status_code == 400
    assert response.json()["code"] == "expired"


def test_wrong_codes_end_the_attempt_after_five(make_user):
    user = make_user("IA")
    client = APIClient()
    client.post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json")
    device = TOTPDevice.objects.get(user=user)
    wrong = "000000" if totp_code(device) != "000000" else "111111"

    for _ in range(settings.MFA_MAX_FAILURES - 1):
        assert client.post(MFA, {"code": wrong}, format="json").status_code == 400
    last = client.post(MFA, {"code": wrong}, format="json")
    assert last.json()["code"] == "expired"
    # The pending sign-in is gone: a right code no longer works without the password again.
    assert client.post(MFA, {"code": totp_code(device)}, format="json").json()["code"] == "expired"
    assert actions().count("auth.mfa_failed") == settings.MFA_MAX_FAILURES


def test_pending_sign_in_expires(make_user):
    user = make_user("IA")
    client = APIClient()
    client.post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json")
    session = client.session
    session["mfa_pending"]["at"] = time.time() - settings.MFA_PENDING_SECONDS - 1
    session.save()
    device = TOTPDevice.objects.get(user=user)
    assert client.post(MFA, {"code": totp_code(device)}, format="json").json()["code"] == "expired"


def test_logout_ends_the_session(client_for):
    client = client_for("IA")
    assert client.post(reverse("auth-logout")).status_code == 204
    assert client.get(ME).status_code == 403
    assert "auth.logout" in actions()


def test_login_requires_csrf_token(make_user):
    user = make_user("IA")
    client = APIClient(enforce_csrf_checks=True)
    response = client.post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json")
    assert response.status_code == 403

    client.get(reverse("auth-csrf"))
    token = client.cookies["csrftoken"].value
    response = client.post(
        LOGIN, {"email": user.email, "password": PASSWORD}, format="json", HTTP_X_CSRFTOKEN=token
    )
    assert response.status_code == 200


def test_passwords_are_argon2_and_at_least_12_characters(make_user):
    assert make_user("IA").password.startswith("argon2")
    with pytest.raises(ValidationError):
        validate_password("Short-pw-1")


def test_session_times_out_after_30_idle_minutes():
    assert settings.SESSION_COOKIE_AGE == 30 * 60
    assert settings.SESSION_SAVE_EVERY_REQUEST is True
    assert settings.SESSION_COOKIE_HTTPONLY is True


def test_health_says_nothing_about_data():
    response = APIClient().get(reverse("health"))
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
