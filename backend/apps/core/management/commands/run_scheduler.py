"""The scheduler container (architecture.md 3 and 5.7): runs management commands at set Kampala times.

Only jobs that exist are listed; send_deadline_emails joins when deadline emails are built. Backups run
in the separate backup service (deploy/backup/backup.sh).
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
    hour: int = 0
    minute: int = 0
    # Monday is 0. Set for a weekly job.
    weekday: int | None = None
    # Set for a job that repeats through the day, on the clock (every 15 minutes: :00, :15, :30, :45).
    every_minutes: int | None = None

    def describe(self) -> str:
        if self.every_minutes:
            return f"{self.command} every {self.every_minutes} minutes"
        day = f" on {'Mon Tue Wed Thu Fri Sat Sun'.split()[self.weekday]}" if self.weekday is not None else ""
        return f"{self.command}{day} at {self.hour:02d}:{self.minute:02d} Kampala"


JOBS = [
    Job("verify_audit_chain", hour=1, minute=30),
    Job("expire_grants", every_minutes=15),
    Job("check_retention", hour=3, minute=0, weekday=0),
]


def next_run(job: Job, now: datetime) -> datetime:
    """The next time, in Kampala, that the job is due."""
    local = now.astimezone(KAMPALA)
    if job.every_minutes:
        start = local.replace(minute=0, second=0, microsecond=0)
        steps = (local - start) // timedelta(minutes=job.every_minutes) + 1
        return start + steps * timedelta(minutes=job.every_minutes)
    due = local.replace(hour=job.hour, minute=job.minute, second=0, microsecond=0)
    if job.weekday is not None:
        due += timedelta(days=(job.weekday - due.weekday()) % 7)
        return due if due > local else due + timedelta(days=7)
    return due if due > local else due + timedelta(days=1)


def run(job: Job) -> bool:
    try:
        call_command(job.command)
        return True
    except Exception:  # A failed job is logged and retried at its next time; the scheduler keeps going.
        log.exception("Scheduled job %s failed", job.command)
        return False


class Command(BaseCommand):
    help = "Run scheduled jobs (chain verification, grant expiry, retention check) until stopped."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Run every job now, once, then exit.")

    def handle(self, *args, **options):
        if options["once"]:
            results = {job.command: run(job) for job in JOBS}
            self.stdout.write(
                ", ".join(f"{name}: {'ok' if ok else 'failed'}" for name, ok in results.items())
            )
            return
        self.stdout.write("Scheduler started: " + ", ".join(j.describe() for j in JOBS))
        while True:
            now = datetime.now(KAMPALA)
            job, when = min(((j, next_run(j, now)) for j in JOBS), key=lambda pair: pair[1])
            time.sleep(max(1.0, (when - now).total_seconds()))
            ok = run(job)
            self.stdout.write(
                f"{datetime.now(KAMPALA):%Y-%m-%d %H:%M} {job.command}: {'ok' if ok else 'failed'}"
            )
