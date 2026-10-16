"""The scheduler container (architecture.md 3 and 5.7): runs management commands at set Kampala times.

Only jobs that exist are listed. send_deadline_emails, expire_grants and check_retention join this
list as their tasks are built. Backups run in the separate backup service (deploy/backup/backup.sh).
"""

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.core.management import call_command
from django.core.management.base import BaseCommand

KAMPALA = ZoneInfo("Africa/Kampala")
log = logging.getLogger("auditlogs.scheduler")


@dataclass(frozen=True)
class Job:
    command: str
    hour: int
    minute: int = 0


JOBS = [
    Job("verify_audit_chain", hour=1, minute=30),
]


def next_run(job: Job, now: datetime) -> datetime:
    """The next time today or tomorrow, in Kampala, that the job is due."""
    local = now.astimezone(KAMPALA)
    due = local.replace(hour=job.hour, minute=job.minute, second=0, microsecond=0)
    return due if due > local else due + timedelta(days=1)


def run(job: Job) -> bool:
    try:
        call_command(job.command)
        return True
    except Exception:  # A failed job is logged and retried at its next time; the scheduler keeps going.
        log.exception("Scheduled job %s failed", job.command)
        return False


class Command(BaseCommand):
    help = "Run scheduled jobs (nightly audit chain verification) until stopped."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Run every job now, once, then exit.")

    def handle(self, *args, **options):
        if options["once"]:
            results = {job.command: run(job) for job in JOBS}
            self.stdout.write(
                ", ".join(f"{name}: {'ok' if ok else 'failed'}" for name, ok in results.items())
            )
            return
        self.stdout.write(
            "Scheduler started: "
            + ", ".join(f"{j.command} at {j.hour:02d}:{j.minute:02d} Kampala" for j in JOBS)
        )
        while True:
            now = datetime.now(KAMPALA)
            job, when = min(((j, next_run(j, now)) for j in JOBS), key=lambda pair: pair[1])
            time.sleep(max(1.0, (when - now).total_seconds()))
            ok = run(job)
            self.stdout.write(
                f"{datetime.now(KAMPALA):%Y-%m-%d %H:%M} {job.command}: {'ok' if ok else 'failed'}"
            )
