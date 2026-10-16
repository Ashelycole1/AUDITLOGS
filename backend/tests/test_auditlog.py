"""Hash chain, append-only enforcement and the tamper test (design.md 10, architecture.md 11)."""

import pytest
from django.core.management import call_command
from django.db import DatabaseError, connection, transaction
from django.urls import reverse

from apps.auditlog.models import AppendOnlyError, AuditLog
from apps.auditlog.services import GENESIS, record, verify_chain

pytestmark = pytest.mark.django_db


def write(n: int, actor=None) -> list[AuditLog]:
    return [
        record(
            actor=actor,
            action="test.event",
            object_type="Thing",
            object_id=i,
            old={"n": i - 1},
            new={"n": i, "note": "Ünïcode ✓"},
        )
        for i in range(n)
    ]


def drop_triggers() -> None:
    """Simulate someone with database superuser rights, who can get past the triggers."""
    with connection.cursor() as cursor:
        if connection.vendor == "postgresql":
            cursor.execute("ALTER TABLE auditlog_auditlog DISABLE TRIGGER auditlog_no_update_delete")
        else:
            cursor.execute("DROP TRIGGER auditlog_no_update")
            cursor.execute("DROP TRIGGER auditlog_no_delete")


def test_entries_are_chained_from_genesis():
    first, second, third = write(3)
    assert first.prev_hash == GENESIS
    assert second.prev_hash == first.entry_hash
    assert third.prev_hash == second.entry_hash
    assert [e.seq for e in (first, second, third)] == [1, 2, 3]
    assert verify_chain().ok and verify_chain().checked == 3


def test_entries_record_actor_and_role(make_user):
    cia = make_user("CIA")
    entry = record(
        actor=cia,
        action="test.event",
        object_type="Thing",
        object_id="x",
        reason="Because the record says so",
    )
    entry = AuditLog.objects.get(pk=entry.pk)
    assert (entry.actor_id, entry.actor_role, entry.reason) == (cia.pk, "CIA", "Because the record says so")


def test_application_code_cannot_change_or_remove_entries():
    entry = write(1)[0]
    entry.reason = "edited"
    with pytest.raises(AppendOnlyError):
        entry.save()
    with pytest.raises(AppendOnlyError):
        entry.delete()
    with pytest.raises(AppendOnlyError):
        AuditLog.objects.filter(pk=entry.pk).update(reason="edited")
    with pytest.raises(AppendOnlyError):
        AuditLog.objects.all().delete()


def test_database_refuses_update_and_delete():
    entry = write(1)[0]
    with pytest.raises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("UPDATE auditlog_auditlog SET reason = 'edited' WHERE seq = %s", [entry.seq])
    with pytest.raises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("DELETE FROM auditlog_auditlog WHERE seq = %s", [entry.seq])
    assert AuditLog.objects.get(pk=entry.pk).reason == ""


def test_tampering_with_an_entry_breaks_verification():
    write(5)
    drop_triggers()
    with connection.cursor() as cursor:
        cursor.execute("UPDATE auditlog_auditlog SET reason = 'quietly changed' WHERE seq = 3")
    result = verify_chain()
    assert not result.ok
    assert result.broken_at == 3


def test_removing_an_entry_breaks_verification():
    write(5)
    drop_triggers()
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM auditlog_auditlog WHERE seq = 2")
    assert verify_chain().broken_at == 3


def test_cia_can_read_and_filter_the_log(client_for):
    cia = client_for("CIA")
    write(3)
    record(actor=None, action="other.event", object_type="Other", object_id="1")
    response = cia.get(reverse("audit-log"), {"action": "test."})
    assert response.status_code == 200
    assert response.json()["count"] == 3
    assert response.json()["results"][0]["seq"] == 3


def test_verify_endpoint_returns_counts_only_and_is_logged(client_for):
    write(4)
    response = client_for("ICT").post(reverse("audit-log-verify"))
    assert response.json() == {"ok": True, "checked": 4, "broken_at": None}
    assert AuditLog.objects.order_by("-seq").first().action == "auditlog.verify"


def test_nightly_command(capsys):
    write(2)
    call_command("verify_audit_chain")
    assert "intact" in capsys.readouterr().out
    assert verify_chain().ok
