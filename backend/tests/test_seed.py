"""The demo-account seed is for development and staging only (system.md 4.10)."""

import pytest
from django.core.management import CommandError, call_command
from django.test import override_settings

from apps.accounts.models import User

pytestmark = pytest.mark.django_db


def test_seed_refuses_production():
    with override_settings(ENVIRONMENT="prod"), pytest.raises(CommandError):
        call_command("seed_dev_users")
    assert not User.objects.exists()


def test_staging_seed_needs_a_chosen_password(monkeypatch):
    monkeypatch.delenv("DEV_SEED_PASSWORD", raising=False)
    with override_settings(ENVIRONMENT="staging"), pytest.raises(CommandError, match="DEV_SEED_PASSWORD"):
        call_command("seed_dev_users")


def test_if_enabled_does_nothing_unless_switched_on(monkeypatch):
    monkeypatch.delenv("SEED_DEMO_USERS", raising=False)
    call_command("seed_dev_users", "--if-enabled")
    assert not User.objects.exists()

    monkeypatch.setenv("SEED_DEMO_USERS", "true")
    monkeypatch.setenv("DEV_SEED_PASSWORD", "x" * 16)
    with override_settings(ENVIRONMENT="staging"):
        call_command("seed_dev_users", "--if-enabled")
        call_command("seed_dev_users", "--if-enabled")  # runs on every start: must not duplicate
    assert User.objects.count() == 7
