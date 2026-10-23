import os
import secrets

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.auditlog.services import record
from apps.organizations import features
from apps.organizations.models import Organization, OrganizationFeature, OrgStatus

# Dummy people only (system.md 4.10). Names match the frontend prototype's demo accounts.
DEMO_USERS = [
    ("ruth.akello@auditlogs.test", "Ruth Akello", "PIA"),
    ("daniel.okello@auditlogs.test", "Daniel Okello", "CIA"),
    ("sarah.nabirye@auditlogs.test", "Sarah Nabirye", "IA"),
    ("peter.mugisha@auditlogs.test", "Peter Mugisha", "IA"),
    ("joan.atim@auditlogs.test", "Joan Atim", "IA"),
    ("grace.namutebi@auditlogs.test", "Grace Namutebi", "SIA"),
    ("moses.kiggundu@auditlogs.test", "Moses Kiggundu", "CEO"),
    ("brian.ssali@auditlogs.test", "Brian Ssali", "ICT"),
]
# The platform's System Administrator, who belongs to no organization.
DEMO_SYSADMIN = ("esther.nakato@auditlogs.test", "Esther Nakato", "SYS")
DEMO_ORGANIZATION = "Demo organisation"


def demo_organization() -> Organization:
    """The organization the demo people belong to: theirs if they already exist, else a new one with
    every feature on."""
    existing = User.objects.filter(
        email__in=[e for e, _, _ in DEMO_USERS], organization__isnull=False
    ).first()
    if existing:
        return existing.organization
    org, created = Organization.objects.get_or_create(
        name=DEMO_ORGANIZATION,
        defaults={
            "country": "Uganda",
            "contact_person": "Brian Ssali",
            "email": "brian.ssali@auditlogs.test",
            "status": OrgStatus.ACTIVE,
        },
    )
    if created:
        OrganizationFeature.objects.bulk_create(
            OrganizationFeature(organization=org, feature_key=key, enabled=True)
            for key in features.FEATURE_KEYS
        )
    return org


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
            org = demo_organization()
            for email, name, role in [*DEMO_USERS, DEMO_SYSADMIN]:
                if User.objects.filter(email=email).exists():
                    continue
                home = None if role == "SYS" else org
                user = User.objects.create_user(
                    email=email, full_name=name, role=role, password=password, organization=home
                )
                record(
                    actor=None,
                    action="user.create",
                    object_type="User",
                    object_id=user.pk,
                    new={"email": email, "full_name": name, "role": role, "is_active": True},
                    reason="Development seed data",
                    organization=home,
                )
                created += 1
        self.stdout.write(self.style.SUCCESS(f"Created {created} demo accounts."))
        if created and not os.environ.get("DEV_SEED_PASSWORD"):
            self.stdout.write(
                f"Their password is {password} (random; set DEV_SEED_PASSWORD in .env to choose one)."
            )
        self.stdout.write("Sign-in PINs are printed in the runserver terminal in development.")
