from django.core.management.base import BaseCommand, CommandError

from apps.auditlog.services import record, verify_chain


class Command(BaseCommand):
    help = "Recompute every audit log fingerprint and report the first break. Runs nightly (architecture.md 5.7)."

    def handle(self, *args, **options):
        result = verify_chain()
        outcome = f"intact ({result.checked})" if result.ok else f"broken at {result.broken_at}"
        record(
            actor=None,
            action="auditlog.verify",
            object_type="AuditLog",
            object_id="chain",
            new={"result": outcome},
        )
        if not result.ok:
            # Alerting the CIA and ICT and drafting a breach register entry come with the compliance app.
            raise CommandError(f"Audit chain broken at entry {result.broken_at}.")
        self.stdout.write(self.style.SUCCESS(f"Audit chain intact: {result.checked} entries checked."))
