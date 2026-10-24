"""Account changes. Each one writes its audit entry in the same transaction (system.md 4.4)."""

from datetime import timedelta

from django.db import transaction

from apps.auditlog.services import record
from apps.core.exceptions import RuleError

from .models import Role, User


def _snapshot(user: User) -> dict:
    return {"email": user.email, "full_name": user.full_name, "role": user.role, "is_active": user.is_active}


@transaction.atomic
def create_user(
    *, actor: User, email: str, full_name: str, role: str, organization, reason: str = "", ip=None
) -> User:
    user = User.objects.create_user(email=email, full_name=full_name, role=role, organization=organization)
    record(
        actor=actor,
        action="user.create",
        object_type="User",
        object_id=user.pk,
        new=_snapshot(user),
        reason=reason,
        ip=ip,
    )
    return user


@transaction.atomic
def update_user(*, actor: User, user: User, reason: str, ip=None, **changes) -> User:
    before = _snapshot(user)
    for field in ("email", "full_name", "role"):
        if field in changes and changes[field] is not None:
            setattr(user, field, changes[field])
    if _snapshot(user) == before:
        return user
    user.save(update_fields=["email", "full_name", "role", "updated_at"])
    if before["role"] != user.role:
        action = "user.role_change"
    elif before["email"] != user.email:
        # The sign-in PIN goes to this address, so a change is recorded on its own.
        action = "user.email_change"
    else:
        action = "user.update"
    record(
        actor=actor,
        action=action,
        object_type="User",
        object_id=user.pk,
        old=before,
        new=_snapshot(user),
        reason=reason,
        ip=ip,
    )
    return user


@transaction.atomic
def set_active(*, actor: User, user: User, active: bool, reason: str, ip=None) -> User:
    if user.is_active == active:
        return user
    user.is_active = active
    user.save(update_fields=["is_active", "updated_at"])
    record(
        actor=actor,
        action="user.enable" if active else "user.disable",
        object_type="User",
        object_id=user.pk,
        old={"is_active": not active},
        new={"is_active": active},
        reason=reason,
        ip=ip,
    )
    return user


# One-time enrolment links (design.md 6, ICT) -------------------------------------------------------------


@transaction.atomic
def send_enrolment(*, actor: User, user: User, reason: str, ip=None) -> str:
    """Email a one-time link to choose a password: the first one for a new account, or a fresh one when a
    password is forgotten. ICT never sees or sets a password. The link works once and expires."""
    from axes.utils import reset as reset_lockout

    from . import passwords

    if not user.is_active:
        raise RuleError("Enable the account before sending a link.")
    reset = user.has_usable_password()
    record(
        actor=actor,
        action="user.password_reset_sent" if reset else "user.enrolment_sent",
        object_type="User",
        object_id=user.pk,
        reason=reason,
        ip=ip,
    )
    # A person locked out by failed attempts can sign in again once they have chosen a new password.
    transaction.on_commit(lambda: reset_lockout(username=user.email))
    return passwords.send_set_password(user, reset=reset)


# Acting CIA (design.md 8) ------------------------------------------------------------------------------------

MAX_ACTING_DAYS = 90


@transaction.atomic
def grant_acting_cia(*, actor: User, user: User, until, reason: str, ip=None) -> User:
    """ICT grants CIA rights to a PIA for a set time, on the CEO's or CIA's written instruction, which the
    reason must quote. The rights end by themselves; the acting CIA's actions show on CIA Activity."""
    from django.utils import timezone

    from apps.notifications import services as notify
    from apps.organizations.features import role_enabled

    user = User.objects.select_for_update().get(pk=user.pk)
    now = timezone.now()
    if user.role != Role.PIA or not user.is_active:
        raise RuleError("Only an active Principal Internal Auditor can act as CIA.")
    if not role_enabled(user.organization, Role.CIA):
        raise RuleError("The CIA role is not enabled for your organization.")
    if until <= now:
        raise RuleError("Choose an end time in the future.")
    if until > now + timedelta(days=MAX_ACTING_DAYS):
        raise RuleError(f"Acting CIA rights last at most {MAX_ACTING_DAYS} days. Grant them again if needed.")
    before = user.acting_cia_until if user.acting_cia_until and user.acting_cia_until > now else None
    user.acting_cia_until = until
    user.save(update_fields=["acting_cia_until", "updated_at"])
    record(
        actor=actor,
        action="user.acting_cia_grant",
        object_type="User",
        object_id=user.pk,
        old={"acting_cia_until": before},
        new={"acting_cia_until": until},
        reason=reason,
        ip=ip,
    )
    notify.send(
        [user, *notify.chief_auditors(user.organization_id)],
        f"{user.full_name} is acting CIA",
        "Until the date on their profile.",
        link="/profile",
        exclude=actor,
    )
    return user


@transaction.atomic
def end_acting_cia(*, actor: User, user: User, reason: str, ip=None) -> User:
    from django.utils import timezone

    user = User.objects.select_for_update().get(pk=user.pk)
    if not user.acting_cia_until or user.acting_cia_until <= timezone.now():
        raise RuleError(f"{user.full_name} is not acting CIA.")
    before = user.acting_cia_until
    user.acting_cia_until = None
    user.save(update_fields=["acting_cia_until", "updated_at"])
    record(
        actor=actor,
        action="user.acting_cia_end",
        object_type="User",
        object_id=user.pk,
        old={"acting_cia_until": before},
        new={"acting_cia_until": None},
        reason=reason,
        ip=ip,
    )
    return user
