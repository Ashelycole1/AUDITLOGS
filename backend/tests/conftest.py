import time
import uuid

import pytest
from django_otp import DEVICE_ID_SESSION_KEY
from django_otp.oath import TOTP
from django_otp.plugins.otp_totp.models import TOTPDevice
from rest_framework.test import APIClient

from apps.accounts.models import User

PASSWORD = "correct-horse-battery-2026"
ROLES = ["PIA", "CIA", "IA", "CEO", "ICT"]
MODEL_BACKEND = "django.contrib.auth.backends.ModelBackend"


def totp_code(device: TOTPDevice) -> str:
    totp = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
    totp.time = time.time()
    return str(totp.token()).zfill(device.digits)


@pytest.fixture
def make_user(db):
    def _make(role: str = "IA", *, email: str | None = None, mfa: bool = True, active: bool = True) -> User:
        user = User.objects.create_user(
            email=email or f"{role.lower()}-{uuid.uuid4().hex[:8]}@auditlogs.test",
            full_name=f"Test {role}",
            role=role,
            password=PASSWORD,
        )
        if not active:
            user.is_active = False
            user.save(update_fields=["is_active"])
        if mfa:
            TOTPDevice.objects.create(user=user, name="Authenticator", confirmed=True)
        return user

    return _make


@pytest.fixture
def client_for(make_user):
    """A client signed in with password AND a verified MFA device, the only state the API trusts."""

    def _client(user_or_role) -> APIClient:
        user = make_user(user_or_role) if isinstance(user_or_role, str) else user_or_role
        device = TOTPDevice.objects.filter(user=user, confirmed=True).first() or TOTPDevice.objects.create(
            user=user, name="Authenticator", confirmed=True
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
    """Signed in with a password but never passed MFA. Must be refused everywhere."""

    def _client(role: str) -> APIClient:
        client = APIClient()
        client.force_login(make_user(role), backend=MODEL_BACKEND)
        return client

    return _client
