"""The production start-up check refuses unsafe settings (architecture.md 12)."""

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.test import override_settings

from apps.core.checks import enforce_production_settings, production_problems

SAFE = {
    "ENVIRONMENT": "prod",
    "DEBUG": False,
    "SECRET_KEY": "x" * 50,
    "DATABASES": {"default": {"ENGINE": "django.db.backends.postgresql", "NAME": "auditlogs"}},
    "ALLOWED_HOSTS": ["auditlogs.example.ug"],
    "SESSION_COOKIE_SECURE": True,
    "CSRF_COOKIE_SECURE": True,
}


def test_safe_production_settings_pass():
    with override_settings(**SAFE):
        assert production_problems() == []
        enforce_production_settings()


@pytest.mark.parametrize(
    "unsafe",
    [
        {"DEBUG": True},
        {"SECRET_KEY": "dev-only-insecure-key-never-use-in-production"},
        {"DATABASES": {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": "x"}}},
        {"ALLOWED_HOSTS": ["*"]},
        {"SESSION_COOKIE_SECURE": False},
    ],
)
def test_unsafe_production_settings_refuse_to_start(unsafe):
    with override_settings(**{**SAFE, **unsafe}), pytest.raises(ImproperlyConfigured):
        enforce_production_settings()
