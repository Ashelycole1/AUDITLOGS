"""Pieces used by the containers: client IP behind Nginx, database grants, the scheduler."""

from datetime import datetime

import pytest
from django.core.management import call_command
from django.test import RequestFactory, override_settings

from apps.auditlog.models import AuditLog
from apps.core.management.commands.run_scheduler import KAMPALA, Job, next_run
from apps.core.requests import client_ip


def test_client_ip_comes_from_the_proxy_header_when_configured():
    request = RequestFactory().get("/", REMOTE_ADDR="172.18.0.5", HTTP_X_REAL_IP="196.43.130.9")
    with override_settings(CLIENT_IP_HEADER="HTTP_X_REAL_IP"):
        assert client_ip(request) == "196.43.130.9"
    # Without the setting the header is ignored, so a client cannot choose what the log records.
    with override_settings(CLIENT_IP_HEADER=""):
        assert client_ip(request) == "172.18.0.5"


def test_client_ip_falls_back_when_the_header_is_missing():
    request = RequestFactory().get("/", REMOTE_ADDR="172.18.0.5")
    with override_settings(CLIENT_IP_HEADER="HTTP_X_REAL_IP"):
        assert client_ip(request) == "172.18.0.5"


@pytest.mark.django_db
def test_grants_are_a_postgres_step(capsys):
    call_command("apply_db_grants")
    assert "Nothing to do" in capsys.readouterr().out


def test_jobs_run_at_the_next_kampala_time():
    job = Job("verify_audit_chain", hour=1, minute=30)
    before = datetime(2026, 10, 17, 0, 15, tzinfo=KAMPALA)
    after = datetime(2026, 10, 17, 2, 0, tzinfo=KAMPALA)
    assert next_run(job, before) == datetime(2026, 10, 17, 1, 30, tzinfo=KAMPALA)
    assert next_run(job, after) == datetime(2026, 10, 18, 1, 30, tzinfo=KAMPALA)


@pytest.mark.django_db
def test_scheduler_once_runs_the_chain_check(capsys):
    call_command("run_scheduler", "--once")
    assert "verify_audit_chain: ok" in capsys.readouterr().out
    assert AuditLog.objects.filter(action="auditlog.verify").exists()
