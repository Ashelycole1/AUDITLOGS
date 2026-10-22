"""The owner's changes of 2026-10-22: the SIA role and rank, PIA assignment and review, reassignment
and export approval by the CIA, CIA and CEO comments, and email notifications."""

import pytest
from django.core import mail
from django.urls import reverse

from apps.accounts.models import can_assign
from apps.auditlog.models import AuditLog
from apps.auditlog.services import verify_chain
from apps.notifications.models import Notification
from apps.queries.models import Query, Status
from apps.workflow.models import ExportRequest, ReassignmentRequest

pytestmark = pytest.mark.django_db

REASON = "Workload moved after the team review this week"


def verified(user):
    user.is_verified = lambda: True
    return user


def actions(query) -> list[str]:
    return list(
        AuditLog.objects.filter(object_id=str(query.pk)).order_by("seq").values_list("action", flat=True)
    )


def assign_url(query):
    return reverse("queries-assign", kwargs={"pk": query.pk})


def set_status(query, status):
    query.status = status
    query._workflow_change = True
    query.save()
    return query


def notes_for(user) -> list[str]:
    """The headlines of this person's in-app notifications, oldest first."""
    rows = Notification.objects.filter(recipient=user).order_by("created_at")
    return list(rows.values_list("headline", flat=True))


# Rank and assignment ------------------------------------------------------------------------


def test_assignment_flows_down_the_chain(make_user):
    ia, sia, pia, cia, ceo = (make_user(r) for r in ("IA", "SIA", "PIA", "CIA", "CEO"))
    assert can_assign(pia, ia) and can_assign(pia, sia)
    assert can_assign(cia, ia) and can_assign(cia, sia)
    # Only auditors receive queries, and never from someone ranked at or below them.
    assert not can_assign(cia, pia)
    assert not can_assign(sia, sia)
    assert not can_assign(ia, ia)
    assert not can_assign(ceo, ia)
    assert not can_assign(pia, make_user("SIA", active=False))


def test_sia_cannot_assign_until_its_permissions_are_agreed(client_for, make_user, make_query):
    # The rank allows SIA to IA, but the client has not yet defined SIA permissions (changes doc 9.3).
    response = client_for("SIA").post(
        assign_url(make_query()), {"assignee": str(make_user("IA").pk)}, format="json"
    )
    assert response.status_code == 403


def test_pia_assigns_ia_and_sia_and_they_are_emailed(
    client_for, make_user, make_query, django_capture_on_commit_callbacks
):
    pia = client_for("PIA")
    ia, sia = make_user("IA"), make_user("SIA")
    first, second = make_query(), make_query()
    with django_capture_on_commit_callbacks(execute=True):
        assert (
            pia.post(assign_url(first), {"assignee": str(ia.pk)}, format="json").json()["status"]
            == "Assigned"
        )
        assert pia.post(assign_url(second), {"assignee": str(sia.pk)}, format="json").status_code == 200
    assert notes_for(ia) == [f"{first.reference} assigned to you"]
    assert notes_for(sia) == [f"{second.reference} assigned to you"]
    # Reference and link only: no title, reasons or comments in email (design.md 9).
    note = Notification.objects.get(recipient=ia)
    assert (note.query_id, note.link) == (first.pk, f"/queries/{first.pk}")
    assert first.title not in note.headline + note.body
    assert mail.outbox == []  # in-app only unless NOTIFY_BY_EMAIL is switched on


def test_pia_cannot_assign_outside_the_auditors(client_for, make_user, make_query):
    pia = client_for("PIA")
    for role in ("PIA", "CIA", "CEO", "ICT"):
        response = pia.post(assign_url(make_query()), {"assignee": str(make_user(role).pk)}, format="json")
        assert response.status_code == 409


def test_auditor_list_offers_ia_and_sia(client_for, make_user):
    ia, sia = make_user("IA"), make_user("SIA")
    make_user("PIA")
    make_user("IA", active=False)
    for role in ("PIA", "CIA"):
        rows = client_for(role).get(reverse("auditors")).json()
        assert {(r["id"], r["role"]) for r in rows} == {(str(ia.pk), "IA"), (str(sia.pk), "SIA")}


def test_sia_sees_and_works_only_own_queries(client_for, make_user, make_query):
    sia_user = make_user("SIA")
    sia = client_for(sia_user)
    mine = make_query(assignee=sia_user, status=Status.ASSIGNED)
    theirs = make_query(assignee=make_user("IA"), status=Status.ASSIGNED)
    ids = {row["id"] for row in sia.get(reverse("queries-list")).json()["results"]}
    assert ids == {str(mine.pk)}
    assert sia.get(reverse("queries-detail", kwargs={"pk": theirs.pk})).status_code == 404

    body = {"kind": "ManagementResponse", "body": "Management agreed to fix it."}
    assert (
        sia.post(reverse("queries-activities", kwargs={"pk": mine.pk}), body, format="json").status_code
        == 201
    )
    mine.refresh_from_db()
    assert mine.status == Status.IN_PROGRESS
    proposed = sia.post(
        reverse("queries-propose-status", kwargs={"pk": mine.pk}), {"reason": REASON}, format="json"
    )
    assert proposed.json()["status"] == Status.PROPOSED


# Reassignment approval ------------------------------------------------------------------------


def test_pia_reassignment_waits_for_cia_approval(
    client_for, make_user, make_query, django_capture_on_commit_callbacks
):
    pia, cia = client_for("PIA"), client_for("CIA")
    old, new = make_user("IA"), make_user("SIA")
    query = make_query(assignee=old, status=Status.IN_PROGRESS)

    with django_capture_on_commit_callbacks(execute=True):
        detail = pia.post(
            assign_url(query), {"assignee": str(new.pk), "reason": REASON}, format="json"
        ).json()
    assert detail["status"] == Status.PENDING_APPROVAL
    assert detail["current_assignee"] == str(old.pk)  # the current auditor keeps it meanwhile
    assert detail["pending_reassignment"]["to_assignee_name"] == new.full_name
    assert notes_for(cia.user) == [f"{query.reference} reassignment waiting for your approval"]

    request = ReassignmentRequest.objects.get(query=query)
    listed = cia.get(reverse("reassignment-requests-list"), {"decision": "Pending"}).json()["results"]
    assert [r["id"] for r in listed] == [str(request.pk)]

    Notification.objects.all().delete()
    with django_capture_on_commit_callbacks(execute=True):
        approve = reverse("reassignment-requests-approve", kwargs={"pk": request.pk})
        assert cia.post(approve, {}, format="json").json()["decision"] == "Approved"
    query.refresh_from_db()
    assert (query.status, query.current_assignee_id) == (Status.ASSIGNED, new.pk)
    assert notes_for(pia.user) == [f"{query.reference} reassignment approved"]
    assert notes_for(new) == [f"{query.reference} reassigned to you"]
    # The old auditor loses access at once.
    assert client_for(old).get(reverse("queries-detail", kwargs={"pk": query.pk})).status_code == 404
    assert actions(query) == ["reassign.request", "status.change", "reassign.approve", "status.change"]
    assert verify_chain().ok


def test_rejected_reassignment_returns_to_where_it_was(client_for, make_user, make_query):
    pia, cia = client_for("PIA"), client_for("CIA")
    old = make_user("IA")
    query = make_query(assignee=old, status=Status.RETURNED)
    pia.post(assign_url(query), {"assignee": str(make_user("IA").pk), "reason": REASON}, format="json")
    request = ReassignmentRequest.objects.get(query=query)
    reject = reverse("reassignment-requests-reject", kwargs={"pk": request.pk})
    assert cia.post(reject, {"reason": ""}, format="json").status_code == 409
    assert cia.post(reject, {"reason": "Keep it with the current auditor"}, format="json").status_code == 200
    query.refresh_from_db()
    assert (query.status, query.current_assignee_id) == (Status.RETURNED, old.pk)


def test_reassignment_rules(client_for, make_user, make_query):
    pia, cia = client_for("PIA"), client_for("CIA")
    ia = make_user("IA")
    query = make_query(assignee=ia, status=Status.ASSIGNED)
    other = str(make_user("IA").pk)
    # A reason is needed, and the PIA cannot reassign without approval through bulk assign either.
    assert pia.post(assign_url(query), {"assignee": other}, format="json").status_code == 409
    bulk = {"queries": [str(query.pk)], "assignee": other, "reason": REASON}
    assert pia.post(reverse("queries-bulk-assign"), bulk, format="json").status_code == 409
    # One request at a time; while it waits, nobody reassigns or changes the status directly.
    assert (
        pia.post(assign_url(query), {"assignee": other, "reason": REASON}, format="json").status_code == 200
    )
    assert (
        pia.post(assign_url(query), {"assignee": other, "reason": REASON}, format="json").status_code == 409
    )
    assert (
        cia.post(assign_url(query), {"assignee": other, "reason": REASON}, format="json").status_code == 409
    )
    direct = {"to_status": "Closed", "reason": REASON}
    assert (
        cia.post(reverse("queries-change-status", kwargs={"pk": query.pk}), direct, format="json").status_code
        == 409
    )


def test_cia_reassigns_directly(client_for, make_user, make_query, django_capture_on_commit_callbacks):
    cia = client_for("CIA")
    new = make_user("SIA")
    query = make_query(assignee=make_user("IA"), status=Status.IN_PROGRESS)
    with django_capture_on_commit_callbacks(execute=True):
        detail = cia.post(
            assign_url(query), {"assignee": str(new.pk), "reason": REASON}, format="json"
        ).json()
    assert (detail["status"], detail["current_assignee"]) == (Status.IN_PROGRESS, str(new.pk))
    assert notes_for(new) == [f"{query.reference} reassigned to you"]
    assert not ReassignmentRequest.objects.exists()


# PIA review of closure proposals -----------------------------------------------------------------


def propose(client_for, make_user, make_query):
    ia_user = make_user("IA")
    ia = client_for(ia_user)
    query = make_query(assignee=ia_user, status=Status.IN_PROGRESS)
    ia.post(
        reverse("queries-activities", kwargs={"pk": query.pk}),
        {"kind": "ManagementResponse", "body": "Done."},
        format="json",
    )
    ia.post(reverse("queries-propose-status", kwargs={"pk": query.pk}), {"reason": REASON}, format="json")
    return query, query.status_requests.get(), ia


def test_pia_returns_a_proposal(client_for, make_user, make_query, django_capture_on_commit_callbacks):
    pia = client_for("PIA")
    query, request, ia = propose(client_for, make_user, make_query)
    url = reverse("status-requests-reject", kwargs={"pk": request.pk})
    assert pia.post(url, {"reason": ""}, format="json").status_code == 409
    with django_capture_on_commit_callbacks(execute=True):
        body = pia.post(url, {"reason": "The bank statement is missing"}, format="json").json()
    assert body["decided_status"] == Status.RETURNED
    query.refresh_from_db()
    assert query.status == Status.RETURNED
    assert notes_for(ia.user) == [f"{query.reference} returned to you"]
    assert "The bank statement is missing" not in Notification.objects.get(recipient=ia.user).body


def test_pia_keeps_a_proposal_in_view_and_work_resumes(
    client_for, make_user, make_query, django_capture_on_commit_callbacks
):
    pia = client_for("PIA")
    query, request, ia = propose(client_for, make_user, make_query)
    url = reverse("status-requests-keep-in-view", kwargs={"pk": request.pk})
    with django_capture_on_commit_callbacks(execute=True):
        assert (
            pia.post(url, {"reason": "Watch until the new system is live"}, format="json").status_code == 200
        )
    query.refresh_from_db()
    assert query.status == Status.KEPT_IN_VIEW
    assert notes_for(ia.user) == [f"{query.reference} kept in view"]
    assert "status.keep" in actions(query)

    ia.post(
        reverse("queries-activities", kwargs={"pk": query.pk}),
        {"kind": "Note", "body": "Live now."},
        format="json",
    )
    query.refresh_from_db()
    assert query.status == Status.IN_PROGRESS


def test_only_the_cia_closes(client_for, make_user, make_query):
    query, request, _ = propose(client_for, make_user, make_query)
    approve = reverse("status-requests-approve", kwargs={"pk": request.pk})
    assert client_for("PIA").post(approve, {}, format="json").status_code == 403
    assert client_for("CIA").post(approve, {}, format="json").json()["decided_status"] == Status.CLOSED


def test_cia_can_keep_in_view_too(client_for, make_user, make_query):
    query, request, _ = propose(client_for, make_user, make_query)
    keep = reverse("status-requests-keep-in-view", kwargs={"pk": request.pk})
    response = client_for("CIA").post(keep, {"reason": REASON}, format="json")
    assert response.json()["decided_status"] == "Kept in View"


# Exports ------------------------------------------------------------------------------------


def test_pia_export_needs_cia_approval(client_for, make_user, make_query, django_capture_on_commit_callbacks):
    pia, cia = client_for("PIA"), client_for("CIA")
    make_query(reference="IA/2026/301", risk_rating_current="High", title="=HYPERLINK(1)")
    make_query(reference="IA/2026/302")

    with django_capture_on_commit_callbacks(execute=True):
        response = pia.post(
            reverse("export-requests-list"),
            {"filters": {"risk": "High"}, "reason": "Board pack for the audit committee"},
            format="json",
        )
    assert response.status_code == 201
    item = ExportRequest.objects.get()
    assert notes_for(cia.user) == ["Export waiting for your approval"]

    download = reverse("export-requests-download", kwargs={"pk": item.pk})
    assert pia.get(download).status_code == 409

    with django_capture_on_commit_callbacks(execute=True):
        assert (
            cia.post(
                reverse("export-requests-approve", kwargs={"pk": item.pk}), {}, format="json"
            ).status_code
            == 200
        )
    assert notes_for(pia.user) == ["Export approved"]

    response = pia.get(download)
    assert response.status_code == 200
    text = response.content.decode("utf-8-sig")
    assert "IA/2026/301" in text and "IA/2026/302" not in text  # the request's filters apply
    assert "'=HYPERLINK(1)" in text  # no spreadsheet formulas
    actions_logged = set(
        AuditLog.objects.filter(object_type="ExportRequest").values_list("action", flat=True)
    )
    assert actions_logged == {"export.request", "export.approve", "export.download"}


def test_export_requests_are_private_to_the_requester(client_for, make_user):
    owner, other = client_for("PIA"), client_for("PIA")
    owner.post(reverse("export-requests-list"), {"reason": "Quarterly status report"}, format="json")
    item = ExportRequest.objects.get()
    assert other.get(reverse("export-requests-list")).json()["results"] == []
    assert other.get(reverse("export-requests-download", kwargs={"pk": item.pk})).status_code == 404
    assert len(client_for("CIA").get(reverse("export-requests-list")).json()["results"]) == 1


def test_export_request_rules(client_for):
    pia, cia = client_for("PIA"), client_for("CIA")
    url = reverse("export-requests-list")
    assert pia.post(url, {"reason": "short"}, format="json").status_code == 409
    assert (
        pia.post(
            url, {"filters": {"evil": "1"}, "reason": "Quarterly status report"}, format="json"
        ).status_code
        == 400
    )
    assert pia.post(url, {"reason": "Quarterly status report"}, format="json").status_code == 201
    assert pia.post(url, {"reason": "Another one at once"}, format="json").status_code == 409
    item = ExportRequest.objects.get()
    reject = reverse("export-requests-reject", kwargs={"pk": item.pk})
    assert cia.post(reject, {"reason": ""}, format="json").status_code == 409
    assert cia.post(reject, {"reason": "Use the dashboard instead"}, format="json").status_code == 200
    assert pia.get(reverse("export-requests-download", kwargs={"pk": item.pk})).status_code == 409


def test_cia_exports_directly_and_it_is_logged(client_for, make_query):
    make_query(reference="IA/2026/310")
    response = client_for("CIA").get(reverse("queries-export"))
    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/csv")
    assert "IA/2026/310" in response.content.decode("utf-8-sig")
    assert AuditLog.objects.filter(action="export.queries").exists()


# Comments -------------------------------------------------------------------------------------


def test_cia_and_ceo_comment_and_the_auditor_reads(
    client_for, make_user, make_query, django_capture_on_commit_callbacks
):
    ia_user = make_user("IA")
    query = make_query(assignee=ia_user, status=Status.IN_PROGRESS)
    url = reverse("queries-comments", kwargs={"pk": query.pk})
    with django_capture_on_commit_callbacks(execute=True):
        assert (
            client_for("CIA").post(url, {"body": "Please add the bank letter."}, format="json").status_code
            == 201
        )
        assert client_for("CEO").post(url, {"body": "Who signs this off?"}, format="json").status_code == 201
    rows = client_for(ia_user).get(url).json()
    assert [(r["author_role"], r["body"]) for r in rows] == [
        ("CIA", "Please add the bank letter."),
        ("CEO", "Who signs this off?"),
    ]
    assert notes_for(ia_user) == [
        f"{query.reference} new comment from the CIA",
        f"{query.reference} new comment from the CEO",
    ]
    assert actions(query).count("comment.add") == 2
    # Commenting changes nothing on the query.
    query.refresh_from_db()
    assert query.status == Status.IN_PROGRESS


def test_comments_follow_the_query_scope(client_for, make_user, make_query):
    query = make_query(assignee=make_user("IA"))
    url = reverse("queries-comments", kwargs={"pk": query.pk})
    assert client_for("IA").get(url).status_code == 404
    assert client_for("SIA").get(url).status_code == 404
    assert client_for("CIA").post(url, {"body": ""}, format="json").status_code == 400


def test_cia_activity_shows_approved_reassignments(client_for, make_user, make_query):
    pia, cia = client_for("PIA"), client_for("CIA")
    query = make_query(assignee=make_user("IA"), status=Status.ASSIGNED)
    pia.post(assign_url(query), {"assignee": str(make_user("SIA").pk), "reason": REASON}, format="json")
    request = ReassignmentRequest.objects.get()
    cia.post(reverse("reassignment-requests-approve", kwargs={"pk": request.pk}), {}, format="json")
    rows = client_for("CEO").get(reverse("dashboard-cia-activity")).json()
    assert [r["action"] for r in rows] == ["reassign.approve"]


def test_a_failing_mail_server_does_not_undo_the_change(
    client_for, make_user, make_query, settings, django_capture_on_commit_callbacks
):
    settings.NOTIFY_BY_EMAIL = True
    settings.EMAIL_BACKEND = "tests.test_hierarchy.BrokenBackend"
    query = make_query()
    with django_capture_on_commit_callbacks(execute=True):
        response = client_for("PIA").post(
            assign_url(query), {"assignee": str(make_user("IA").pk)}, format="json"
        )
    assert response.status_code == 200
    assert Query.objects.get(pk=query.pk).status == Status.ASSIGNED


class BrokenBackend:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        raise ConnectionRefusedError("SMTP down")

    def __exit__(self, *exc):
        return False


def test_scoping_matrix_includes_sia(make_user, make_query):
    sia = make_user("SIA")
    mine = make_query(assignee=sia)
    make_query(assignee=make_user("IA"))
    assert set(Query.objects.for_user(verified(sia)).values_list("pk", flat=True)) == {mine.pk}


# In-app notifications, the email switch, and who adds follow-up and comments (owner, 2026-10-22).


def test_notifications_are_private_and_can_be_marked_read(client_for, make_user, make_query):
    ia_user = make_user("IA")
    query = make_query()
    client_for("PIA").post(assign_url(query), {"assignee": str(ia_user.pk)}, format="json")
    ia, other = client_for(ia_user), client_for("IA")
    body = ia.get(reverse("notifications-list")).json()
    assert body["unread"] == 1
    item = body["results"][0]
    assert (item["reference"], item["link"]) == (query.reference, f"/queries/{query.pk}")
    assert other.get(reverse("notifications-list")).json() == {"unread": 0, "results": []}
    assert other.post(reverse("notifications-read", kwargs={"pk": item["id"]})).status_code == 404
    assert ia.post(reverse("notifications-read", kwargs={"pk": item["id"]})).json()["read_at"]
    assert ia.get(reverse("notifications-list")).json()["unread"] == 0

    comments = reverse("queries-comments", kwargs={"pk": query.pk})
    client_for("CIA").post(comments, {"body": "Noted."}, format="json")
    assert ia.post(reverse("notifications-read-all")).json() == {"marked": 1}


def test_email_is_sent_only_when_switched_on(
    client_for, make_user, make_query, settings, django_capture_on_commit_callbacks
):
    ia = make_user("IA")
    settings.NOTIFY_BY_EMAIL = True
    settings.APP_URL = "https://auditlogs.example.ug"
    query = make_query()
    with django_capture_on_commit_callbacks(execute=True):
        client_for("PIA").post(assign_url(query), {"assignee": str(ia.pk)}, format="json")
    assert [m.subject for m in mail.outbox] == [f"AuditLogs: {query.reference} assigned to you"]
    assert f"https://auditlogs.example.ug/queries/{query.pk}" in mail.outbox[0].body


def test_pia_adds_follow_up_and_evidence_without_moving_the_status(client_for, make_user, make_query):
    from django.core.files.uploadedfile import SimpleUploadedFile

    query = make_query(assignee=make_user("IA"), status=Status.ASSIGNED)
    pia = client_for("PIA")
    note = {"kind": "Note", "body": "Spoke to the Financial Controller."}
    assert (
        pia.post(reverse("queries-activities", kwargs={"pk": query.pk}), note, format="json").status_code
        == 201
    )
    upload = {"file": SimpleUploadedFile("minutes.pdf", b"%PDF-1.7 minutes")}
    url = reverse("queries-evidence", kwargs={"pk": query.pk})
    assert pia.post(url, upload, format="multipart").status_code == 201
    query.refresh_from_db()
    assert query.status == Status.ASSIGNED  # only the auditor's own work starts it


def test_everyone_in_the_chain_comments_within_their_scope(client_for, make_user, make_query):
    sia_user = make_user("SIA")
    query = make_query(assignee=sia_user)
    url = reverse("queries-comments", kwargs={"pk": query.pk})
    for client in (client_for(sia_user), client_for("PIA"), client_for("CIA"), client_for("CEO")):
        assert client.post(url, {"body": "Comment from the chain."}, format="json").status_code == 201
    assert client_for("IA").post(url, {"body": "Not mine."}, format="json").status_code == 404
    assert client_for("ICT").post(url, {"body": "No."}, format="json").status_code == 403
    # The auditor is told about the comments of others, not about their own.
    assert notes_for(sia_user) == [
        f"{query.reference} new comment from the {r}" for r in ("PIA", "CIA", "CEO")
    ]
