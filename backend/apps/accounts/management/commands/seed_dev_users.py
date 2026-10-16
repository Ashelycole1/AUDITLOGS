import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.auditlog.services import record

# Dummy people only (system.md 4.10). Names match the frontend prototype's demo accounts.
DEMO_USERS = [
    ("ruth.akello@auditlogs.test", "Ruth Akello", "PIA"),
    ("daniel.okello@auditlogs.test", "Daniel Okello", "CIA"),
    ("sarah.nabirye@auditlogs.test", "Sarah Nabirye", "IA"),
    ("peter.mugisha@auditlogs.test", "Peter Mugisha", "IA"),
    ("joan.atim@auditlogs.test", "Joan Atim", "IA"),
    ("moses.kiggundu@auditlogs.test", "Moses Kiggundu", "CEO"),
    ("brian.ssali@auditlogs.test", "Brian Ssali", "ICT"),
]


class Command(BaseCommand):
    help = "Create the dummy demo accounts for local development. Refuses to run in production."

    def handle(self, *args, **options):
        if settings.ENVIRONMENT == "prod":
            raise CommandError("seed_dev_users is for development only.")
        password = os.environ.get("DEV_SEED_PASSWORD", "demo-password-2026")
        created = 0
        with transaction.atomic():
            for email, name, role in DEMO_USERS:
                if User.objects.filter(email=email).exists():
                    continue
                user = User.objects.create_user(email=email, full_name=name, role=role, password=password)
                record(
                    actor=None,
                    action="user.create",
                    object_type="User",
                    object_id=user.pk,
                    new={"email": email, "full_name": name, "role": role, "is_active": True},
                    reason="Development seed data",
                )
                created += 1
        self.stdout.write(
            self.style.SUCCESS(f"Created {created} demo accounts. Each sets up MFA on first sign-in.")
        )
