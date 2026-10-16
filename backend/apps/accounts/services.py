"""Account changes. Each one writes its audit entry in the same transaction (system.md 4.4)."""

from django.db import transaction
from django_otp.plugins.otp_totp.models import TOTPDevice

from apps.auditlog.services import record

from .models import User


def _snapshot(user: User) -> dict:
    return {"email": user.email, "full_name": user.full_name, "role": user.role, "is_active": user.is_active}


@transaction.atomic
def create_user(*, actor: User, email: str, full_name: str, role: str, reason: str = "", ip=None) -> User:
    user = User.objects.create_user(email=email, full_name=full_name, role=role)
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
    for field in ("full_name", "role"):
        if field in changes and changes[field] is not None:
            setattr(user, field, changes[field])
    if _snapshot(user) == before:
        return user
    user.save(update_fields=["full_name", "role", "updated_at"])
    action = "user.role_change" if before["role"] != user.role else "user.update"
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


@transaction.atomic
def reset_mfa(*, actor: User, user: User, reason: str, ip=None) -> None:
    removed = TOTPDevice.objects.filter(user=user).delete()[0]
    record(
        actor=actor,
        action="user.reset_mfa",
        object_type="User",
        object_id=user.pk,
        new={"devices_removed": removed},
        reason=reason,
        ip=ip,
    )
