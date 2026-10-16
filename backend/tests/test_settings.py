"""The production start-up check refuses unsafe settings (architecture.md 12)."""

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.test import override_settings

from apps.core.checks import enforce_production_settings, production_problems

SAFE = {
    "ENVIRONMENT": "prod",
    "DEBUG": False,
    "SECRET_KEY_FROM_ENV": True,
    "DATABASES": {"default": {"ENGINE": "django.db.backends.postgresql", "NAME": "auditlogs"}},
    "ALLOWED_HOSTS": ["auditlogs.example.ug"],
    "SESSION_COOKIE_SECURE": True,
    "CSRF_COOKIE_SECURE": True,
    "EMAIL_HOST": "mail.example.ug",
    "EMAIL_BACKEND": "django.core.mail.backends.smtp.EmailBackend",
    "FILE_ENCRYPTION_KEY": b"k" * 44,
}


def test_safe_production_settings_pass():
    with override_settings(**SAFE):
        assert production_problems() == []
        enforce_production_settings()


@pytest.mark.parametrize(
    "unsafe",
    [
        {"DEBUG": True},
        {"SECRET_KEY_FROM_ENV": False},
        {"EMAIL_HOST": ""},
        {"FILE_ENCRYPTION_KEY": None},
        {"DATABASES": {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": "x"}}},
        {"ALLOWED_HOSTS": ["*"]},
        {"SESSION_COOKIE_SECURE": False},
    ],
)
def test_unsafe_production_settings_refuse_to_start(unsafe):
    with override_settings(**{**SAFE, **unsafe}), pytest.raises(ImproperlyConfigured):
        enforce_production_settings()
