from django.core.management.base import BaseCommand

from apps.compliance.grants import expire_all


class Command(BaseCommand):
    help = "Record the end of break-glass grants and acting-CIA rights that have run out. Every 15 minutes."

    def handle(self, *args, **options):
        ended = expire_all()
        self.stdout.write(
            self.style.SUCCESS(
                f"Expired: {ended['grants']} break-glass grant(s), {ended['acting_cia']} acting-CIA right(s)."
            )
        )
