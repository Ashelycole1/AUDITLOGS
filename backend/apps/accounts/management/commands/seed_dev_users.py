import os
import secrets

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
    help = "Create the dummy demo accounts for development and staging. Refuses to run in production."

    def add_arguments(self, parser):
        parser.add_argument(
            "--if-enabled",
            action="store_true",
            help="Do nothing unless SEED_DEMO_USERS=true (used by the staging start command).",
        )

    def handle(self, *args, **options):
        if settings.ENVIRONMENT == "prod":
            raise CommandError("seed_dev_users is for development and staging only.")
        if options["if_enabled"] and os.environ.get("SEED_DEMO_USERS", "").lower() != "true":
            return
        if settings.ENVIRONMENT == "staging" and len(os.environ.get("DEV_SEED_PASSWORD", "")) < 12:
            # On a hosted service the password must be chosen, never generated into a shared log.
            raise CommandError("Set DEV_SEED_PASSWORD (12+ characters) before seeding staging.")
        # No password is written in the code. Use DEV_SEED_PASSWORD from .env, or a random one shown once here.
        password = os.environ.get("DEV_SEED_PASSWORD") or secrets.token_urlsafe(12)
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
        self.stdout.write(self.style.SUCCESS(f"Created {created} demo accounts."))
        if created and not os.environ.get("DEV_SEED_PASSWORD"):
            self.stdout.write(
                f"Their password is {password} (random; set DEV_SEED_PASSWORD in .env to choose one)."
            )
        self.stdout.write("Sign-in PINs are printed in the runserver terminal in development.")
