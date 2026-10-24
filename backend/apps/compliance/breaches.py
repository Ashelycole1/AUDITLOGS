"""The breach register and its alerts (design.md 10 and 12). The CIA and ICT keep it (owner, 2026-10-24).

Three alerts write a draft entry by themselves and tell the organization's CIAs and ICT administrators:
the nightly chain check failing, an account being locked after failed sign-ins, and one person
downloading more than DOWNLOAD_ALERT_PER_HOUR files or exports in an hour. A draft repeats at most
once a day for the same kind and person, so one incident does not flood the register.
"""

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.auditlog.models import AuditLog
from apps.auditlog.services import record
from apps.core.exceptions import RuleError
from apps.core.validators import MIN_REASON
from apps.notifications import services as notify
from apps.organizations.models import Organization, OrgStatus

from .models import BreachKind, BreachRecord

KEEPERS = (Role.CIA, Role.ICT)
# Every way a file or export leaves the system, counted for the download-volume alert.
DOWNLOAD_ACTIONS = (
    "evidence.download",
    "import.download_original",
    "export.queries",
    "export.download",
    "export.report",
    "subject.export",
)
EDITABLE = ("description", "data_affected", "people_affected", "actions_taken", "pdpo_notified_at")


class BreachError(RuleError):
    status_code = 409


def keepers(organization) -> list[User]:
    org_id = getattr(organization, "pk", organization)
    return [
        *notify.chief_auditors(org_id),
        *User.objects.filter(organization_id=org_id, role=Role.ICT, is_active=True),
    ]


def snapshot(breach: BreachRecord) -> dict:
    return {
        "kind": breach.kind,
        "is_draft": breach.is_draft,
        **{f: getattr(breach, f) for f in EDITABLE},
        "closed_at": breach.closed_at,
    }


@transaction.atomic
def record_breach(*, actor: User, ip=None, **fields) -> BreachRecord:
    breach = BreachRecord.objects.create(
        organization_id=actor.organization_id,
        kind=BreachKind.MANUAL,
        recorded_by=actor,
        detected_at=fields.pop("detected_at", None) or timezone.now(),
        **{f: v for f, v in fields.items() if f in EDITABLE},
    )
    record(
        actor=actor,
        action="breach.record",
        object_type="BreachRecord",
        object_id=breach.pk,
        new=snapshot(breach),
        ip=ip,
    )
    notify.send(keepers(actor.organization_id), "Breach recorded", link="/compliance", exclude=actor)
    return breach


@transaction.atomic
def update_breach(*, actor: User, breach: BreachRecord, changes: dict, reason: str, ip=None) -> BreachRecord:
    """Fill in or correct an entry. Saving a draft confirms it."""
    breach = BreachRecord.objects.select_for_update().get(pk=breach.pk)
    if breach.closed_at is not None:
        raise BreachError("This entry is closed. Record a new one if something has changed.")
    before = snapshot(breach)
    for field in EDITABLE:
        if field in changes:
            setattr(breach, field, changes[field])
    breach.is_draft = False
    if snapshot(breach) == before:
        return breach
    breach.save()
    record(
        actor=actor,
        action="breach.update",
        object_type="BreachRecord",
        object_id=breach.pk,
        old=before,
        new=snapshot(breach),
        reason=reason,
        ip=ip,
    )
    return breach


@transaction.atomic
def close_breach(*, actor: User, breach: BreachRecord, reason: str, ip=None) -> BreachRecord:
    breach = BreachRecord.objects.select_for_update().get(pk=breach.pk)
    if breach.closed_at is not None:
        raise BreachError("This entry is already closed.")
    if len((reason or "").strip()) < MIN_REASON:
        raise BreachError(f"Say how it was resolved, in at least {MIN_REASON} characters.")
    breach.closed_at = timezone.now()
    breach.is_draft = False
    breach.save(update_fields=["closed_at", "is_draft", "updated_at"])
    record(
        actor=actor,
        action="breach.close",
        object_type="BreachRecord",
        object_id=breach.pk,
        old={"closed_at": None},
        new={"closed_at": breach.closed_at},
        reason=reason,
        ip=ip,
    )
    return breach


# Alerts ----------------------------------------------------------------------------------------------


def draft(
    organization, kind: str, description: str, *, subject_user: User | None = None
) -> BreachRecord | None:
    """An automatic draft, unless an open one of the same kind about the same person is under a day old."""
    org_id = getattr(organization, "pk", organization)
    recent = BreachRecord.objects.in_org(org_id).filter(
        kind=kind,
        subject_user=subject_user,
        closed_at__isnull=True,
        detected_at__gte=timezone.now() - timedelta(days=1),
    )
    if recent.exists():
        return None
    with transaction.atomic():
        breach = BreachRecord.objects.create(
            organization_id=org_id,
            kind=kind,
            is_draft=True,
            description=description,
            subject_user=subject_user,
        )
        record(
            actor=None,
            action="breach.alert",
            object_type="BreachRecord",
            object_id=breach.pk,
            new={"kind": kind, "subject": str(subject_user.pk) if subject_user else None},
            organization=org_id,
        )
        notify.send(keepers(org_id), f"Alert: {breach.get_kind_display().lower()}", link="/compliance")
    return breach


def chain_failed() -> int:
    """The chain is shared by the whole platform, so every active organization is told. The entry
    number is left out: it may belong to another organization."""
    made = 0
    for org in Organization.objects.filter(status=OrgStatus.ACTIVE):
        if draft(
            org,
            BreachKind.CHAIN,
            "The nightly check found an audit log entry that no longer matches its fingerprint. "
            "The log may have been changed outside AuditLogs. Compare it with the off-server backups.",
        ):
            made += 1
    return made


def account_locked(user: User) -> None:
    if user.organization_id is None:
        return
    draft(
        user.organization_id,
        BreachKind.LOCKOUT,
        f"The account of {user.full_name} was locked after {settings.AXES_FAILURE_LIMIT} failed sign-ins. "
        "Check with the person whether it was them.",
        subject_user=user,
    )


def after_download(actor: User) -> None:
    """Call after a download or export is logged."""
    if actor.organization_id is None:
        return
    limit = settings.DOWNLOAD_ALERT_PER_HOUR
    count = AuditLog.objects.filter(
        actor=actor, action__in=DOWNLOAD_ACTIONS, timestamp__gte=timezone.now() - timedelta(hours=1)
    ).count()
    if count >= limit:
        draft(
            actor.organization_id,
            BreachKind.DOWNLOADS,
            f"{actor.full_name} downloaded or exported {count} files in the last hour (the alert level is "
            f"{limit}). Check that it was needed.",
            subject_user=actor,
        )
