"""Queries and audit reports as PDF (auditlogs-additions_final.md 8.1 and 13).

The layout is the same for every organization and carries its name: the report header, then each
criterion with the queries raised against it (every field of the query record, in the order of 8.2),
then the summary: counts by status and by risk, and the status pie chart with its key. A4 portrait, a
"Confidential: internal audit" footer and page numbers on every page. Text is escaped before it is laid
out, so nothing in a query can inject markup.
"""

import io
from collections import Counter
from datetime import datetime
from xml.sax.saxutils import escape

from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from apps.accounts.models import Role, User

from .models import Query, Risk, Status
from .stats import breakdown
from .workbook import KAMPALA, RISK_STYLE, _stamp, describe_filters

INK = colors.HexColor("#201613")
MUTED = colors.HexColor("#6B625E")
RULE = colors.HexColor("#D9D4D0")
BAND = colors.HexColor("#F6F4F2")
# Pie slices: worked on, allocated not yet worked on, not allocated (checked for contrast on white).
SLICE_COLOURS = [colors.HexColor("#2E7D32"), colors.HexColor("#EF6C00"), colors.HexColor("#8A817C")]

_base = getSampleStyleSheet()
STYLES = {
    "org": ParagraphStyle("org", parent=_base["Normal"], fontSize=10, textColor=MUTED, spaceAfter=2),
    "title": ParagraphStyle(
        "title", parent=_base["Title"], fontSize=18, leading=22, alignment=0, textColor=INK
    ),
    "h2": ParagraphStyle("h2", parent=_base["Heading2"], fontSize=13, textColor=INK, spaceBefore=10),
    "h3": ParagraphStyle("h3", parent=_base["Heading3"], fontSize=10.5, textColor=INK, spaceBefore=8),
    "body": ParagraphStyle("body", parent=_base["Normal"], fontSize=9, leading=12, textColor=INK),
    "label": ParagraphStyle("label", parent=_base["Normal"], fontSize=8.5, leading=11, textColor=MUTED),
    "small": ParagraphStyle("small", parent=_base["Normal"], fontSize=8, leading=10, textColor=MUTED),
    "right": ParagraphStyle("right", parent=_base["Normal"], fontSize=9, alignment=TA_RIGHT),
}
WIDTH = A4[0] - 36 * mm


def _p(text, style: str = "body") -> Paragraph:
    value = escape(str(text or "")).replace("\n", "<br/>")
    return Paragraph(value or "&nbsp;", STYLES[style])


def _person(user: User | None) -> str:
    if user is None:
        return ""
    return f"{user.full_name}, {Role(user.role).label}" if user.role in Role.values else user.full_name


def _date(value) -> str:
    return f"{value:%d %b %Y}" if value else ""


def _key_values(lines: list[tuple[str, str]]) -> Table:
    table = Table(
        [[_p(label, "label"), _p(value)] for label, value in lines],
        colWidths=[38 * mm, WIDTH - 38 * mm],
    )
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.25, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return table


def _risk_cell(risk: str) -> Table:
    fill, ink = RISK_STYLE.get(risk, ("FFFFFF", "201613"))
    cell = Table([[Paragraph(f'<font color="#{ink}"><b>{escape(risk)}</b></font>', STYLES["body"])]])
    cell.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(f"#{fill}"))]))
    return cell


def query_fields(q: Query) -> list[tuple[str, object]]:
    """The query record of section 8.2, in its order, plus who holds it (section 11)."""
    policy = "\n".join(part for part in (q.policy_title, q.policy_reference) if part)
    action = q.responsible_officer + (f", by {_date(q.deadline)}" if q.deadline else "")
    if q.department:
        action += f" ({q.department})"
    assignee = q.current_assignee
    return [
        ("1. Query", q.description_current),
        ("2. Management response", q.management_response or "None recorded"),
        ("3. Risk rating", _risk_cell(q.risk_rating_current)),
        ("4. Recommendation", q.recommendation or "None recorded"),
        ("5. Audit observation", q.audit_observation or "None recorded"),
        ("6. Policy reference", policy or "None recorded"),
        ("7. Action party & time", action),
        ("8. Notable numbers", q.notable_numbers or "None recorded"),
        ("Assigned to", _person(assignee) if assignee else "Not yet assigned"),
        ("Status", q.status),
    ]


def _query_block(q: Query) -> KeepTogether:
    rows = [
        [_p(label, "label"), value if isinstance(value, Table) else _p(value)]
        for label, value in query_fields(q)
    ]
    table = Table(rows, colWidths=[42 * mm, WIDTH - 42 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), 0.5, RULE),
                ("LINEBELOW", (0, 0), (-1, -2), 0.25, RULE),
                ("BACKGROUND", (0, 0), (0, -1), BAND),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return KeepTogether([_p(f"{q.reference}: {q.title}", "h3"), table, Spacer(1, 4)])


def _count_table(title: str, rows: list[tuple[str, int]]) -> list:
    total = sum(n for _, n in rows)
    data = [[_p(label), _p(str(n), "right")] for label, n in rows] + [
        [_p("Total", "label"), _p(str(total), "right")]
    ]
    table = Table(data, colWidths=[60 * mm, 20 * mm])
    table.setStyle(
        TableStyle(
            [
                ("LINEBELOW", (0, 0), (-1, -2), 0.25, RULE),
                ("LINEABOVE", (0, -1), (-1, -1), 0.75, INK),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return [_p(title, "h3"), table]


def _pie(stats: dict) -> list:
    slices = stats["slices"]
    drawing = Drawing(60 * mm, 50 * mm)
    if stats["total"]:
        pie = Pie()
        pie.x, pie.y, pie.width, pie.height = 5 * mm, 3 * mm, 44 * mm, 44 * mm
        pie.data = [s["count"] for s in slices]
        pie.labels = None
        pie.slices.strokeColor = colors.white
        pie.slices.strokeWidth = 1
        for i, colour in enumerate(SLICE_COLOURS):
            pie.slices[i].fillColor = colour
        drawing.add(pie)
    key = [[_p("Key", "label"), _p("Count", "label"), _p("Share", "label")]]
    for colour, s in zip(SLICE_COLOURS, slices, strict=True):
        swatch = f'<font color="{colour.hexval().replace("0x", "#")}">&#9632;</font>'
        key.append(
            [
                Paragraph(
                    f"{swatch} {escape(s['label'])}<br/><font size=7.5>{escape(s['meaning'])}</font>",
                    STYLES["body"],
                ),
                _p(str(s["count"]), "right"),
                _p(f"{s['percent']}%", "right"),
            ]
        )
    key += [
        [_p("Total imported", "label"), _p(str(stats["total"]), "right"), _p("", "right")],
        [_p("Allocated (has an auditor)", "label"), _p(str(stats["allocated"]), "right"), _p(f"{stats['percent']['allocated']}%", "right")],
        [_p("Not worked on", "label"), _p(str(stats["not_worked_on"]), "right"), _p(f"{stats['percent']['not_worked_on']}%", "right")],
    ]  # fmt: skip
    legend = Table(key, colWidths=[62 * mm, 18 * mm, 18 * mm])
    legend.setStyle(
        TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.25, RULE), ("VALIGN", (0, 0), (-1, -1), "TOP")])
    )
    side_by_side = Table([[drawing, legend]], colWidths=[62 * mm, WIDTH - 62 * mm])
    side_by_side.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return [_p("Queries worked on", "h3"), side_by_side]


def _footer(organization_name: str):
    def draw(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, 10 * mm, f"Confidential: internal audit. {organization_name}")
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    return draw


def _sections(queries: list[Query], report) -> list[tuple[str, str, list[Query]]]:
    """(heading, description, queries) per criterion in order; queries without one come last."""
    by_criterion: dict = {}
    for q in queries:
        by_criterion.setdefault(q.criterion_id, []).append(q)
    criteria = []
    if report is not None:
        criteria = list(report.criteria.all())
    else:
        seen = {q.criterion_id: q.criterion for q in queries if q.criterion_id}
        criteria = sorted(seen.values(), key=lambda c: (str(c.report_id), c.position, c.title))
    sections = []
    for n, c in enumerate(criteria, start=1):
        sections.append((f"Criterion {n}: {c.title}", c.description, by_criterion.get(c.pk, [])))
    if by_criterion.get(None):
        heading = "Queries not linked to a criterion" if sections else "Queries"
        sections.append((heading, "", by_criterion[None]))
    return sections


def render_pdf(queries, *, actor: User, filters: dict | None = None, report=None, request=None) -> bytes:
    """`report` gives the header and the criteria (section 8.1). `request` is the approved ExportRequest
    when a PIA downloads; the CIA exports without one."""
    queries = list(queries)
    organization = actor.organization
    org_name = organization.name if organization else ""
    now = datetime.now(tz=KAMPALA)
    title = report.title if report is not None else "Audit queries report"

    header = []
    if report is not None:
        header += [
            ("Audit period", report.audit_period or "Not given"),
            ("Report date", _date(report.report_date) or "Not given"),
            ("Prepared by", report.prepared_by or "Not given"),
        ]
    header += [
        ("Exported by", _person(actor)),
        ("Exported on", _stamp(now)),
        ("Selection", describe_filters(filters or {}, actor.organization_id)),
        ("Queries", str(len(queries))),
    ]
    if request is not None:
        header += [
            ("Purpose", request.reason),
            ("Approved by", _person(request.decided_by) if request.decided_by_id else ""),
            ("Approved on", _stamp(request.decided_at) if request.decided_at else ""),
        ]
    else:
        header.append(("Approval", "Exported directly by the Chief Internal Auditor"))

    story = [_p(org_name, "org"), _p(title, "title"), Spacer(1, 4), _key_values(header), Spacer(1, 6)]
    for heading, description, items in _sections(queries, report):
        story.append(_p(heading, "h2"))
        if description:
            story.append(_p(description))
        if not items:
            story.append(_p("No queries in this selection.", "small"))
        story.extend(_query_block(q) for q in items)

    story.append(_p("Summary", "h2"))
    by_status = Counter(q.status for q in queries)
    by_risk = Counter(q.risk_rating_current for q in queries)
    counts = Table(
        [
            [
                _count_table("By status", [(s.value, by_status[s.value]) for s in Status]),
                _count_table("By risk rating", [(r.value, by_risk[r.value]) for r in Risk]),
            ]
        ],
        colWidths=[WIDTH / 2, WIDTH / 2],
    )
    counts.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(counts)
    ids = [q.pk for q in queries]
    story.extend(_pie(breakdown(Query.objects.filter(pk__in=ids))))

    out = io.BytesIO()
    doc = SimpleDocTemplate(
        out,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=18 * mm,
        title=title,
        author=actor.full_name,
        subject=f"{org_name}: internal audit queries",
    )
    footer = _footer(org_name)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return out.getvalue()


def pdf_filename(report=None) -> str:
    stem = "audit-report" if report is not None else "audit-queries"
    return f"{stem}-{datetime.now(tz=KAMPALA):%Y-%m-%d}.pdf"
