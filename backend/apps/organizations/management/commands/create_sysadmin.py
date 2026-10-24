from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts import passwords
from apps.accounts.models import Role, User
from apps.auditlog.services import record


class Command(BaseCommand):
    help = (
        "Create a System Administrator (auditlogs-additions_final.md 4). No password is set here: a one-time "
        "link to choose one is emailed to the address given."
    )

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--name", required=True)

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        if User.objects.filter(email=email).exists():
            raise CommandError("An account with this email already exists.")
        with transaction.atomic():
            user = User.objects.create_user(email=email, full_name=options["name"].strip(), role=Role.SYS)
            record(
                actor=None,
                action="user.create",
                object_type="User",
                object_id=user.pk,
                new={"email": user.email, "full_name": user.full_name, "role": Role.SYS, "is_active": True},
                reason="Created with the create_sysadmin command",
            )
            link = passwords.send_set_password(user)
        self.stdout.write(
            self.style.SUCCESS(f"Created System Administrator {user.email}. A set-password link was emailed.")
        )
        if settings.ENVIRONMENT != "prod":
            self.stdout.write(f"Link (shown outside production only): {link}")
