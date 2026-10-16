"""CIA edits, assignment, follow-up and evidence, with IA isolation on every route (design.md 6 and 7)."""

from pathlib import Path

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.auditlog.models import AuditLog
from apps.followup.models import Evidence, FollowUpActivity
from apps.queries.models import Query, QueryRevision, Status

pytestmark = pytest.mark.django_db

REASON = "Correction agreed at the audit committee on 10 October"


def assign(cia, query, ia, reason=""):
    return cia.post(
        reverse("queries-assign", kwargs={"pk": query.pk}),
        {"assignee": str(ia.user.pk), "reason": reason},
        format="json",
    )


def test_cia_edit_keeps_the_original_and_records_a_revision(client_for, make_query):
    cia = client_for("CIA")
    query = make_query()
    url = reverse("queries-detail", kwargs={"pk": query.pk})
    assert (
        cia.patch(url, {"risk_rating_current": "High"}, format="json").status_code == 400
    )  # reason required

    response = cia.patch(
        url,
        {"risk_rating_current": "High", "description_current": "Corrected text", "reason": REASON},
        format="json",
    )
    body = response.json()
    assert (body["risk_rating_current"], body["risk_rating_original"]) == ("High", "Medium")
    assert body["description_original"] == query.description_original
    assert body["description_current"] == "Corrected text"
    assert set(QueryRevision.objects.filter(query=query).values_list("field", flat=True)) == {
        "risk_rating_current",
        "description_current",
    }
    entry = AuditLog.objects.filter(action="query.edit").get()
    assert entry.old_value["risk_rating_current"] == "Medium" and entry.reason == REASON

    revisions = cia.get(reverse("queries-revisions", kwargs={"pk": query.pk})).json()
    assert {r["field"] for r in revisions} == {"risk_rating_current", "description_current"}


def test_reassignment_needs_a_reason_and_moves_access(client_for, make_user, make_query):
    cia = client_for("CIA")
    first, second = client_for(make_user("IA")), client_for(make_user("IA"))
    query = make_query()
    assert assign(cia, query, first).json()["status"] == Status.ASSIGNED
    first.post(
        reverse("queries-activities", kwargs={"pk": query.pk}),
        {"kind": "Note", "body": "Started."},
        format="json",
    )

    assert assign(cia, query, second).status_code == 409  # no reason
    assert assign(cia, query, second, REASON).status_code == 200

    # The old IA loses access at once; the new IA sees the whole history.
    assert first.get(reverse("queries-detail", kwargs={"pk": query.pk})).status_code == 404
    history = second.get(reverse("queries-history", kwargs={"pk": query.pk})).json()
    assert [h["action"] for h in history][:3] == ["query.assign", "status.change", "activity.note"]
    assert AuditLog.objects.filter(action="query.reassign", reason=REASON).exists()


def test_only_active_auditors_can_be_assigned(client_for, make_user, make_query):
    cia = client_for("CIA")
    query = make_query()
    for user in (make_user("PIA"), make_user("IA", active=False)):
        response = cia.post(
            reverse("queries-assign", kwargs={"pk": query.pk}), {"assignee": str(user.pk)}, format="json"
        )
        assert response.status_code == 409


def test_bulk_assign_is_all_or_nothing(client_for, make_user, make_query):
    cia, ia = client_for("CIA"), client_for(make_user("IA"))
    open_query, closed_query = make_query(), make_query(status=Status.CLOSED)
    url = reverse("queries-bulk-assign")
    response = cia.post(
        url,
        {"queries": [str(open_query.pk), str(closed_query.pk)], "assignee": str(ia.user.pk)},
        format="json",
    )
    assert response.status_code == 409
    open_query.refresh_from_db()
    assert open_query.current_assignee is None

    other = make_query()
    response = cia.post(
        url, {"queries": [str(open_query.pk), str(other.pk)], "assignee": str(ia.user.pk)}, format="json"
    )
    assert response.json() == {"assigned": 2}


def test_cia_follow_up_does_not_change_status(client_for, make_user, make_query):
    cia, ia = client_for("CIA"), client_for(make_user("IA"))
    query = make_query()
    assign(cia, query, ia)
    cia.post(
        reverse("queries-activities", kwargs={"pk": query.pk}),
        {"kind": "Note", "body": "Spoke to HR."},
        format="json",
    )
    query.refresh_from_db()
    assert query.status == Status.ASSIGNED


def test_saved_follow_up_cannot_be_edited(client_for, make_user, make_query):
    cia, ia = client_for("CIA"), client_for(make_user("IA"))
    query = make_query()
    assign(cia, query, ia)
    ia.post(
        reverse("queries-activities", kwargs={"pk": query.pk}),
        {"kind": "Note", "body": "First."},
        format="json",
    )
    note = FollowUpActivity.objects.get()
    note.body = "Changed"
    with pytest.raises(PermissionError):
        note.save()
    with pytest.raises(PermissionError):
        FollowUpActivity.objects.update(body="Changed")


def test_closed_queries_take_no_more_follow_up(client_for, make_query):
    cia = client_for("CIA")
    query = make_query(status=Status.CLOSED)
    response = cia.post(
        reverse("queries-activities", kwargs={"pk": query.pk}),
        {"kind": "Note", "body": "Late note."},
        format="json",
    )
    assert response.status_code == 409


def test_evidence_is_encrypted_and_comes_back_intact(client_for, make_user, make_query):
    cia, ia = client_for("CIA"), client_for(make_user("IA"))
    query = make_query()
    assign(cia, query, ia)
    content = b"%PDF-1.7 bank reconciliations July to September"
    response = ia.post(
        reverse("queries-evidence", kwargs={"pk": query.pk}),
        {"file": SimpleUploadedFile("recs.pdf", content)},
        format="multipart",
    )
    assert response.status_code == 201
    item = Evidence.objects.get()
    assert content not in Path(item.stored_path).read_bytes()

    download = cia.get(reverse("evidence-download", kwargs={"pk": item.pk}))
    assert download.status_code == 200
    assert download.content == content
    assert download["Content-Disposition"] == 'attachment; filename="recs.pdf"'
    assert download["X-Content-Type-Options"] == "nosniff"
    assert AuditLog.objects.filter(action="evidence.download").count() == 1


def test_tampered_evidence_is_refused(client_for, make_user, make_query):
    cia, ia = client_for("CIA"), client_for(make_user("IA"))
    query = make_query()
    assign(cia, query, ia)
    ia.post(
        reverse("queries-evidence", kwargs={"pk": query.pk}),
        {"file": SimpleUploadedFile("a.txt", b"original")},
        format="multipart",
    )
    item = Evidence.objects.get()
    Path(item.stored_path).write_bytes(b"not what was stored")
    response = cia.get(reverse("evidence-download", kwargs={"pk": item.pk}))
    assert response.status_code == 409
    assert "Tell ICT" in response.json()["detail"]


def test_evidence_type_and_size_are_checked(client_for, make_user, make_query, settings):
    cia, ia = client_for("CIA"), client_for(make_user("IA"))
    query = make_query()
    assign(cia, query, ia)
    url = reverse("queries-evidence", kwargs={"pk": query.pk})
    assert ia.post(url, {"file": SimpleUploadedFile("run.exe", b"MZ")}, format="multipart").status_code == 400
    settings.EVIDENCE_MAX_BYTES = 10
    assert (
        ia.post(url, {"file": SimpleUploadedFile("big.txt", b"x" * 11)}, format="multipart").status_code
        == 400
    )
    assert not Evidence.objects.exists()


@pytest.mark.parametrize(
    ("name", "method", "data"),
    [
        ("queries-detail", "get", None),
        ("queries-revisions", "get", None),
        ("queries-history", "get", None),
        ("queries-activities", "get", None),
        ("queries-activities", "post", {"kind": "Note", "body": "Sneaky"}),
        ("queries-evidence", "get", None),
        ("queries-propose-status", "post", {"reason": "Trying to close another IA's query"}),
    ],
)
def test_an_ia_cannot_reach_another_ias_query(name, method, data, client_for, make_user, make_query):
    cia, owner, intruder = client_for("CIA"), client_for(make_user("IA")), client_for(make_user("IA"))
    query = make_query()
    assign(cia, query, owner)
    response = getattr(intruder, method)(reverse(name, kwargs={"pk": query.pk}), data or {}, format="json")
    assert response.status_code == 404
    assert not FollowUpActivity.objects.filter(body="Sneaky").exists()


def test_an_ia_cannot_download_another_ias_evidence(client_for, make_user, make_query):
    cia, owner, intruder = client_for("CIA"), client_for(make_user("IA")), client_for(make_user("IA"))
    query = make_query()
    assign(cia, query, owner)
    owner.post(
        reverse("queries-evidence", kwargs={"pk": query.pk}),
        {"file": SimpleUploadedFile("a.txt", b"secret")},
        format="multipart",
    )
    item = Evidence.objects.get()
    assert intruder.get(reverse("evidence-download", kwargs={"pk": item.pk})).status_code == 404
    assert Query.objects.get(pk=query.pk).current_assignee_id == owner.user.pk
