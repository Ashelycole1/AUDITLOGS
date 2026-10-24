from django.core.management.base import BaseCommand

from apps.compliance.disposal import check_retention


class Command(BaseCommand):
    help = "List records past their retention period for the CIA to approve or reject. Runs weekly."

    def handle(self, *args, **options):
        made = check_retention()
        self.stdout.write(self.style.SUCCESS(f"Retention check: {made} new record(s) due for disposal."))
