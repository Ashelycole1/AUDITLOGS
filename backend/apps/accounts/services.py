"""Account changes. Each one writes its audit entry in the same transaction (system.md 4.4)."""

from django.db import transaction

from apps.auditlog.services import record

from .models import User


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
