import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    PIA = "PIA", "Principal Internal Auditor"
    CIA = "CIA", "Chief Internal Auditor"
    IA = "IA", "Internal Auditor"
    CEO = "CEO", "Chief Executive"
    ICT = "ICT", "ICT administrator"


class UserManager(BaseUserManager):
    def create_user(self, email: str, full_name: str, role: str, password: str | None = None) -> "User":
        if not email:
            raise ValueError("An email address is required.")
        user = self.model(email=self.normalize_email(email).lower(), full_name=full_name, role=role)
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

    def __str__(self) -> str:
        return self.full_name

    def effective_role(self) -> str:
        if self.acting_cia_until and self.acting_cia_until > timezone.now():
            return Role.CIA
        return self.role

    def delete(self, *args, **kwargs):
        # No hard deletes (system.md 4.7): disable the account instead, so its history stays in the log.
        raise PermissionError("Accounts are disabled, never deleted.")
