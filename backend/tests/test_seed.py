"""The demo-account seed is for development and staging only (system.md 4.10)."""

import pytest
from django.core.management import CommandError, call_command
from django.test import override_settings
from django.utils import timezone

from apps.accounts.models import User
from apps.auditlog.services import verify_chain
from apps.queries.management.commands.seed_dev_queries import DEMO_QUERIES
from apps.queries.models import Query

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
    # Eight people of the demo organization, and the platform's System Administrator.
    assert User.objects.count() == 9
    assert User.objects.filter(organization__isnull=True).get().role == "SYS"
    assert User.objects.exclude(role="SYS").values("organization").distinct().count() == 1


def test_query_seed_needs_the_demo_accounts():
    with pytest.raises(CommandError, match="seed_dev_users"):
        call_command("seed_dev_queries")


def test_query_seed_refuses_production():
    with override_settings(ENVIRONMENT="prod"), pytest.raises(CommandError):
        call_command("seed_dev_queries")


def test_query_seed_walks_the_workflow_once(monkeypatch, file_storage):
    monkeypatch.setenv("DEV_SEED_PASSWORD", "x" * 16)
    call_command("seed_dev_users")
    call_command("seed_dev_queries")
    call_command("seed_dev_queries")  # a second run changes nothing

    assert Query.objects.count() == len(DEMO_QUERIES)
    statuses = set(Query.objects.values_list("status", flat=True))
    assert statuses == {
        "Imported",
        "Assigned",
        "In Progress",
        "Proposed for Closure",
        "Closed",
        "Returned",
        "Kept in View",
    }
    assert Query.objects.filter(deadline__lt=timezone.localdate()).exclude(status="Closed").exists()
    assert verify_chain().ok
