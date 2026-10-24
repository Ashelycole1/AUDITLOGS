"""Phase 4 compliance (design.md 8 and 12, owner's choices of 2026-10-24): break-glass access for ICT,
acting CIA, enrolment links, retention and disposal, the breach register and its alerts, and data
subject search and export."""

from datetime import datetime, timedelta
from pathlib import Path

import pytest
from django.conf import settings
from django.core import mail
from django.core.management import call_command
from django.db import models
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.auditlog.models import AuditLog
from apps.compliance import grants
from apps.compliance.models import AccessGrant, BreachRecord, DisposalRecord, GrantStatus
from apps.core.management.commands.run_scheduler import KAMPALA, Job, next_run
from apps.followup import services as followup
from apps.followup.models import Comment, Evidence, FollowUpActivity
from apps.imports.models import ImportBatch
from apps.queries.models import Query
from apps.workflow import services as workflow

from .conftest import PASSWORD, WRONG_PASSWORD

pytestmark = pytest.mark.django_db

REASON = "Written instruction from the CEO, memo 14/2026"


def actions(**filters) -> list[str]:
    return list(AuditLog.objects.filter(**filters).order_by("seq").values_list("action", flat=True))


def url(name: str, **kwargs) -> str:
    return reverse(name, kwargs=kwargs or None)


# Break-glass ------------------------------------------------------------------------------------------


@pytest.fixture
def glass(client_for, make_user):
    """An ICT administrator and a CIA, with helpers to ask for and approve access."""
    ict, cia = make_user("ICT"), make_user("CIA")
    ict_client, cia_client = client_for(ict), client_for(cia)

    def open_access(hours: int = 2) -> dict:
        grant = ict_client.post(
            url("access-requests-list"),
            {"reason": "Investigating a failed backup", "hours": hours},
            format="json",
        )
        assert grant.status_code == 201, grant.content
        approved = cia_client.post(url("access-requests-approve", pk=grant.json()["id"]), {}, format="json")
        assert approved.status_code == 200, approved.content
        return approved.json()

    return ict, ict_client, cia, cia_client, open_access


def test_ict_reads_queries_only_while_a_grant_is_open(glass, make_query, make_user):
    ict, ict_client, _, _, open_access = glass
    query = make_query(assignee=make_user("IA"))
    detail = url("queries-detail", pk=query.pk)
    assert ict_client.get(url("queries-list")).status_code == 403
    assert ict_client.get(detail).status_code == 403

    grant = open_access()
    assert grant["is_active"] is True
    assert ict_client.get(url("queries-list")).json()["results"][0]["reference"] == query.reference
    assert ict_client.get(detail).status_code == 200
    for name in ("queries-history", "queries-evidence", "queries-activities", "queries-revisions"):
        assert ict_client.get(url(name, pk=query.pk)).status_code == 200, name
    assert actions(actor=ict).count("breakglass.read") == 6

    # Read only: nothing can be written, even under the grant.
    note = ict_client.post(
        url("queries-activities", pk=query.pk), {"kind": "Note", "body": "x" * 12}, format="json"
    )
    assert note.status_code == 403
    assert ict_client.patch(detail, {"title": "Changed", "reason": REASON}, format="json").status_code == 403

    # Once it runs out, access ends at once, before the expiry job has even run.
    AccessGrant.objects.filter(pk=grant["id"]).update(expires_at=timezone.now() - timedelta(seconds=1))
    assert ict_client.get(detail).status_code == 403
    assert grants.expire_all()["grants"] == 1
    assert AccessGrant.objects.get(pk=grant["id"]).status == GrantStatus.ENDED
    assert "breakglass.expire" in actions()


def test_grant_covers_only_the_own_organization(glass, make_org, make_user, make_query):
    _, ict_client, _, _, open_access = glass
    other = make_org("Other organisation")
    make_query(reference="OWN/1")
    batch = ImportBatch.objects.create(
        organization=other,
        imported_by=make_user("CIA", organization=other),
        source_filename="x.csv",
        source_file_path="unused",
        source_sha256="0" * 64,
        status="Confirmed",
    )
    foreign = Query.objects.create(
        reference="OTHER/2",
        batch=batch,
        title="Foreign",
        description_original="d",
        description_current="d",
        risk_rating_original="Low",
        risk_rating_current="Low",
        deadline=timezone.localdate(),
        responsible_officer="Someone",
        department="Elsewhere",
    )
    open_access()
    assert ict_client.get(url("queries-detail", pk=foreign.pk)).status_code == 404
    refs = [q["reference"] for q in ict_client.get(url("queries-list")).json()["results"]]
    assert "OTHER/2" not in refs


def test_grant_rules(glass, client_for):
    ict, ict_client, cia, cia_client, open_access = glass
    asked = ict_client.post(url("access-requests-list"), {"reason": "Short", "hours": 2}, format="json")
    assert asked.status_code == 400
    too_long = ict_client.post(
        url("access-requests-list"), {"reason": "A good long reason", "hours": 9}, format="json"
    )
    assert too_long.status_code == 400
    first = ict_client.post(url("access-requests-list"), {"reason": "A good long reason"}, format="json")
    assert first.status_code == 201 and first.json()["hours"] == 2
    again = ict_client.post(url("access-requests-list"), {"reason": "A good long reason"}, format="json")
    assert again.status_code == 409
    # A rejection needs a reason.
    rejected = cia_client.post(
        url("access-requests-reject", pk=first.json()["id"]), {"reason": "no"}, format="json"
    )
    assert rejected.status_code == 400
    rejected = cia_client.post(
        url("access-requests-reject", pk=first.json()["id"]),
        {"reason": "Not needed for a backup issue"},
        format="json",
    )
    assert rejected.json()["status"] == "Rejected"

    grant = open_access()
    ended = ict_client.post(url("access-requests-end", pk=grant["id"]), {}, format="json")
    assert ended.json()["status"] == "Ended"
    assert ict_client.get(url("queries-list")).status_code == 403
    # The CIA sees every request and how many reads were made; ICT sees its own.
    listed = cia_client.get(url("access-requests-list")).json()
    assert {g["status"] for g in listed} == {"Rejected", "Ended"}
    other_ict = client_for("ICT")
    assert other_ict.get(url("access-requests-list")).json() == []


def test_cia_is_told_about_a_break_glass_request(glass):
    _, ict_client, cia, _, _ = glass
    ict_client.post(url("access-requests-list"), {"reason": "Investigating a failed backup"}, format="json")
    from apps.notifications.models import Notification

    assert Notification.objects.filter(recipient=cia, link="/approvals").exists()


# Acting CIA -------------------------------------------------------------------------------------------


def test_ict_makes_a_pia_acting_cia_for_a_set_time(client_for, make_user, make_query):
    ict, pia = client_for("ICT"), make_user("PIA")
    until = timezone.now() + timedelta(days=14)
    granted = ict.post(
        url("users-acting-cia", pk=pia.pk), {"until": until.isoformat(), "reason": REASON}, format="json"
    )
    assert granted.status_code == 200, granted.content
    assert granted.json()["acting_cia_until"] is not None
    assert "user.acting_cia_grant" in actions()

    acting = client_for(pia)
    assert acting.get(url("audit-log")).status_code == 200
    # What the acting CIA does shows on CIA Activity, marked as acting.
    query = make_query(assignee=make_user("IA"))
    acting.patch(
        url("queries-detail", pk=query.pk), {"title": "Corrected title", "reason": REASON}, format="json"
    )
    row = client_for("CEO").get(url("dashboard-cia-activity")).json()[0]
    assert (row["actor"], row["acting"]) == (str(pia.pk), True)

    ended = ict.post(
        url("users-end-acting-cia", pk=pia.pk), {"reason": "The CIA is back from leave"}, format="json"
    )
    assert ended.json()["acting_cia_until"] is None
    assert acting.get(url("audit-log")).status_code == 403


def test_acting_cia_rules(client_for, make_user):
    ict = client_for("ICT")
    soon = (timezone.now() + timedelta(days=3)).isoformat()
    for role in ("IA", "SIA", "CEO"):
        refused = ict.post(
            url("users-acting-cia", pk=make_user(role).pk), {"until": soon, "reason": REASON}, format="json"
        )
        assert refused.status_code == 400, role
    pia = make_user("PIA")
    for until in (timezone.now() - timedelta(hours=1), timezone.now() + timedelta(days=91)):
        refused = ict.post(
            url("users-acting-cia", pk=pia.pk), {"until": until.isoformat(), "reason": REASON}, format="json"
        )
        assert refused.status_code == 400
    assert (
        ict.post(
            url("users-acting-cia", pk=pia.pk), {"until": soon, "reason": "short"}, format="json"
        ).status_code
        == 400
    )


def test_acting_cia_gets_cia_notifications_and_expires_by_itself(make_user):
    from apps.notifications.services import chief_auditors

    pia = make_user("PIA")
    pia.acting_cia_until = timezone.now() + timedelta(hours=1)
    pia.save()
    assert pia in chief_auditors(pia.organization_id)

    pia.acting_cia_until = timezone.now() - timedelta(minutes=1)
    pia.save()
    assert pia not in chief_auditors(pia.organization_id)
    assert grants.expire_all()["acting_cia"] == 1
    pia.refresh_from_db()
    assert pia.acting_cia_until is None
    assert "user.acting_cia_expire" in actions()


# Enrolment links --------------------------------------------------------------------------------------


def test_new_account_gets_a_one_time_link_to_choose_a_password(
    client_for, django_capture_on_commit_callbacks
):
    ict = client_for("ICT")
    with django_capture_on_commit_callbacks(execute=True):
        created = ict.post(
            url("users-list"),
            {"email": "new.person@auditlogs.test", "full_name": "New Person", "role": "IA"},
            format="json",
        )
    assert created.status_code == 201, created.content
    body = created.json()
    assert body["has_password"] is False
    assert body["sent_to"] == "n•••@auditlogs.test"
    link = body["set_password_link"]
    assert any(link in m.body for m in mail.outbox if "new.person@auditlogs.test" in m.to)

    from urllib.parse import parse_qs, urlparse

    params = {k: v[0] for k, v in parse_qs(urlparse(link).query).items()}
    anon = APIClient()
    chosen = anon.post(url("auth-set-password"), {**params, "password": PASSWORD}, format="json")
    assert chosen.status_code == 200
    # The link works once.
    assert (
        anon.post(url("auth-set-password"), {**params, "password": PASSWORD}, format="json").status_code
        == 400
    )


def test_ict_resends_a_link_with_a_reason(client_for, make_user, django_capture_on_commit_callbacks):
    ict_user = make_user("ICT")
    ict = client_for(ict_user)
    person = make_user("PIA")  # already has a password
    assert (
        ict.post(url("users-send-enrolment", pk=person.pk), {"reason": "x"}, format="json").status_code == 400
    )
    with django_capture_on_commit_callbacks(execute=True):
        sent = ict.post(
            url("users-send-enrolment", pk=person.pk),
            {"reason": "Forgot the password, phoned ICT"},
            format="json",
        )
    assert sent.status_code == 200
    assert "user.password_reset_sent" in actions()
    assert "new AuditLogs password" in mail.outbox[-1].body
    # Not for one's own account, and not for a disabled one.
    assert (
        ict.post(url("users-send-enrolment", pk=ict_user.pk), {"reason": REASON}, format="json").status_code
        == 400
    )
    disabled = make_user("IA", active=False)
    assert (
        ict.post(url("users-send-enrolment", pk=disabled.pk), {"reason": REASON}, format="json").status_code
        == 400
    )


# Retention and disposal -------------------------------------------------------------------------------


@pytest.fixture
def closed_query(make_query, make_user):
    """A closed query with a note, a comment and an evidence file, closed three years ago."""
    ia, cia = make_user("IA"), make_user("CIA")
    query = make_query(assignee=ia, status="In Progress", responsible_officer="Jane Akello")
    followup.add_activity(
        query=query, actor=ia, kind="ManagementResponse", body="Jane Akello agreed to fix it"
    )
    followup.add_evidence(query=query, actor=ia, filename="proof.txt", content=b"confidential proof")
    followup.add_comment(query=query, actor=cia, body="Looks complete to me")
    workflow.change_directly(
        query=query, actor=cia, to_status="Closed", reason="Closing after the review meeting"
    )
    models.QuerySet.update(
        Query.objects.filter(pk=query.pk), closed_at=timezone.now() - timedelta(days=3 * 365)
    )
    query.refresh_from_db()
    return query, cia


def set_rule(client, record_type: str, months: int):
    return client.post(
        url("retention-rules-list"),
        {
            "record_type": record_type,
            "retention_months": months,
            "reason": "Retention schedule approved by board",
        },
        format="json",
    )


def test_nothing_is_due_without_a_rule(closed_query, client_for):
    _, cia = closed_query
    client = client_for(cia)
    assert client.post(url("disposals-check")).json() == {"flagged": 0}
    rules = client.get(url("retention-rules-list")).json()
    assert {r["record_type"]: r["rule"] for r in rules} == {"closed_query": None, "import_file": None}


def test_approved_disposal_erases_content_and_keeps_a_stub(
    closed_query, client_for, django_capture_on_commit_callbacks
):
    query, cia = closed_query
    client = client_for(cia)
    assert set_rule(client, "closed_query", 0).status_code == 400
    assert set_rule(client, "closed_query", 24).status_code == 201
    assert client.post(url("disposals-check")).json() == {"flagged": 1}
    # Checking again does not list it twice.
    assert client.post(url("disposals-check")).json() == {"flagged": 0}
    item = client.get(url("disposals-list")).json()[0]
    assert (item["label"], item["status"]) == (query.reference, "Pending")

    path = Evidence.objects.get(query=query).stored_path
    assert Path(path).exists()
    assert (
        client.post(url("disposals-approve", pk=item["id"]), {"reason": "x"}, format="json").status_code
        == 400
    )
    with django_capture_on_commit_callbacks(execute=True):
        done = client.post(
            url("disposals-approve", pk=item["id"]), {"reason": "Past the retention period"}, format="json"
        )
    assert done.status_code == 200, done.content
    assert done.json()["status"] == "Disposed"

    query.refresh_from_db()
    assert query.reference and query.status == "Closed" and query.disposed_at is not None
    assert (query.title, query.description_original, query.responsible_officer) == ("(disposed)", "", "")
    assert FollowUpActivity.objects.get(query=query).body == ""
    assert Comment.objects.get(query=query).body == ""
    assert not Path(path).exists()
    assert Evidence.objects.get(query=query).stored_path == ""
    assert "disposal.approve" in actions(object_id=str(query.pk))

    # The stub can no longer be worked on, reopened, edited or downloaded.
    detail = url("queries-detail", pk=query.pk)
    assert client.patch(detail, {"title": "Back", "reason": REASON}, format="json").status_code == 409
    reopen = client.post(
        url("queries-change-status", pk=query.pk),
        {"to_status": "In Progress", "reason": REASON},
        format="json",
    )
    assert reopen.status_code == 409
    assert (
        client.post(url("queries-comments", pk=query.pk), {"body": "Hello again"}, format="json").status_code
        == 409
    )
    evidence = Evidence.objects.get(query=query)
    assert client.get(url("evidence-download", pk=evidence.pk)).status_code == 409


def test_a_reopened_query_cannot_be_disposed(closed_query, client_for):
    query, cia = closed_query
    client = client_for(cia)
    set_rule(client, "closed_query", 12)
    client.post(url("disposals-check"))
    item = DisposalRecord.objects.get()
    workflow.change_directly(
        query=query, actor=cia, to_status="In Progress", reason="More work found on review"
    )
    refused = client.post(
        url("disposals-approve", pk=item.pk), {"reason": "Past the retention period"}, format="json"
    )
    assert refused.status_code == 409
    query.refresh_from_db()
    assert query.disposed_at is None


def test_a_rejected_candidate_is_kept_and_not_listed_again_for_a_year(closed_query, client_for):
    _, cia = closed_query
    client = client_for(cia)
    set_rule(client, "closed_query", 12)
    client.post(url("disposals-check"))
    item = DisposalRecord.objects.get()
    rejected = client.post(
        url("disposals-reject", pk=item.pk), {"reason": "Still under legal hold"}, format="json"
    )
    assert rejected.json()["status"] == "Rejected"
    assert client.post(url("disposals-check")).json() == {"flagged": 0}
    DisposalRecord.objects.filter(pk=item.pk).update(decided_at=timezone.now() - timedelta(days=366))
    assert client.post(url("disposals-check")).json() == {"flagged": 1}


def test_import_file_disposal_destroys_the_upload(client_for, make_user, django_capture_on_commit_callbacks):
    from apps.imports import services as imports

    cia = make_user("CIA")
    content = (
        b"reference,title,description,risk_rating,deadline,responsible_officer,department\n"
        b"IMP/1,Title,Description,Low,2030-01-31,Officer Name,Finance\n"
    )
    batch = imports.upload(actor=cia, filename="final.csv", content=content)
    imports.confirm(batch_id=batch.pk, actor=cia)
    ImportBatch.objects.filter(pk=batch.pk).update(confirmed_at=timezone.now() - timedelta(days=800))
    path = ImportBatch.objects.get(pk=batch.pk).source_file_path
    client = client_for(cia)
    set_rule(client, "import_file", 24)
    assert client.post(url("disposals-check")).json() == {"flagged": 1}
    item = DisposalRecord.objects.get()
    with django_capture_on_commit_callbacks(execute=True):
        client.post(
            url("disposals-approve", pk=item.pk), {"reason": "Past the retention period"}, format="json"
        )
    batch.refresh_from_db()
    assert batch.source_file_path == "" and not Path(path).exists()
    assert all(row.data == {} for row in batch.rows.all())
    assert client.get(url("imports-original", pk=batch.pk)).status_code == 409
    # The queries it created stay.
    assert Query.objects.get(reference="IMP/1").title == "Title"


def test_disposals_of_another_organization_are_not_found(closed_query, client_for, make_org, make_user):
    _, cia = closed_query
    client = client_for(cia)
    set_rule(client, "closed_query", 12)
    client.post(url("disposals-check"))
    item = DisposalRecord.objects.get()
    outsider = client_for(make_user("CIA", organization=make_org("Other organisation")))
    assert outsider.get(url("disposals-list")).json() == []
    assert (
        outsider.post(url("disposals-approve", pk=item.pk), {"reason": REASON}, format="json").status_code
        == 404
    )


# Breach register --------------------------------------------------------------------------------------


def test_cia_and_ict_keep_the_register(client_for, make_user):
    ict, cia = client_for("ICT"), client_for("CIA")
    made = ict.post(url("breaches-list"), {"description": "Laptop with exports was stolen"}, format="json")
    assert made.status_code == 201
    breach = made.json()
    assert breach["kind"] == "manual" and breach["recorded_by_name"]
    updated = cia.patch(
        url("breaches-detail", pk=breach["id"]),
        {
            "pdpo_notified_at": timezone.now().isoformat(),
            "actions_taken": "Passwords reset",
            "reason": REASON,
        },
        format="json",
    )
    assert updated.status_code == 200 and updated.json()["pdpo_notified_at"]
    assert cia.post(url("breaches-close", pk=breach["id"]), {"reason": "x"}, format="json").status_code == 400
    closed = cia.post(
        url("breaches-close", pk=breach["id"]), {"reason": "Device recovered and wiped"}, format="json"
    )
    assert closed.json()["closed_at"]
    late = ict.patch(
        url("breaches-detail", pk=breach["id"]), {"actions_taken": "More", "reason": REASON}, format="json"
    )
    assert late.status_code == 409
    assert actions(object_type="BreachRecord") == ["breach.record", "breach.update", "breach.close"]


def test_a_locked_account_drafts_a_breach_entry_once(make_user):
    user = make_user("IA")
    cia = make_user("CIA")
    client = APIClient()
    for _ in range(settings.AXES_FAILURE_LIMIT + 2):
        client.post(url("auth-login"), {"email": user.email, "password": WRONG_PASSWORD}, format="json")
    drafts = BreachRecord.objects.filter(kind="lockout", subject_user=user)
    assert drafts.count() == 1 and drafts.get().is_draft
    from apps.notifications.models import Notification

    assert Notification.objects.filter(recipient=cia, link="/compliance").exists()


def test_heavy_downloading_drafts_a_breach_entry(settings, make_user, make_query):
    settings.DOWNLOAD_ALERT_PER_HOUR = 3
    ia = make_user("IA")
    query = make_query(assignee=ia, status="In Progress")
    evidence = followup.add_evidence(query=query, actor=ia, filename="a.txt", content=b"abc")
    for _ in range(2):
        followup.open_evidence(evidence=evidence, actor=ia)
    assert not BreachRecord.objects.filter(kind="downloads").exists()
    followup.open_evidence(evidence=evidence, actor=ia)
    followup.open_evidence(evidence=evidence, actor=ia)
    assert BreachRecord.objects.filter(kind="downloads", subject_user=ia).count() == 1


def test_a_broken_chain_drafts_a_breach_entry_for_every_active_organization(make_user, make_org):
    from django.core.management.base import CommandError
    from django.db import connection

    from apps.auditlog.services import record

    from .test_auditlog import drop_triggers

    make_user("CIA")
    make_org("Second organisation")
    make_org("Waiting organisation", status="Pending")
    entry = record(actor=None, action="test.entry", object_type="X", object_id="1")
    drop_triggers()
    with connection.cursor() as cursor:
        cursor.execute("UPDATE auditlog_auditlog SET reason = 'quietly changed' WHERE seq = %s", [entry.seq])
    with pytest.raises(CommandError):
        call_command("verify_audit_chain")
    drafts = BreachRecord.objects.filter(kind="chain", is_draft=True)
    assert drafts.count() == 2


def test_breaches_of_another_organization_are_not_found(client_for, make_org, make_user):
    breach = (
        client_for("CIA")
        .post(url("breaches-list"), {"description": "Something went wrong"}, format="json")
        .json()
    )
    outsider = client_for(make_user("ICT", organization=make_org("Other organisation")))
    assert outsider.get(url("breaches-list")).json() == []
    assert outsider.get(url("breaches-detail", pk=breach["id"])).status_code == 404


# Data subject requests --------------------------------------------------------------------------------


def test_subject_search_and_export(closed_query, client_for, make_query):
    query, cia = closed_query
    make_query(reference="UNRELATED/1")
    client = client_for(cia)
    assert client.get(url("subject-search"), {"q": "ja"}).status_code == 400
    found = client.get(url("subject-search"), {"q": "akello"}).json()
    assert [q["reference"] for q in found["queries"]] == [query.reference]
    assert "subject.search" in actions()

    exported = client.post(
        url("subject-export"), {"q": "akello", "reason": "Request DSR-2026-03 by J. Akello"}, format="json"
    )
    assert exported.status_code == 200
    assert exported["Content-Type"].startswith("application/vnd.openxmlformats")
    entry = AuditLog.objects.get(action="subject.export")
    assert entry.new_value == {"term": "akello", "rows": 1}


# Scheduler --------------------------------------------------------------------------------------------


def test_interval_and_weekly_jobs():
    every = Job("expire_grants", every_minutes=15)
    assert next_run(every, datetime(2026, 10, 24, 10, 7, tzinfo=KAMPALA)) == datetime(
        2026, 10, 24, 10, 15, tzinfo=KAMPALA
    )
    assert next_run(every, datetime(2026, 10, 24, 10, 45, tzinfo=KAMPALA)) == datetime(
        2026, 10, 24, 11, 0, tzinfo=KAMPALA
    )
    weekly = Job("check_retention", hour=3, weekday=0)
    # 2026-10-24 is a Saturday; the next Monday is the 26th.
    assert next_run(weekly, datetime(2026, 10, 24, 12, 0, tzinfo=KAMPALA)) == datetime(
        2026, 10, 26, 3, 0, tzinfo=KAMPALA
    )
    assert next_run(weekly, datetime(2026, 10, 26, 4, 0, tzinfo=KAMPALA)) == datetime(
        2026, 11, 2, 3, 0, tzinfo=KAMPALA
    )
