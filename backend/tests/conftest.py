import re
import secrets
import uuid

import pytest
from django.core import mail
from django_otp import DEVICE_ID_SESSION_KEY
from django_otp.plugins.otp_email.models import EmailDevice
from rest_framework.test import APIClient

from apps.accounts.models import User

# Generated per test run: no password is ever written in the repository.
PASSWORD = secrets.token_urlsafe(16)
WRONG_PASSWORD = secrets.token_urlsafe(16)
ROLES = ["PIA", "CIA", "IA", "CEO", "ICT"]
MODEL_BACKEND = "django.contrib.auth.backends.ModelBackend"


def emailed_pin(to: str) -> str:
    """The PIN from the most recent sign-in email sent to this address."""
    message = [m for m in mail.outbox if to in m.to][-1]
    return re.search(r"\b(\d{6})\b", message.body).group(1)


@pytest.fixture
def make_user(db):
    def _make(role: str = "IA", *, email: str | None = None, active: bool = True) -> User:
        user = User.objects.create_user(
            email=email or f"{role.lower()}-{uuid.uuid4().hex[:8]}@auditlogs.test",
            full_name=f"Test {role}",
            role=role,
            password=PASSWORD,
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
