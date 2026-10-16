"""Row-level scoping of audit content (architecture.md 5.1, system.md 4.1)."""

import inspect

import pytest
from django.urls import reverse

from apps.core.scoping import ScopedQuerysetMixin, scoped_models
from apps.queries.models import ImmutableFieldError, Query
from config.urls import api

pytestmark = pytest.mark.django_db


def verified(user):
    """What django-otp's middleware does for a session that passed the PIN step."""
    user.is_verified = lambda: True
    return user


def test_each_role_sees_the_right_queries(client_for, make_user, make_query):
    ia, other_ia = make_user("IA"), make_user("IA")
    mine = make_query(assignee=ia)
    theirs = make_query(assignee=other_ia)
    unassigned = make_query()
    every = {mine.pk, theirs.pk, unassigned.pk}

    def seen(user):
        return set(Query.objects.for_user(verified(user)).values_list("pk", flat=True))

    assert seen(make_user("CIA")) == every
    assert seen(make_user("PIA")) == every
    assert seen(make_user("CEO")) == every  # CEO endpoints choose summary fields (design.md 6)
    assert seen(make_user("ICT")) == set()

    # for_user also refuses anyone who has not finished signing in.
    assert not Query.objects.for_user(ia).exists()
    client = client_for(ia)
    ids = {row["id"] for row in client.get(reverse("queries-list")).json()["results"]}
    assert ids == {str(mine.pk)}


def test_ia_gets_404_for_a_query_that_is_not_theirs(client_for, make_user, make_query):
    ia = make_user("IA")
    theirs = make_query(assignee=make_user("IA"))
    client = client_for(ia)
    assert client.get(reverse("queries-detail", kwargs={"pk": theirs.pk})).status_code == 404
    mine = make_query(assignee=ia)
    response = client.get(reverse("queries-detail", kwargs={"pk": mine.pk}))
    assert response.status_code == 200
    assert response.json()["description_original"] == mine.description_original


def test_query_list_filters(client_for, make_user, make_query):
    make_query(reference="IA/2026/001", title="Petty cash count exceeded float", risk_rating_current="High")
    make_query(reference="IA/2026/002")
    cia = client_for("CIA")
    assert cia.get(reverse("queries-list"), {"q": "petty"}).json()["count"] == 1
    assert cia.get(reverse("queries-list"), {"risk": "High"}).json()["count"] == 1
    assert cia.get(reverse("queries-list"), {"assignee": "none"}).json()["count"] == 2


def test_original_wording_cannot_change(make_query):
    query = make_query()
    query.description_original = "Rewritten"
    with pytest.raises(ImmutableFieldError):
        query.save()
    with pytest.raises(ImmutableFieldError):
        Query.objects.filter(pk=query.pk).update(description_original="Rewritten")
    with pytest.raises(ImmutableFieldError):
        Query.objects.filter(pk=query.pk).update(risk_rating_original="Low")
    query.refresh_from_db()
    query.description_current = "Corrected wording"
    query.save()  # The current wording may change (with a revision, in the CIA edit task).


def test_queries_are_never_deleted(make_query):
    query = make_query()
    with pytest.raises(PermissionError):
        query.delete()
    with pytest.raises(PermissionError):
        Query.objects.all().delete()


def _view_classes():
    for pattern in api:
        callback = pattern.callback
        yield getattr(callback, "cls", None) or getattr(callback, "view_class", None)


def test_no_view_reads_audit_content_without_for_user():
    """Fails the build if a view lists a scoped model as a plain queryset, or overrides the scoping."""
    scoped = scoped_models()
    for cls in filter(None, _view_classes()):
        queryset = getattr(cls, "queryset", None)
        if queryset is not None:
            assert queryset.model not in scoped, f"{cls.__name__} must use ScopedQuerysetMixin"
        if getattr(cls, "scoped_model", None) is not None:
            assert issubclass(cls, ScopedQuerysetMixin)
            override = cls.__dict__.get("get_queryset")
            if override is not None:
                assert "super().get_queryset()" in inspect.getsource(
                    override
                ), f"{cls.__name__} bypasses for_user"


def test_ceo_summary_has_no_assignee_wording_or_evidence(client_for, make_user, make_query):
    make_query(assignee=make_user("IA"))
    row = client_for("CEO").get(reverse("dashboard-queries")).json()[0]
    assert set(row) == {
        "id",
        "reference",
        "title",
        "risk_rating_current",
        "status",
        "deadline",
        "responsible_officer",
        "department",
        "imported_at",
        "closed_at",
    }


def test_cia_activity_lists_only_direct_cia_changes(client_for, make_query):
    cia = client_for("CIA")
    query = make_query()
    url = reverse("queries-detail", kwargs={"pk": query.pk})
    cia.patch(url, {"title": "Clearer title", "reason": "Wording agreed with the PIA"}, format="json")
    note = {"kind": "Note", "body": "Not a direct change."}
    cia.post(reverse("queries-activities", kwargs={"pk": query.pk}), note, format="json")
    rows = client_for("CEO").get(reverse("dashboard-cia-activity")).json()
    assert [r["action"] for r in rows] == ["query.edit"]
    assert rows[0]["reference"] == query.reference


def test_auditor_list_shows_active_ias_only(client_for, make_user):
    active = make_user("IA")
    make_user("IA", active=False)
    make_user("PIA")
    ids = [a["id"] for a in client_for("CIA").get(reverse("auditors")).json()]
    assert ids == [str(active.pk)]
