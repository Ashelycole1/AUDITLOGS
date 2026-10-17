"""Reading and checking a final-queries file (design.md 4 and 13).

The column template is not final (system.md 9), so headers are matched through configurable aliases:
settings.IMPORT_HEADER_ALIASES maps each field to the header names accepted for it.
"""

import csv
import io
from dataclasses import dataclass, field
from datetime import date, datetime

from django.conf import settings
from openpyxl import load_workbook

FIELDS = ("reference", "title", "description", "risk_rating", "deadline", "responsible_officer", "department")
# "Extreme" is the reference's other name for Critical (Standard Risk Matrix Color Mapping Reference).
RISKS = {"critical": "Critical", "extreme": "Critical", "high": "High", "medium": "Medium", "low": "Low"}
DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y")  # Ugandan files write day before month.
MAX_LENGTH = {"reference": 50, "title": 300, "responsible_officer": 150, "department": 150}


class ImportFileError(Exception):
    """The file as a whole cannot be read. Nothing is imported."""


@dataclass
class ParsedRow:
    line: int
    data: dict
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _header_aliases() -> dict[str, set[str]]:
    custom = getattr(settings, "IMPORT_HEADER_ALIASES", {}) or {}
    aliases = {}
    for f in FIELDS:
        names = {f, f.replace("_", " ")} | set(custom.get(f, []))
        aliases[f] = {n.strip().lower() for n in names}
    return aliases


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def read_table(filename: str, content: bytes) -> list[list[str]]:
    name = filename.lower()
    if name.endswith(".csv"):
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("cp1252")
        return [[c.strip() for c in row] for row in csv.reader(io.StringIO(text))]
    if name.endswith(".xlsx"):
        try:
            book = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        except Exception as exc:  # openpyxl raises many types for damaged files
            raise ImportFileError(
                "This Excel file could not be opened. Save it again as .xlsx and retry."
            ) from exc
        sheet = book.worksheets[0]
        rows = [[_cell(v) for v in row] for row in sheet.iter_rows(values_only=True)]
        book.close()
        return rows
    raise ImportFileError("Upload the final queries as an Excel (.xlsx) or CSV file.")


def _parse_date(value: str) -> date | None:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def parse_rows(table: list[list[str]]) -> list[ParsedRow]:
    rows = [r for r in table if any(c.strip() for c in r)]
    if not rows:
        raise ImportFileError("The file is empty.")
    header = [h.strip().lower() for h in rows[0]]
    aliases = _header_aliases()
    index = {}
    for f in FIELDS:
        matches = [i for i, h in enumerate(header) if h in aliases[f]]
        if matches:
            index[f] = matches[0]
    missing = [f for f in FIELDS if f not in index]
    if missing:
        raise ImportFileError(f"The file is missing these columns: {', '.join(missing)}.")
    body = rows[1:]
    if len(body) > settings.IMPORT_MAX_ROWS:
        raise ImportFileError(
            f"The file has {len(body)} rows. The limit is {settings.IMPORT_MAX_ROWS} per import."
        )
    line_of = {id(r): i + 1 for i, r in enumerate(table)}
    return [
        ParsedRow(
            line=line_of[id(r)],
            data={f: (r[index[f]].strip() if index[f] < len(r) else "") for f in FIELDS},
        )
        for r in body
    ]


def validate(rows: list[ParsedRow], existing_references: set[str], today: date) -> list[ParsedRow]:
    """Blocking errors stop the import. Warnings are shown but do not block (design.md 13)."""
    seen: set[str] = set()
    for row in rows:
        d = row.data
        ref = d["reference"]
        if not ref:
            row.errors.append("Missing reference")
        elif ref in existing_references:
            row.errors.append("Reference already imported in an earlier batch")
        elif ref in seen:
            row.errors.append("Duplicate reference in this file")
        seen.add(ref)

        for f, label in (
            ("title", "title"),
            ("description", "description"),
            ("responsible_officer", "responsible officer"),
            ("department", "department"),
        ):
            if not d[f]:
                row.errors.append(f"Missing {label}")
        for f, limit in MAX_LENGTH.items():
            if len(d[f]) > limit:
                row.errors.append(f"{f.replace('_', ' ').capitalize()} is over {limit} characters")

        risk = RISKS.get(d["risk_rating"].strip().lower())
        if risk:
            d["risk_rating"] = risk
        else:
            row.errors.append(
                f'Unknown risk rating "{d["risk_rating"] or "blank"}". Use Low, Medium, High or Critical'
            )

        deadline = _parse_date(d["deadline"])
        if deadline is None:
            row.errors.append(f'Bad date "{d["deadline"] or "blank"}". Use YYYY-MM-DD or DD/MM/YYYY')
        else:
            d["deadline"] = deadline.isoformat()
            if deadline < today:
                row.warnings.append("Deadline is before the import date")
    return rows
