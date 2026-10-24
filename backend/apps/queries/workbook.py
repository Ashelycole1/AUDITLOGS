"""The query export as a formatted Excel workbook (system.md 4.9).

Built for reading and printing as it opens: a title block saying who exported what and under which
filters, a styled header, columns wide enough that no date shows as ####, risk coloured from the
Standard Risk Matrix Color Mapping Reference (DECISIONS 31), and a summary sheet. Internal ids and
fingerprints are left out; the audit log keeps those."""

import io
import math
from collections import Counter
from datetime import date, datetime
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

from apps.accounts.models import Role, User

from .models import Risk, Status

KAMPALA = ZoneInfo("Africa/Kampala")
TITLE = "Audit queries register"
DATE_FORMAT = "dd mmm yyyy"
# Excel refuses cells longer than this.
MAX_CELL = 32_000

INK = "201613"
MUTED = "6B625E"
HEADER_FILL = PatternFill("solid", fgColor="2B2421")
BAND_FILL = PatternFill("solid", fgColor="F6F4F2")
LATE_FONT = Font(name="Calibri", size=10, color="B3261E", bold=True)
RULE = Side(style="thin", color="D9D4D0")
CELL_BORDER = Border(bottom=RULE)
TOP = Alignment(vertical="top", wrap_text=True)
TOP_CENTRE = Alignment(vertical="top", horizontal="center", wrap_text=True)

# Fill and text colour per tier, as in the frontend's light theme.
RISK_STYLE = {
    Risk.CRITICAL: ("C62828", "FFFFFF"),
    Risk.HIGH: ("EF6C00", INK),
    Risk.MEDIUM: ("FBC02D", INK),
    Risk.LOW: ("2E7D32", "FFFFFF"),
}

# (heading, width in characters, alignment). Dates get room to spare, so none shows as ####; text
# wraps. The total is kept small enough to stay readable when printed across one A4 landscape page.
COLUMNS = [
    ("No.", 5, TOP_CENTRE),
    ("Reference", 13, TOP),
    ("Title", 26, TOP),
    ("Description", 44, TOP),
    ("Department", 15, TOP),
    ("Responsible officer", 16, TOP),
    ("Risk at import", 10, TOP_CENTRE),
    ("Current risk", 10, TOP_CENTRE),
    ("Status", 13, TOP),
    ("Deadline", 13, TOP_CENTRE),
    ("Time to deadline", 13, TOP),
    ("Assigned to", 16, TOP),
    ("Closed on", 13, TOP_CENTRE),
]


def _text(value) -> str:
    text = "" if value is None else str(value).strip()
    return text[:MAX_CELL] + "…" if len(text) > MAX_CELL else text


def _put(ws: Worksheet, row: int, col: int, value, **style):
    cell = ws.cell(row=row, column=col, value=value)
    if isinstance(value, str):
        # Always text: a value starting with = must never run as a formula.
        cell.data_type = "s"
    for name, v in style.items():
        setattr(cell, name, v)
    return cell


def _days(n: int) -> str:
    return f"{n} {'day' if n == 1 else 'days'}"


def time_to_deadline(query, today: date) -> str:
    if query.status == Status.CLOSED:
        return "Closed"
    gap = (query.deadline - today).days
    if gap < 0:
        return f"Overdue by {_days(-gap)}"
    return "Due today" if gap == 0 else f"Due in {_days(gap)}"


def describe_filters(filters: dict, organization_id=None) -> str:
    """The filters in words, matching describeFilters in the frontend (lib/rules.ts). Names are looked up
    only inside the exporting organization."""
    from apps.reports.models import AuditReport, Criterion

    from .filters import _is_id

    parts = []
    if filters.get("status"):
        parts.append(f"status {filters['status']}")
    if filters.get("risk"):
        parts.append(f"{filters['risk']} risk")
    if filters.get("department"):
        parts.append(filters["department"])
    if filters.get("assignee") == "none":
        parts.append("not assigned")
    elif filters.get("assignee") == "any":
        parts.append("allocated")
    elif filters.get("assignee"):
        who = None
        if _is_id(filters["assignee"]):
            who = (
                User.objects.filter(pk=filters["assignee"], organization_id=organization_id)
                .values_list("full_name", flat=True)
                .first()
            )
        parts.append(f"auditor {who or 'unknown'}")
    worked = str(filters.get("worked", "")).lower()
    if worked in ("yes", "true", "1"):
        parts.append("worked on")
    elif worked in ("no", "false", "0"):
        parts.append("not worked on")
    for key, model in (("report", AuditReport), ("criterion", Criterion)):
        if filters.get(key):
            title = None
            if _is_id(filters[key]):
                title = (
                    model.objects.in_org(organization_id)
                    .filter(pk=filters[key])
                    .values_list("title", flat=True)
                    .first()
                )
            parts.append(f"{key} {title or 'unknown'}")
    if str(filters.get("overdue", "")).lower() in ("1", "true"):
        parts.append("overdue only")
    if filters.get("q"):
        parts.append(f'matching "{filters["q"]}"')
    return ", ".join(parts).capitalize() if parts else "All queries"


def _person(user: User) -> str:
    return f"{user.full_name}, {Role(user.role).label}" if user.role in Role.values else user.full_name


def _stamp(moment: datetime) -> str:
    local = moment.astimezone(KAMPALA)
    return f"{local:%d %b %Y}, {local:%H:%M} (Kampala time)"


def _height(texts: list[tuple[str, float]]) -> float | None:
    """Row height in points for wrapped text, given (text, column width) pairs. Excel does not grow
    rows to fit on its own, so long text would otherwise be cut off. A width unit holds about 1.2
    characters of 10-point Calibri."""
    lines = max(
        (
            sum(max(1, math.ceil(len(part) / (width * 1.2 - 1))) for part in text.splitlines())
            for text, width in texts
            if text
        ),
        default=1,
    )
    return min(409, lines * 13.5 + 3) if lines > 1 else None


def _title_block(ws: Worksheet, lines: list[tuple[str, str]], label_cols: int, span: int) -> int:
    """The title and the label/value lines under it. Returns the next free row."""
    _put(ws, 1, 1, TITLE, font=Font(name="Calibri", size=16, bold=True, color=INK))
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=span)
    ws.row_dimensions[1].height = 26
    value_width = sum(
        ws.column_dimensions[get_column_letter(c)].width for c in range(label_cols + 1, span + 1)
    )
    row = 2
    for label, value in lines:
        _put(
            ws,
            row,
            1,
            label,
            font=Font(name="Calibri", size=10, bold=True, color=MUTED),
            alignment=Alignment(vertical="top"),
        )
        if label_cols > 1:
            ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=label_cols)
        _put(ws, row, label_cols + 1, value, font=Font(name="Calibri", size=10, color=INK), alignment=TOP)
        ws.merge_cells(start_row=row, start_column=label_cols + 1, end_row=row, end_column=span)
        height = _height([(value, value_width)])
        if height:
            ws.row_dimensions[row].height = height
        row += 1
    return row + 1


def _print_setup(ws: Worksheet, header_row: int, last_col: int, landscape: bool):
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.page_margins.top = ws.page_margins.bottom = 0.6
    if header_row:
        ws.print_title_rows = f"{header_row}:{header_row}"
    ws.oddFooter.left.text = "Confidential: internal audit"
    ws.oddFooter.left.size = 8
    ws.oddFooter.right.text = "Page &P of &N"
    ws.oddFooter.right.size = 8
    ws.sheet_view.showGridLines = False


def _header(ws: Worksheet, row: int, headings: list[str], aligns: list[str]):
    """The dark header row. Each heading is aligned like the values under it."""
    for col, (heading, align) in enumerate(zip(headings, aligns, strict=True), start=1):
        _put(
            ws,
            row,
            col,
            heading,
            font=Font(name="Calibri", size=10, bold=True, color="FFFFFF"),
            fill=HEADER_FILL,
            alignment=Alignment(vertical="center", horizontal=align, wrap_text=True),
        )
    ws.row_dimensions[row].height = 30


def _queries_sheet(ws: Worksheet, queries, lines, today: date):
    ws.title = "Queries"
    for col, (_, width, _) in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(col)].width = width
    header = _title_block(ws, lines, 2, len(COLUMNS))
    _header(ws, header, [c[0] for c in COLUMNS], [c[2].horizontal or "left" for c in COLUMNS])

    body = Font(name="Calibri", size=10, color=INK)
    row = header
    for n, q in enumerate(queries, start=1):
        row += 1
        band = BAND_FILL if n % 2 == 0 else None
        values = [
            n,
            _text(q.reference),
            _text(q.title),
            _text(q.description_current),
            _text(q.department),
            _text(q.responsible_officer),
            q.risk_rating_original,
            q.risk_rating_current,
            q.status,
            q.deadline,
            time_to_deadline(q, today),
            _text(q.current_assignee.full_name) if q.current_assignee_id else "Not assigned",
            q.closed_at.astimezone(KAMPALA).date() if q.closed_at else "",
        ]
        for col, value in enumerate(values, start=1):
            cell = _put(ws, row, col, value, font=body, alignment=COLUMNS[col - 1][2], border=CELL_BORDER)
            if band:
                cell.fill = band
            if isinstance(value, date):
                cell.number_format = DATE_FORMAT
        for col in (7, 8):
            risk = values[col - 1]
            if risk in RISK_STYLE:
                fill, ink = RISK_STYLE[risk]
                cell = ws.cell(row=row, column=col)
                cell.fill = PatternFill("solid", fgColor=fill)
                cell.font = Font(name="Calibri", size=10, bold=True, color=ink)
        height = _height([(v, COLUMNS[i][1]) for i, v in enumerate(values) if isinstance(v, str)])
        if height:
            ws.row_dimensions[row].height = height
        if values[10].startswith("Overdue"):
            ws.cell(row=row, column=11).font = LATE_FONT

    if not queries:
        _put(
            ws,
            header + 1,
            1,
            "No queries match these filters.",
            font=Font(name="Calibri", size=10, italic=True, color=MUTED),
        )
        ws.merge_cells(start_row=header + 1, start_column=1, end_row=header + 1, end_column=len(COLUMNS))
    else:
        ws.auto_filter.ref = f"A{header}:{get_column_letter(len(COLUMNS))}{row}"
    ws.freeze_panes = f"A{header + 1}"
    _print_setup(ws, header, len(COLUMNS), landscape=True)


def _summary_sheet(ws: Worksheet, queries, lines, today: date):
    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 18
    ws.column_dimensions["C"].width = 18
    row = _title_block(ws, lines, 1, 3)
    total = len(queries)
    open_ = [q for q in queries if q.status != Status.CLOSED]
    overdue = [q for q in open_ if q.deadline < today]
    label_font = Font(name="Calibri", size=10, color=INK)
    strong = Font(name="Calibri", size=10, bold=True, color=INK)

    def table(heading: str, rows: list[tuple[str, int]], start: int, colour=None) -> int:
        _header(ws, start, [heading, "Queries", "Share"], ["left", "right", "right"])
        r = start
        for name, count in rows:
            r += 1
            _put(ws, r, 1, name, font=label_font, border=CELL_BORDER)
            if colour and name in RISK_STYLE:
                fill, ink = RISK_STYLE[name]
                ws.cell(row=r, column=1).fill = PatternFill("solid", fgColor=fill)
                ws.cell(row=r, column=1).font = Font(name="Calibri", size=10, bold=True, color=ink)
            _put(
                ws, r, 2, count, font=label_font, border=CELL_BORDER, alignment=Alignment(horizontal="right")
            )
            share = _put(ws, r, 3, count / total if total else 0, font=label_font, border=CELL_BORDER)
            share.number_format = "0%"
            share.alignment = Alignment(horizontal="right")
        r += 1
        _put(ws, r, 1, "Total", font=strong, border=Border(top=Side(style="thin", color=INK)))
        _put(
            ws,
            r,
            2,
            total,
            font=strong,
            alignment=Alignment(horizontal="right"),
            border=Border(top=Side(style="thin", color=INK)),
        )
        _put(
            ws,
            r,
            3,
            1 if total else 0,
            font=strong,
            alignment=Alignment(horizontal="right"),
            border=Border(top=Side(style="thin", color=INK)),
        ).number_format = "0%"
        return r + 2

    _header(ws, row, ["At a glance", "Queries", ""], ["left", "right", "right"])
    for name, count in (("Open", len(open_)), ("Overdue", len(overdue)), ("Closed", total - len(open_))):
        row += 1
        _put(ws, row, 1, name, font=label_font, border=CELL_BORDER)
        cell = _put(
            ws,
            row,
            2,
            count,
            font=LATE_FONT if name == "Overdue" and count else label_font,
            border=CELL_BORDER,
        )
        cell.alignment = Alignment(horizontal="right")
        _put(ws, row, 3, "", border=CELL_BORDER)
    row += 2

    by_status = Counter(q.status for q in queries)
    row = table("By status", [(s.value, by_status[s.value]) for s in Status if by_status[s.value]], row)
    by_risk = Counter(q.risk_rating_current for q in queries)
    row = table("By current risk", [(r.value, by_risk[r.value]) for r in Risk], row, colour=True)
    by_dept = Counter(q.department for q in queries)
    table("By department", sorted(by_dept.items(), key=lambda kv: (-kv[1], kv[0])), row)
    _print_setup(ws, 0, 3, landscape=False)


def export_workbook(queries, *, actor: User, filters: dict, request=None) -> bytes:
    """`request` is the approved ExportRequest when a PIA downloads; the CIA exports without one."""
    now = datetime.now(tz=KAMPALA)
    today = now.date()
    lines = [
        ("Exported by", _person(actor)),
        ("Exported on", _stamp(now)),
        ("Organization", actor.organization.name if actor.organization_id else ""),
        ("Selection", describe_filters(filters, actor.organization_id)),
        ("Queries", str(len(queries))),
    ]
    if request is not None:
        lines += [
            ("Requested on", _stamp(request.created_at)),
            ("Purpose", _text(request.reason)),
            ("Approved by", _person(request.decided_by) if request.decided_by_id else ""),
            ("Approved on", _stamp(request.decided_at) if request.decided_at else ""),
        ]
    else:
        lines.append(("Approval", "Exported directly by the Chief Internal Auditor"))

    wb = Workbook()
    _queries_sheet(wb.active, queries, lines, today)
    _summary_sheet(wb.create_sheet("Summary"), queries, lines, today)
    wb.properties.title = TITLE
    wb.properties.creator = actor.full_name
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def filename() -> str:
    return f"audit-queries-{datetime.now(tz=KAMPALA):%Y-%m-%d}.xlsx"
