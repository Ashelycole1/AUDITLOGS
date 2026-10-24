"""Break-glass access for ICT (design.md 12; owner, 2026-10-24), and the job that ends time-limited
rights when they run out.

ICT asks with a reason and the hours needed (default 2, at most 8). The CIA approves or rejects. An
approved grant lets that one ICT administrator read the organization's queries, history and evidence,
changing nothing, until it expires or is ended early. Every read is logged as breakglass.read.
"""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.auditlog.services import record
from apps.core.exceptions import RuleError
from apps.core.validators import MIN_REASON
from apps.notifications import services as notify

from .models import AccessGrant, GrantStatus

DEFAULT_HOURS = 2
MAX_HOURS = 8


class GrantError(RuleError):
    status_code = 409


def _end_expired(queryset) -> int:
    ended = 0
    for grant in queryset.filter(status=GrantStatus.APPROVED, expires_at__lte=timezone.now()):
        grant.status = GrantStatus.ENDED
        grant.ended_at = grant.expires_at
        grant.save(update_fields=["status", "ended_at", "updated_at"])
        record(
            actor=None,
            action="breakglass.expire",
            object_type="AccessGrant",
            object_id=grant.pk,
            old={"status": GrantStatus.APPROVED},
            new={"status": GrantStatus.ENDED},
            organization=grant.organization_id,
        )
        ended += 1
    return ended


@transaction.atomic
def request_grant(*, actor: User, reason: str, hours: int = DEFAULT_HOURS, ip=None) -> AccessGrant:
    if actor.role != Role.ICT:
        raise GrantError("Only ICT asks for break-glass access.")
    if len((reason or "").strip()) < MIN_REASON:
        raise GrantError(f"Say why you need access, in at least {MIN_REASON} characters.")
    if not 1 <= hours <= MAX_HOURS:
        raise GrantError(f"Ask for between 1 and {MAX_HOURS} hours.")
    _end_expired(AccessGrant.objects.filter(requested_by=actor))
    if AccessGrant.objects.filter(
        requested_by=actor, status__in=[GrantStatus.PENDING, GrantStatus.APPROVED]
    ).exists():
        raise GrantError("You already have a request waiting or access open.")
    grant = AccessGrant.objects.create(requested_by=actor, reason=reason.strip(), hours=hours)
    record(
        actor=actor,
        action="breakglass.request",
        object_type="AccessGrant",
        object_id=grant.pk,
        new={"hours": hours},
        reason=grant.reason,
        ip=ip,
    )
    notify.send(
        notify.chief_auditors(actor.organization_id),
        "Break-glass access waiting for your approval",
        f"{actor.full_name} asks to read audit content for {hours} hours.",
        link="/approvals",
    )
    return grant


@transaction.atomic
def decide_grant(*, actor: User, grant: AccessGrant, approve: bool, reason: str = "", ip=None) -> AccessGrant:
    grant = AccessGrant.objects.select_for_update().select_related("requested_by").get(pk=grant.pk)
    if actor.effective_role() != Role.CIA:
        raise GrantError("Only the CIA decides break-glass access.")
    if grant.requested_by_id == actor.pk:
        raise GrantError("You asked for this access, so someone else must decide it.")
    if grant.status != GrantStatus.PENDING:
        raise GrantError(f"This request was already {grant.status.lower()}.")
    if not approve and len((reason or "").strip()) < MIN_REASON:
        raise GrantError(f"Say why it is rejected, in at least {MIN_REASON} characters.")
    now = timezone.now()
    grant.status = GrantStatus.APPROVED if approve else GrantStatus.REJECTED
    grant.decided_by = actor
    grant.decision_reason = (reason or "").strip()
    grant.decided_at = now
    grant.expires_at = now + timedelta(hours=grant.hours) if approve else None
    grant.save()
    record(
        actor=actor,
        action="breakglass.approve" if approve else "breakglass.reject",
        object_type="AccessGrant",
        object_id=grant.pk,
        old={"status": GrantStatus.PENDING},
        new={"status": grant.status, "expires_at": grant.expires_at},
        reason=grant.decision_reason,
        ip=ip,
    )
    notify.send(
        [grant.requested_by],
        "Break-glass access approved" if approve else "Break-glass access rejected",
        f"Access ends after {grant.hours} hours." if approve else "The reason is on the request.",
        link="/break-glass",
    )
    return grant


@transaction.atomic
def end_grant(*, actor: User, grant: AccessGrant, reason: str = "", ip=None) -> AccessGrant:
    """The ICT administrator who holds it, or the CIA, can end access before it runs out."""
    grant = AccessGrant.objects.select_for_update().get(pk=grant.pk)
    if actor.effective_role() != Role.CIA and grant.requested_by_id != actor.pk:
        raise GrantError("Only the CIA or the person who holds it can end this access.")
    if not grant.is_active:
        raise GrantError("This access is not open.")
    grant.status = GrantStatus.ENDED
    grant.ended_at = timezone.now()
    grant.save(update_fields=["status", "ended_at", "updated_at"])
    record(
        actor=actor,
        action="breakglass.end",
        object_type="AccessGrant",
        object_id=grant.pk,
        old={"status": GrantStatus.APPROVED},
        new={"status": GrantStatus.ENDED},
        reason=(reason or "").strip(),
        ip=ip,
    )
    return grant


def log_read(*, actor: User, path: str, object_id="list", ip=None) -> None:
    """One entry per page or file ICT opens under a grant."""
    record(
        actor=actor,
        action="breakglass.read",
        object_type="Query",
        object_id=object_id,
        new={"path": path[:300]},
        ip=ip,
    )


@transaction.atomic
def expire_all() -> dict:
    """Run every 15 minutes (architecture.md 5.7). Access already ends on time without it, because
    each request checks the expiry; this job records the end in the log and clears the flags."""
    grants = _end_expired(AccessGrant.objects.all())
    acting = 0
    for user in User.objects.select_for_update().filter(acting_cia_until__lte=timezone.now()):
        until = user.acting_cia_until
        user.acting_cia_until = None
        user.save(update_fields=["acting_cia_until", "updated_at"])
        record(
            actor=None,
            action="user.acting_cia_expire",
            object_type="User",
            object_id=user.pk,
            old={"acting_cia_until": until},
            new={"acting_cia_until": None},
            organization=user.organization_id,
        )
        acting += 1
    return {"grants": grants, "acting_cia": acting}
