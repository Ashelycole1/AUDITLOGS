"""Import of final queries: upload, validate, preview, confirm, cancel (design.md 4)."""

import hashlib
import io
from datetime import date, timedelta
from pathlib import Path

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from openpyxl import Workbook

from apps.auditlog.models import AuditLog
from apps.core.filestore import read_encrypted
from apps.imports.models import ImportBatch
from apps.queries.models import Query, Status

pytestmark = pytest.mark.django_db

HEADER = "reference,title,description,risk_rating,deadline,responsible_officer,department"
FUTURE = (date.today() + timedelta(days=60)).isoformat()
PAST = (date.today() - timedelta(days=3)).isoformat()


def csv_file(*lines: str, name: str = "final-queries.csv") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, "\n".join([HEADER, *lines]).encode("utf-8"), content_type="text/csv")


def good_line(ref: str, deadline: str = FUTURE) -> str:
    return f"{ref},Overtime paid without approval,Overtime for 14 staff was paid without forms.,high,{deadline},HR Manager,Human Resources"


def upload(client, file):
    return client.post(reverse("imports-list"), {"file": file}, format="multipart")


def test_valid_file_previews_then_confirms(client_for):
    pia = client_for("PIA")
    response = upload(pia, csv_file(good_line("IA/2026/041"), good_line("IA/2026/042")))
    assert response.status_code == 201
    preview = response.json()
    assert preview["status"] == "Previewed"
    assert preview["error_count"] == 0
    assert [r["line"] for r in preview["rows"]] == [2, 3]
    assert preview["rows"][0]["data"]["risk_rating"] == "High"  # normalised from "high"
    assert not Query.objects.exists()  # Nothing is created before confirmation.

    response = pia.post(reverse("imports-confirm", kwargs={"pk": preview["id"]}))
    assert response.status_code == 200
    assert response.json()["status"] == "Confirmed"
    queries = Query.objects.order_by("reference")
    assert [q.reference for q in queries] == ["IA/2026/041", "IA/2026/042"]
    assert all(
        q.status == Status.IMPORTED and q.description_original == q.description_current for q in queries
    )
    actions = list(AuditLog.objects.values_list("action", flat=True))
    assert actions.count("import.upload") == 1 and actions.count("import.confirm") == 1
    assert actions.count("query.create") == 2


def test_source_file_is_kept_with_its_fingerprint(client_for):
    content = "\n".join([HEADER, good_line("IA/2026/050")]).encode()
    response = upload(client_for("PIA"), SimpleUploadedFile("q.csv", content))
    batch = ImportBatch.objects.get(pk=response.json()["id"])
    assert batch.source_sha256 == hashlib.sha256(content).hexdigest()
    assert content not in Path(batch.source_file_path).read_bytes()  # encrypted at rest
    assert read_encrypted(batch.source_file_path, batch.source_sha256) == content


def test_problems_are_listed_per_row_and_block_confirmation(client_for, make_query):
    make_query(reference="IA/2026/001")
    pia = client_for("PIA")
    response = upload(
        pia,
        csv_file(
            good_line("IA/2026/001"),  # already imported
            good_line("IA/2026/002"),
            good_line("IA/2026/002"),  # duplicate in file
            ",No reference,Text,Low,2030-01-01,Officer,Dept",
            "IA/2026/003,Severe rating,Text,Severe,2030-01-01,Officer,Dept",
            "IA/2026/004,Bad date,Text,Low,31/11/2030,Officer,Dept",
            "IA/2026/005,,,Low,2030-01-01,,",
        ),
    )
    rows = {r["line"]: r["errors"] for r in response.json()["rows"]}
    assert "Reference already imported in an earlier batch" in rows[2]
    assert rows[3] == []
    assert "Duplicate reference in this file" in rows[4]
    assert "Missing reference" in rows[5]
    assert any("Unknown risk rating" in e for e in rows[6])
    assert any("Bad date" in e for e in rows[7])
    assert {
        "Missing title",
        "Missing description",
        "Missing responsible officer",
        "Missing department",
    } <= set(rows[8])
    assert response.json()["error_count"] == 6

    confirm = pia.post(reverse("imports-confirm", kwargs={"pk": response.json()["id"]}))
    assert confirm.status_code == 409
    assert Query.objects.count() == 1


def test_past_deadline_warns_but_does_not_block(client_for):
    pia = client_for("PIA")
    preview = upload(pia, csv_file(good_line("IA/2026/060", deadline=PAST))).json()
    assert preview["rows"][0]["errors"] == []
    assert preview["rows"][0]["warnings"] == ["Deadline is before the import date"]
    assert pia.post(reverse("imports-confirm", kwargs={"pk": preview["id"]})).status_code == 200


def test_day_first_dates_are_read(client_for):
    preview = upload(client_for("PIA"), csv_file(good_line("IA/2026/061", deadline="15/12/2030"))).json()
    assert preview["rows"][0]["data"]["deadline"] == "2030-12-15"


def test_excel_files_are_read(client_for):
    book = Workbook()
    sheet = book.active
    sheet.append(HEADER.split(","))
    sheet.append(
        [
            "IA/2026/070",
            "Unused licences",
            "Forty licences unused.",
            "Low",
            date(2030, 6, 30),
            "ICT Manager",
            "ICT",
        ]
    )
    buffer = io.BytesIO()
    book.save(buffer)
    preview = upload(client_for("PIA"), SimpleUploadedFile("final.xlsx", buffer.getvalue())).json()
    assert preview["error_count"] == 0
    assert preview["rows"][0]["data"]["deadline"] == "2030-06-30"


def test_unreadable_or_wrong_files_are_refused(client_for):
    pia = client_for("PIA")
    assert upload(pia, SimpleUploadedFile("findings.pdf", b"%PDF-1.7")).status_code == 400
    assert upload(pia, SimpleUploadedFile("notes.txt", b"hello")).status_code == 400
    missing = SimpleUploadedFile("q.csv", b"reference,title\nIA/1,Thing")
    response = upload(pia, missing)
    assert response.status_code == 400
    assert "missing these columns" in response.json()["detail"]
    assert pia.post(reverse("imports-list"), {}, format="multipart").status_code == 400
    assert not ImportBatch.objects.exists()


def test_header_aliases_are_configurable(client_for, settings):
    settings.IMPORT_HEADER_ALIASES = {"reference": ["query ref"]}
    lines = [
        "query ref,title,description,risk_rating,deadline,responsible_officer,department",
        good_line("IA/2026/080"),
    ]
    preview = upload(client_for("PIA"), SimpleUploadedFile("q.csv", "\n".join(lines).encode())).json()
    assert preview["rows"][0]["data"]["reference"] == "IA/2026/080"


def test_cancel_leaves_no_queries_and_cannot_be_undone(client_for):
    pia = client_for("PIA")
    batch_id = upload(pia, csv_file(good_line("IA/2026/090"))).json()["id"]
    response = pia.post(
        reverse("imports-cancel", kwargs={"pk": batch_id}), {"reason": "Wrong file"}, format="json"
    )
    assert response.json()["status"] == "Cancelled"
    assert pia.post(reverse("imports-confirm", kwargs={"pk": batch_id})).status_code == 409
    assert not Query.objects.exists()
    assert AuditLog.objects.filter(action="import.cancel").exists()


def test_a_batch_confirms_only_once(client_for):
    pia = client_for("PIA")
    batch_id = upload(pia, csv_file(good_line("IA/2026/100"))).json()["id"]
    assert pia.post(reverse("imports-confirm", kwargs={"pk": batch_id})).status_code == 200
    assert pia.post(reverse("imports-confirm", kwargs={"pk": batch_id})).status_code == 409
    assert Query.objects.count() == 1


def test_references_are_checked_again_at_confirmation(client_for):
    pia = client_for("PIA")
    first = upload(pia, csv_file(good_line("IA/2026/110"))).json()["id"]
    second = upload(pia, csv_file(good_line("IA/2026/110"))).json()["id"]
    assert pia.post(reverse("imports-confirm", kwargs={"pk": first})).status_code == 200
    response = pia.post(reverse("imports-confirm", kwargs={"pk": second}))
    assert response.status_code == 409
    assert "IA/2026/110" in response.json()["detail"]
    assert Query.objects.count() == 1
