"""Sign-in with password then an emailed one-time PIN, lockout, session rules (architecture.md 5.6)."""

import time

import pytest
from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core import mail
from django.core.exceptions import ValidationError
from django.test import override_settings
from django.urls import reverse
from django_otp.plugins.otp_email.models import EmailDevice
from rest_framework.test import APIClient

from apps.auditlog.models import AuditLog
from apps.auditlog.services import verify_chain

from .conftest import PASSWORD, WRONG_PASSWORD, emailed_pin

pytestmark = pytest.mark.django_db

LOGIN = reverse("auth-login")
MFA = reverse("auth-mfa")
RESEND = reverse("auth-mfa-resend")
ME = reverse("auth-me")


def actions() -> list[str]:
    return list(AuditLog.objects.values_list("action", flat=True))


def start(client: APIClient, user) -> dict:
    return client.post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json").json()


def wrong_pin(user) -> str:
    return "000000" if emailed_pin(user.email) != "000000" else "111111"


def test_password_then_emailed_pin_signs_in(make_user):
    user = make_user("CIA")
    client = APIClient()

    body = start(client, user)
    assert body["mfa"] == "email"
    assert body["sent_to"].endswith("@auditlogs.test") and user.email not in body["sent_to"]
    # A correct password alone opens nothing.
    assert client.get(ME).status_code == 403

    response = client.post(MFA, {"code": emailed_pin(user.email)}, format="json")
    assert response.status_code == 200
    assert response.json()["role"] == "CIA"
    assert client.get(ME).json()["email"] == user.email
    assert "auth.login" in actions()
    assert verify_chain().ok


def test_pin_email_carries_the_pin_and_nothing_else(make_user):
    user = make_user("IA")
    start(APIClient(), user)
    message = mail.outbox[-1]
    assert message.to == [user.email]
    assert message.subject == "Your AuditLogs sign-in code"
    assert user.full_name not in message.body
    assert "expires in 5 minutes" in message.body


def test_a_pin_works_only_once(make_user):
    user = make_user("IA")
    client = APIClient()
    start(client, user)
    pin = emailed_pin(user.email)
    assert client.post(MFA, {"code": pin}, format="json").status_code == 200

    other = APIClient()
    start(other, user)  # Within the cooldown no new PIN is sent, and the used one is spent.
    assert other.post(MFA, {"code": pin}, format="json").status_code == 400


def test_pin_expires_after_five_minutes(make_user):
    user = make_user("IA")
    client = APIClient()
    start(client, user)
    EmailDevice.objects.filter(user=user).update(
        valid_until=EmailDevice.objects.get(user=user).valid_until.replace(year=2000)
    )
    assert client.post(MFA, {"code": emailed_pin(user.email)}, format="json").status_code == 400


def test_resend_is_limited(make_user):
    user = make_user("IA")
    client = APIClient()
    start(client, user)
    # Within a minute of the first PIN another is refused.
    assert client.post(RESEND, format="json").status_code == 429

    for n in range(settings.MFA_MAX_RESENDS):
        EmailDevice.objects.filter(user=user).update(last_generated_timestamp=None)
        assert client.post(RESEND, format="json").status_code == 200, n
    EmailDevice.objects.filter(user=user).update(last_generated_timestamp=None)
    assert client.post(RESEND, format="json").json()["code"] == "expired"
    assert actions().count("auth.mfa_resent") == settings.MFA_MAX_RESENDS


def test_resent_pin_signs_in(make_user):
    user = make_user("IA")
    client = APIClient()
    start(client, user)
    EmailDevice.objects.filter(user=user).update(last_generated_timestamp=None)
    client.post(RESEND, format="json")
    assert len(mail.outbox) == 2
    assert client.post(MFA, {"code": emailed_pin(user.email)}, format="json").status_code == 200


def test_email_is_matched_case_insensitively(make_user):
    user = make_user("IA")
    response = APIClient().post(LOGIN, {"email": user.email.upper(), "password": PASSWORD}, format="json")
    assert response.status_code == 200


def test_wrong_password_and_unknown_email_get_the_same_answer(make_user):
    user = make_user("IA")
    client = APIClient()
    wrong = client.post(LOGIN, {"email": user.email, "password": WRONG_PASSWORD}, format="json")
    unknown = client.post(
        LOGIN, {"email": "nobody@auditlogs.test", "password": WRONG_PASSWORD}, format="json"
    )
    assert wrong.status_code == unknown.status_code == 400
    assert wrong.json() == unknown.json()
    assert actions().count("auth.login_failed") == 2
    assert mail.outbox == []


def test_account_locks_after_five_failures(make_user):
    user = make_user("IA")
    client = APIClient()
    codes = [
        client.post(LOGIN, {"email": user.email, "password": WRONG_PASSWORD}, format="json").status_code
        for _ in range(settings.AXES_FAILURE_LIMIT)
    ]
    assert codes == [400] * (settings.AXES_FAILURE_LIMIT - 1) + [403]

    # Even the right password is refused while locked, and no PIN is sent.
    response = client.post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json")
    assert response.status_code == 403
    assert response.json()["code"] == "locked"
    assert "15 minutes" in response.json()["detail"]
    assert mail.outbox == []


def test_lockout_counts_email_case_variants_together(make_user):
    user = make_user("IA")
    client = APIClient()
    variants = [user.email, user.email.upper(), user.email.title(), user.email, user.email.upper()]
    for email in variants:
        client.post(LOGIN, {"email": email, "password": WRONG_PASSWORD}, format="json")
    response = client.post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json")
    assert response.status_code == 403
    assert response.json()["code"] == "locked"


def test_disabled_account_cannot_sign_in(make_user):
    user = make_user("IA", active=False)
    response = APIClient().post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json")
    assert response.status_code == 400
    assert mail.outbox == []


def test_pin_step_needs_the_password_step_first(make_user):
    response = APIClient().post(MFA, {"code": "123456"}, format="json")
    assert response.status_code == 400
    assert response.json()["code"] == "expired"
    assert APIClient().post(RESEND, format="json").json()["code"] == "expired"


def test_wrong_pins_end_the_attempt_after_five(make_user):
    user = make_user("IA")
    client = APIClient()
    start(client, user)
    wrong = wrong_pin(user)

    for _ in range(settings.MFA_MAX_FAILURES - 1):
        assert client.post(MFA, {"code": wrong}, format="json").status_code == 400
    assert client.post(MFA, {"code": wrong}, format="json").json()["code"] == "expired"
    # The pending sign-in is gone: the right PIN no longer works without the password again.
    assert client.post(MFA, {"code": emailed_pin(user.email)}, format="json").json()["code"] == "expired"
    assert actions().count("auth.mfa_failed") == settings.MFA_MAX_FAILURES


def test_pending_sign_in_expires(make_user):
    user = make_user("IA")
    client = APIClient()
    start(client, user)
    session = client.session
    session["mfa_pending"]["at"] = time.time() - settings.MFA_PENDING_SECONDS - 1
    session.save()
    assert client.post(MFA, {"code": emailed_pin(user.email)}, format="json").json()["code"] == "expired"


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


@override_settings(MFA_REQUIRED=False)
def test_paused_mfa_signs_in_with_the_password_alone(make_user):
    user = make_user("CIA")
    client = APIClient()

    response = client.post(LOGIN, {"email": user.email, "password": PASSWORD}, format="json")
    assert response.status_code == 200
    assert response.json()["role"] == "CIA"
    assert client.get(ME).json()["email"] == user.email
    assert not mail.outbox
    entry = AuditLog.objects.filter(action="auth.login").get()
    assert entry.new_value == {"mfa": "off"}
    assert verify_chain().ok


@override_settings(MFA_REQUIRED=False)
def test_paused_mfa_still_refuses_a_wrong_password(make_user):
    user = make_user("IA")
    client = APIClient()
    response = client.post(LOGIN, {"email": user.email, "password": WRONG_PASSWORD}, format="json")
    assert response.status_code == 400
    assert client.get(ME).status_code == 403
