"""The status workflow (design.md 5) and the end-to-end path from import to Closed (agent_workflow.md 5)."""

from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone

from apps.auditlog.models import AuditLog
from apps.auditlog.services import verify_chain
from apps.queries.models import Query, Status, StatusChangeOutsideWorkflow
from apps.workflow.services import TRANSITIONS, WorkflowError, transition

pytestmark = pytest.mark.django_db

REASON = "All three months reconciled and signed off by the controller"


def verified(user):
    user.is_verified = lambda: True
    return user


def actions(query) -> list[str]:
    return list(AuditLog.objects.filter(object_id=str(query.pk)).values_list("action", flat=True))


def put_in_progress(query, ia, cia):
    """Assign to the IA and record a management response, which starts the work."""
    client_for_cia, client_for_ia = cia, ia
    client_for_cia.post(
        reverse("queries-assign", kwargs={"pk": query.pk}),
        {"assignee": str(client_for_ia.user.pk)},
        format="json",
    )
    client_for_ia.post(
        reverse("queries-activities", kwargs={"pk": query.pk}),
        {"kind": "ManagementResponse", "body": "Management agreed to reconcile monthly."},
        format="json",
    )
    query.refresh_from_db()
    return query


def test_import_to_closed_end_to_end(client_for, make_user):
    """CIA imports, PIA assigns, IA follows up and proposes, CIA approves. Every step is logged."""
    pia, cia, ia = client_for("PIA"), client_for("CIA"), client_for(make_user("IA"))

    header = "reference,title,description,risk_rating,deadline,responsible_officer,department"
    row = f"IA/2026/200,Bank accounts not reconciled,Two accounts unreconciled since June.,High,{(timezone.localdate() + timedelta(days=30)).isoformat()},Financial Controller,Finance"
    batch = cia.post(
        reverse("imports-list"),
        {"file": SimpleUploadedFile("q.csv", f"{header}\n{row}".encode())},
        format="multipart",
    ).json()
    assert cia.post(reverse("imports-confirm", kwargs={"pk": batch["id"]})).status_code == 200
    query = Query.objects.get(reference="IA/2026/200")
    assert query.status == Status.IMPORTED

    response = pia.post(
        reverse("queries-assign", kwargs={"pk": query.pk}), {"assignee": str(ia.user.pk)}, format="json"
    )
    assert response.json()["status"] == Status.ASSIGNED

    ia.post(
        reverse("queries-activities", kwargs={"pk": query.pk}),
        {"kind": "Note", "body": "Met the controller."},
        format="json",
    )
    query.refresh_from_db()
    assert query.status == Status.IN_PROGRESS

    evidence = SimpleUploadedFile("bank-recs.pdf", b"%PDF-1.7 reconciliations")
    assert (
        ia.post(
            reverse("queries-evidence", kwargs={"pk": query.pk}), {"file": evidence}, format="multipart"
        ).status_code
        == 201
    )

    response = ia.post(
        reverse("queries-propose-status", kwargs={"pk": query.pk}), {"reason": REASON}, format="json"
    )
    assert response.json()["status"] == Status.PROPOSED

    request_id = cia.get(reverse("status-requests-list"), {"decision": "Pending"}).json()["results"][0]["id"]
    response = cia.post(reverse("status-requests-approve", kwargs={"pk": request_id}), {}, format="json")
    assert response.json()["decision"] == "Approved"

    query.refresh_from_db()
    assert query.status == Status.CLOSED and query.closed_at is not None
    assert actions(query) == [
        "query.create",
        "query.assign",
        "status.change",  # Imported to Assigned
        "activity.note",
        "status.change",  # Assigned to In Progress, on the first entry
        "evidence.upload",
        "status.propose",
        "status.approve",
    ]
    assert verify_chain().ok


def test_only_the_table_moves_are_allowed(make_user, make_query):
    """Every pair not in design.md 5 is refused, for every role, without the direct flag."""
    statuses = list(Status)
    auditor = make_user("IA")
    for role in ("PIA", "CIA", "IA", "CEO", "ICT"):
        actor = verified(make_user(role))
        for frm in statuses:
            for to in statuses:
                if frm == to:
                    continue
                query = make_query(assignee=auditor)
                query.status = frm
                query._workflow_change = True
                query.save()
                allowed = role in TRANSITIONS.get((frm, to), set())
                try:
                    transition(query, to, actor, REASON)
                    moved = True
                except WorkflowError:
                    moved = False
                assert moved == allowed, f"{role}: {frm} to {to}"


def test_status_cannot_be_set_outside_the_workflow(make_query):
    query = make_query()
    query.status = Status.CLOSED
    with pytest.raises(StatusChangeOutsideWorkflow):
        query.save()
    with pytest.raises(StatusChangeOutsideWorkflow):
        Query.objects.filter(pk=query.pk).update(status=Status.CLOSED)


def test_proposal_needs_a_response_or_evidence(client_for, make_user, make_query):
    cia, ia = client_for("CIA"), client_for(make_user("IA"))
    query = make_query()
    cia.post(reverse("queries-assign", kwargs={"pk": query.pk}), {"assignee": str(ia.user.pk)}, format="json")
    ia.post(
        reverse("queries-activities", kwargs={"pk": query.pk}),
        {"kind": "Note", "body": "Visited stores."},
        format="json",
    )
    response = ia.post(
        reverse("queries-propose-status", kwargs={"pk": query.pk}), {"reason": REASON}, format="json"
    )
    assert response.status_code == 409
    assert "management response or evidence" in response.json()["detail"]


def test_nobody_decides_their_own_proposal(client_for, make_user, make_query):
    """Even an IA holding acting-CIA rights cannot approve what they proposed (system.md 4.3)."""
    cia = client_for("CIA")
    ia_user = make_user("IA")
    ia = client_for(ia_user)
    query = put_in_progress(make_query(), ia, cia)
    ia.post(reverse("queries-propose-status", kwargs={"pk": query.pk}), {"reason": REASON}, format="json")

    ia_user.acting_cia_until = timezone.now() + timedelta(hours=1)
    ia_user.save()
    request_id = ia.get(reverse("status-requests-list")).json()["results"][0]["id"]
    response = ia.post(reverse("status-requests-approve", kwargs={"pk": request_id}), {}, format="json")
    assert response.status_code == 409
    assert "someone else" in response.json()["detail"]
    query.refresh_from_db()
    assert query.status == Status.PROPOSED


def test_return_needs_a_reason_and_work_resumes(client_for, make_user, make_query):
    cia, ia = client_for("CIA"), client_for(make_user("IA"))
    query = put_in_progress(make_query(), ia, cia)
    ia.post(reverse("queries-propose-status", kwargs={"pk": query.pk}), {"reason": REASON}, format="json")
    request_id = cia.get(reverse("status-requests-list")).json()["results"][0]["id"]

    assert (
        cia.post(
            reverse("status-requests-reject", kwargs={"pk": request_id}), {"reason": "no"}, format="json"
        ).status_code
        == 409
    )
    response = cia.post(
        reverse("status-requests-reject", kwargs={"pk": request_id}),
        {"reason": "September statement is still missing"},
        format="json",
    )
    assert response.json()["decision"] == "Rejected"
    query.refresh_from_db()
    assert query.status == Status.RETURNED

    ia.post(
        reverse("queries-activities", kwargs={"pk": query.pk}),
        {"kind": "Note", "body": "Requested September."},
        format="json",
    )
    query.refresh_from_db()
    assert query.status == Status.IN_PROGRESS


def test_only_one_proposal_waits_at_a_time(client_for, make_user, make_query):
    cia, ia = client_for("CIA"), client_for(make_user("IA"))
    query = put_in_progress(make_query(), ia, cia)
    assert (
        ia.post(
            reverse("queries-propose-status", kwargs={"pk": query.pk}), {"reason": REASON}, format="json"
        ).status_code
        == 200
    )
    assert (
        ia.post(
            reverse("queries-propose-status", kwargs={"pk": query.pk}), {"reason": REASON}, format="json"
        ).status_code
        == 409
    )


def test_cia_direct_change_needs_a_reason_and_is_flagged(client_for, make_user, make_query):
    cia = client_for("CIA")
    query = make_query()
    url = reverse("queries-change-status", kwargs={"pk": query.pk})
    assert cia.post(url, {"to_status": "Closed", "reason": "short"}, format="json").status_code == 400
    response = cia.post(
        url, {"to_status": "Closed", "reason": "Duplicate of IA/2026/014, closed there"}, format="json"
    )
    assert response.json()["status"] == Status.CLOSED
    entry = AuditLog.objects.filter(object_id=str(query.pk)).latest("seq")
    assert entry.action == "status.direct"
    assert entry.reason == "Duplicate of IA/2026/014, closed there"


def test_direct_change_cannot_fake_a_proposal_or_skip_a_waiting_one(client_for, make_user, make_query):
    cia, ia = client_for("CIA"), client_for(make_user("IA"))
    query = put_in_progress(make_query(), ia, cia)
    url = reverse("queries-change-status", kwargs={"pk": query.pk})
    assert (
        cia.post(url, {"to_status": "Proposed for Closure", "reason": REASON}, format="json").status_code
        == 409
    )

    ia.post(reverse("queries-propose-status", kwargs={"pk": query.pk}), {"reason": REASON}, format="json")
    response = cia.post(url, {"to_status": "Closed", "reason": REASON}, format="json")
    assert response.status_code == 409
    assert "waiting" in response.json()["detail"]


def test_reopen_closed_query(client_for, make_user, make_query):
    cia, ia = client_for("CIA"), client_for(make_user("IA"))
    query = put_in_progress(make_query(), ia, cia)
    ia.post(reverse("queries-propose-status", kwargs={"pk": query.pk}), {"reason": REASON}, format="json")
    request_id = cia.get(reverse("status-requests-list")).json()["results"][0]["id"]
    cia.post(reverse("status-requests-approve", kwargs={"pk": request_id}), {}, format="json")

    query.refresh_from_db()
    actor = verified(cia.user)
    with pytest.raises(WorkflowError):
        transition(query, Status.IN_PROGRESS, actor, "")
    query = transition(query, Status.IN_PROGRESS, actor, "Management reversed the fix in October")
    assert query.status == Status.IN_PROGRESS and query.closed_at is None
