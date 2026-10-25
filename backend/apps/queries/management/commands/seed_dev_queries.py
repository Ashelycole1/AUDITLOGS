import csv
import io
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.management.commands.seed_dev_users import DEMO_USERS
from apps.accounts.models import User
from apps.followup import services as followup
from apps.followup.models import FollowUpActivity
from apps.imports import services as imports
from apps.queries import services as queries
from apps.queries.models import Query, Status
from apps.workflow import services as workflow

# Dummy queries only (agent_workflow.md 6). Each one ends at a stage of the workflow, reached through the
# same services the API uses, so the audit chain and the dashboards look like real use.
# (reference, title, description, risk, deadline in days from today, officer, department, auditor, stage)
# fmt: off
DEMO_QUERIES = [
    ("DEMO/2026/001", "Petty cash not reconciled monthly",
     "The head office float was last reconciled three months ago and no one has signed off the balance.",
     "High", 20, "Finance Manager", "Finance", "sarah.nabirye", "closed"),
    ("DEMO/2026/002", "Supplier bank details changed without call-back",
     "Bank details for two suppliers were changed on an emailed request with no call-back check.",
     "Critical", -12, "Head of Procurement", "Procurement", "peter.mugisha", "in_progress"),
    ("DEMO/2026/003", "Quarterly stock count skipped at the regional store",
     "The stock count at the regional store was skipped for two quarters. Book stock cannot be confirmed.",
     "Medium", 35, "Stores Supervisor", "Stores", "joan.atim", "proposed"),
    ("DEMO/2026/004", "Leavers still active on the payroll system",
     "Four staff who left still have active payroll records. No payments were made.",
     "High", -5, "HR Manager", "Human Resources", "sarah.nabirye", "returned"),
    ("DEMO/2026/005", "Shared administrator account on the finance system",
     "Three ICT officers sign in to the finance system with one shared administrator account.",
     "Critical", 10, "ICT Manager", "ICT", "grace.namutebi", "assigned"),
    ("DEMO/2026/006", "Fuel cards issued without a register",
     "Fuel cards were handed to drivers with no register of who holds which card.",
     "Medium", -30, "Transport Officer", "Transport", "peter.mugisha", "assigned"),
    ("DEMO/2026/007", "Board minutes not signed",
     "Minutes of the last four board meetings are unsigned drafts.",
     "Low", 45, "Company Secretary", "Legal", None, "imported"),
    ("DEMO/2026/008", "Overtime approved after payment",
     "Overtime for the stores team was approved after it had been paid in the monthly run.",
     "High", 15, "HR Manager", "Human Resources", "joan.atim", "kept"),
    ("DEMO/2026/009", "Backups never restored in a test",
     "Nightly backups run, but no restore has been tested in the last year.",
     "High", -2, "ICT Manager", "ICT", "grace.namutebi", "in_progress"),
    ("DEMO/2026/010", "Asset register missing new vehicles",
     "Two vehicles bought this year are not on the fixed asset register.",
     "Medium", 25, "Finance Manager", "Finance", "sarah.nabirye", "proposed"),
    ("DEMO/2026/011", "Contracts awarded above the threshold without tender",
     "Three contracts above the tender threshold were awarded by quotation.",
     "Critical", 7, "Head of Procurement", "Procurement", "peter.mugisha", "closed"),
    ("DEMO/2026/012", "Visitor log not kept at the main gate",
     "The main gate has no visitor log for the last two months.",
     "Low", 60, "Security Supervisor", "Administration", None, "imported"),
    ("DEMO/2026/013", "Debtors over 180 days not followed up",
     "Debtors older than 180 days have had no reminder or provision review.",
     "Medium", -18, "Credit Controller", "Finance", "joan.atim", "in_progress"),
    ("DEMO/2026/014", "Leave balances not updated after approval",
     "Approved leave is not deducted from balances in the HR system.",
     "Low", 40, "HR Manager", "Human Resources", "grace.namutebi", "closed"),
    ("DEMO/2026/015", "Firewall rules not reviewed",
     "The firewall rule set has not been reviewed since installation.",
     "High", 30, "ICT Manager", "ICT", None, "imported"),
    ("DEMO/2026/016", "Goods received without inspection",
     "Deliveries to the main store are signed for before the goods are inspected.",
     "Medium", 12, "Stores Supervisor", "Stores", "sarah.nabirye", "assigned"),
]
# fmt: on

DEMO_RESPONSE = (
    "Management agrees. The control has been put in place and the supporting records are attached."
)
DEMO_NOTE = "Met the officer responsible and walked through the process. Evidence requested."


def _person(local_part: str) -> User:
    return User.objects.get(email=f"{local_part}@auditlogs.test")


def _csv(today) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(
        ["reference", "title", "description", "risk_rating", "deadline", "responsible_officer", "department"]
    )
    for ref, title, text, risk, days, officer, dept, _, _ in DEMO_QUERIES:
        writer.writerow([ref, title, text, risk, (today + timedelta(days=days)).isoformat(), officer, dept])
    return out.getvalue().encode()


def _play(query: Query, stage: str, auditor: User, cia: User, pia: User) -> None:
    """Move one query to its stage the way the people would."""
    if stage == "imported":
        return
    query = queries.assign(query=query, actor=cia, assignee=auditor)
    if stage == "assigned":
        return
    followup.add_activity(query=query, actor=auditor, kind=FollowUpActivity.Kind.NOTE, body=DEMO_NOTE)
    if stage == "in_progress":
        return
    followup.add_activity(
        query=query, actor=auditor, kind=FollowUpActivity.Kind.MANAGEMENT_RESPONSE, body=DEMO_RESPONSE
    )
    request = workflow.propose_closure(
        query=query, actor=auditor, reason="Management response received and checked against the records."
    )
    if stage == "proposed":
        return
    if stage == "closed":
        workflow.decide(request_id=request.pk, actor=cia, approve=True)
    elif stage == "returned":
        workflow.decide(
            request_id=request.pk,
            actor=cia,
            outcome=Status.RETURNED,
            reason="The response does not show the payroll records were closed. Attach the system report.",
        )
    elif stage == "kept":
        workflow.decide(
            request_id=request.pk,
            actor=pia,
            outcome=Status.KEPT_IN_VIEW,
            reason="The new approval step is in place; keep it in view for one more payroll cycle.",
        )


class Command(BaseCommand):
    help = (
        "Import dummy queries for the demo organization and take them through the workflow. "
        "Run seed_dev_users first. Refuses to run in production."
    )

    def handle(self, *args, **options):
        if settings.ENVIRONMENT == "prod":
            raise CommandError("seed_dev_queries is for development and staging only.")
        demo_emails = [email for email, _, _ in DEMO_USERS]
        if User.objects.filter(email__in=demo_emails).count() < len(demo_emails):
            raise CommandError("Run seed_dev_users first: the demo accounts are missing.")
        cia, pia = _person("daniel.okello"), _person("ruth.akello")
        refs = [row[0] for row in DEMO_QUERIES]
        if Query.objects.in_org(cia.organization_id).filter(reference__in=refs).exists():
            self.stdout.write("The demo queries are already there. Nothing was changed.")
            return

        with transaction.atomic():
            batch = imports.upload(actor=cia, filename="demo-queries.csv", content=_csv(timezone.localdate()))
            batch = imports.confirm(actor=cia, batch_id=batch.pk)
            by_ref = {q.reference: q for q in batch.queries.all()}
            for ref, *_, auditor, stage in DEMO_QUERIES:
                _play(by_ref[ref], stage, _person(auditor) if auditor else None, cia, pia)
        self.stdout.write(self.style.SUCCESS(f"Imported {len(DEMO_QUERIES)} demo queries."))
