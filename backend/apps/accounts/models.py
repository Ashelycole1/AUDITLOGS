import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    PIA = "PIA", "Principal Internal Auditor"
    CIA = "CIA", "Chief Internal Auditor"
    IA = "IA", "Internal Auditor"
    SIA = "SIA", "Senior Internal Auditor"
    CEO = "CEO", "Chief Executive"
    ICT = "ICT", "ICT administrator"
    # Platform level: manages institutions, never audit content (auditlogs-additions_final.md 4).
    SYS = "SYS", "System Administrator"


# Roles held inside an organization. A System Administrator belongs to none.
ORG_ROLES = ("PIA", "CIA", "IA", "SIA", "CEO", "ICT")


# The audit chain, lowest first (owner's hierarchy, 2026-10-22). CEO and ICT sit outside it.
RANK = {Role.IA: 1, Role.SIA: 2, Role.PIA: 3, Role.CIA: 4}
# The roles that work queries assigned to them.
AUDITORS = (Role.IA, Role.SIA)


def rank(role: str) -> int:
    return RANK.get(role, 0)


def can_assign(actor: "User", target: "User") -> bool:
    """Assignment flows down the chain: only to an active auditor of the same organization, ranked below
    the actor."""
    return (
        target.is_active
        and target.organization_id is not None
        and target.organization_id == actor.organization_id
        and target.role in AUDITORS
        and rank(target.role) < rank(actor.effective_role())
    )


class UserManager(BaseUserManager):
    def create_user(
        self, email: str, full_name: str, role: str, password: str | None = None, organization=None
    ) -> "User":
        if not email:
            raise ValueError("An email address is required.")
        user = self.model(
            email=self.normalize_email(email).lower(),
            full_name=full_name,
            role=role,
            organization=organization,
        )
        if password:
            user.set_password(password)
        else:
            # Accounts start without a usable password until the person sets one.
            user.set_unusable_password()
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    """A person who signs in. There is no superuser: every power comes from the role (system.md 3)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Every person belongs to exactly one organization, except a System Administrator, who belongs to
    # none. An email address is unique across the platform, so a sign-in resolves to one organization.
    organization = models.ForeignKey(
        "organizations.Organization", null=True, blank=True, on_delete=models.PROTECT, related_name="users"
    )
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=150)
    role = models.CharField(max_length=3, choices=Role.choices)
    is_active = models.BooleanField(default=True)
    # Time-limited CIA rights granted by ICT on written instruction (design.md 8).
    acting_cia_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = ["full_name", "role"]

    class Meta:
        ordering = ["full_name"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(role="SYS", organization__isnull=True)
                    | (~models.Q(role="SYS") & models.Q(organization__isnull=False))
                ),
                name="sysadmin_has_no_organization",
            )
        ]

    def __str__(self) -> str:
        return self.full_name

    @property
    def is_sysadmin(self) -> bool:
        return self.role == Role.SYS

    def effective_role(self) -> str:
        if self.acting_cia_until and self.acting_cia_until > timezone.now():
            return Role.CIA
        return self.role

    def delete(self, *args, **kwargs):
        # No hard deletes (system.md 4.7): disable the account instead, so its history stays in the log.
        raise PermissionError("Accounts are disabled, never deleted.")
