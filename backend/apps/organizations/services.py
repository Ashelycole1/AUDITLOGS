"""Managing institutions (auditlogs-additions_final.md 4 to 6). Every change writes its audit entry,
tagged with the organization it concerns, in the same transaction."""

import logging

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from apps.accounts import passwords
from apps.accounts.models import Role, User
from apps.auditlog.services import record
from apps.core.exceptions import RuleError
from apps.core.filestore import sha256
from apps.core.validators import MIN_REASON

from . import features as catalogue
from . import logos
from .models import Organization, OrganizationFeature, OrgStatus

log = logging.getLogger(__name__)

VERIFY_SALT = "auditlogs.organization-email"
VERIFY_MAX_AGE = 3 * 24 * 3600

# action -> (statuses it may start from, status it leads to, reason required)
STATUS_MOVES = {
    "approve": ({OrgStatus.PENDING}, OrgStatus.ACTIVE, False),
    "reject": ({OrgStatus.PENDING}, OrgStatus.REJECTED, True),
    "suspend": ({OrgStatus.ACTIVE}, OrgStatus.SUSPENDED, True),
    "reactivate": ({OrgStatus.SUSPENDED, OrgStatus.DEACTIVATED}, OrgStatus.ACTIVE, True),
    "deactivate": ({OrgStatus.ACTIVE, OrgStatus.SUSPENDED}, OrgStatus.DEACTIVATED, True),
}


class OrganizationError(RuleError):
    status_code = 409


def _check_reason(reason: str, what: str) -> None:
    if len((reason or "").strip()) < MIN_REASON:
        raise OrganizationError(f"Say why you {what}, in at least {MIN_REASON} characters.")


def snapshot(org: Organization) -> dict:
    return {
        "name": org.name,
        "country": org.country,
        "contact_person": org.contact_person,
        "email": org.email,
        "phone": org.phone,
        "address": org.address,
        "website": org.website,
        "status": org.status,
    }


def feature_map(org: Organization) -> dict[str, bool]:
    stored = dict(org.features.values_list("feature_key", "enabled"))
    return {key: bool(stored.get(key, False)) for key in catalogue.FEATURE_KEYS}


def _mail(to: list[str], subject: str, text: str) -> None:
    """Best effort, after commit: a mail failure is logged and never undoes the change."""
    to = [e for e in to if e]
    if not to:
        return

    def deliver() -> None:
        try:
            send_mail(f"AuditLogs: {subject}", text, None, to)
        except Exception:  # noqa: BLE001
            log.exception("Organization email could not be sent: %s", subject)

    transaction.on_commit(deliver)


# Features ---------------------------------------------------------------------------------------------


def resolve_features(
    *, preset: str | None = None, values: dict | None = None, base: dict | None = None
) -> dict:
    """A full on/off map from a preset and/or individual switches laid over `base`."""
    result = dict(base or catalogue.PRESETS[catalogue.DEFAULT_PRESET])
    if preset:
        if preset not in catalogue.PRESETS:
            raise OrganizationError(f"Unknown preset. Use one of: {', '.join(catalogue.PRESETS)}.")
        result = dict(catalogue.PRESETS[preset])
    unknown = set(values or {}) - set(catalogue.FEATURE_KEYS)
    if unknown:
        raise OrganizationError(f"Unknown features: {', '.join(sorted(unknown))}.")
    result.update({k: bool(v) for k, v in (values or {}).items()})
    return result


def check_features(org: Organization, wanted: dict[str, bool]) -> None:
    """The safeguards of section 5.2. A dashboard cannot go off while active people hold its role."""
    for key in catalogue.REQUIRED:
        if not wanted.get(key):
            raise OrganizationError(
                f"The {catalogue.LABELS[key]} must stay on: it is where queries are worked."
            )
    for role in catalogue.DASHBOARD_ROLES:
        if wanted.get(catalogue.dashboard_key(role)):
            continue
        holders = User.objects.filter(organization=org, role=role, is_active=True).count()
        if holders:
            people = "person holds" if holders == 1 else "people hold"
            raise OrganizationError(
                f"{holders} active {people} the {Role(role).label} role in {org.name}. Their ICT "
                f"administrator must change the role or disable the account before the {role} "
                "dashboard can be switched off."
            )


def _store_features(org: Organization, wanted: dict[str, bool], actor) -> dict:
    before = feature_map(org)
    for key, enabled in wanted.items():
        OrganizationFeature.objects.update_or_create(
            organization=org, feature_key=key, defaults={"enabled": enabled, "updated_by": actor}
        )
    org._enabled_features = None
    return before


@transaction.atomic
def set_features(*, org: Organization, actor, wanted: dict[str, bool], reason: str = "", ip=None) -> dict:
    org = Organization.objects.select_for_update().get(pk=org.pk)
    check_features(org, wanted)
    before = _store_features(org, wanted, actor)
    after = feature_map(org)
    changed = {k: after[k] for k in after if before[k] != after[k]}
    if changed:
        record(
            actor=actor,
            action="organization.features",
            object_type="Organization",
            object_id=org.pk,
            old={k: before[k] for k in changed},
            new=changed,
            reason=reason,
            ip=ip,
            organization=org,
        )
    return after


# Lifecycle --------------------------------------------------------------------------------------------


@transaction.atomic
def change_status(
    *, org: Organization, actor, move: str, reason: str = "", wanted: dict | None = None, ip=None
) -> Organization:
    org = Organization.objects.select_for_update().get(pk=org.pk)
    sources, target, needs_reason = STATUS_MOVES[move]
    if org.status not in sources:
        raise OrganizationError(f"An organization that is {org.status} cannot be {move}d.")
    if needs_reason:
        _check_reason(reason, move + " it")
    before = org.status
    org.status = target
    fields = ["status", "updated_at"]
    if move == "approve":
        org.approved_at = timezone.now()
        fields.append("approved_at")
    org.save(update_fields=fields)
    record(
        actor=actor,
        action=f"organization.{move}",
        object_type="Organization",
        object_id=org.pk,
        old={"status": before},
        new={"status": target},
        reason=reason,
        ip=ip,
        organization=org,
    )
    if move == "approve":
        # Every new organization gets a package on approval (section 5.2, defaults).
        set_features(org=org, actor=actor, wanted=wanted or resolve_features(), reason=reason, ip=ip)
        _mail(
            [org.email],
            "your organization is approved",
            f"{org.name} is approved on AuditLogs. Your administrator can now sign in and add your people.",
        )
    elif move in ("reject", "suspend", "deactivate"):
        _mail(
            [org.email], f"your organization is {target.lower()}", f"{org.name} is now {target} on AuditLogs."
        )
    return org


@transaction.atomic
def update_details(*, org: Organization, actor, changes: dict, reason: str = "", ip=None) -> Organization:
    org = Organization.objects.select_for_update().get(pk=org.pk)
    before = snapshot(org)
    for field, value in changes.items():
        setattr(org, field, value)
    if snapshot(org) == before:
        return org
    org.save(update_fields=[*changes, "updated_at"])
    after = snapshot(org)
    record(
        actor=actor,
        action="organization.update",
        object_type="Organization",
        object_id=org.pk,
        old={k: before[k] for k in after if before[k] != after[k]},
        new={k: after[k] for k in after if before[k] != after[k]},
        reason=reason,
        ip=ip,
        organization=org,
    )
    return org


@transaction.atomic
def set_logo(*, org: Organization, actor, content: bytes | None, reason: str = "", ip=None) -> Organization:
    """Put up a new logo, or take it down with None. The log keeps the picture's fingerprint, not the
    picture."""
    _check_reason(reason, "change the logo")
    org = Organization.objects.select_for_update().get(pk=org.pk)
    png = logos.normalise(content) if content is not None else None
    if png is None and org.logo is None:
        raise OrganizationError("This organization has no logo to remove.")
    old = {"logo_sha256": org.logo_sha256 or None}
    org.logo = png
    org.logo_sha256 = sha256(png) if png else ""
    org.logo_updated_at = timezone.now() if png else None
    org.save(update_fields=["logo", "logo_sha256", "logo_updated_at", "updated_at"])
    record(
        actor=actor,
        action="organization.logo" if png else "organization.logo_remove",
        object_type="Organization",
        object_id=org.pk,
        old=old,
        new={"logo_sha256": org.logo_sha256 or None, "bytes": len(png) if png else 0},
        reason=reason,
        ip=ip,
        organization=org,
    )
    return org


@transaction.atomic
def create_organization(*, actor, details: dict, wanted: dict, ip=None) -> Organization:
    """Created by the System Administrator: active straight away, with the chosen package."""
    org = Organization.objects.create(**details, status=OrgStatus.ACTIVE, approved_at=timezone.now())
    record(
        actor=actor,
        action="organization.create",
        object_type="Organization",
        object_id=org.pk,
        new=snapshot(org),
        ip=ip,
        organization=org,
    )
    set_features(org=org, actor=actor, wanted=wanted, ip=ip)
    return org


@transaction.atomic
def set_admin(*, org: Organization, actor, email: str, full_name: str, reason: str = "", ip=None):
    """Create the organization's first ICT administrator, or reset one: the old password stops working,
    any lockout is cleared and a fresh one-time link to choose a password is emailed.
    Returns (user, created, link)."""
    email = email.strip().lower()
    user = User.objects.filter(email=email).first()
    created = user is None
    if user is not None and (user.organization_id != org.pk or user.role != Role.ICT):
        raise OrganizationError("This email belongs to another account. Use the administrator's own address.")
    if created:
        user = User.objects.create_user(email=email, full_name=full_name, role=Role.ICT, organization=org)
    else:
        _check_reason(reason, "reset this administrator")
        user.set_unusable_password()
        user.is_active = True
        user.save(update_fields=["password", "is_active", "updated_at"])
        from axes.utils import reset as reset_lockout

        reset_lockout(username=user.email)
    record(
        actor=actor,
        action="organization.admin_create" if created else "organization.admin_reset",
        object_type="User",
        object_id=user.pk,
        new={"email": user.email, "full_name": user.full_name, "role": Role.ICT},
        reason=reason,
        ip=ip,
        organization=org,
    )
    link = passwords.send_set_password(user)
    return user, created, link


# Sign-up ----------------------------------------------------------------------------------------------


def verification_link(org: Organization) -> str:
    token = signing.dumps({"org": str(org.pk), "email": org.email}, salt=VERIFY_SALT)
    return f"{(settings.APP_URL or '').rstrip('/')}/verify-email?token={token}"


@transaction.atomic
def sign_up(*, details: dict, password: str, ip=None) -> tuple[Organization, User, str]:
    """A public sign-up (section 6). The organization starts Pending; the person who signs up becomes its
    ICT administrator and can sign in once the System Administrator approves it."""
    org = Organization.objects.create(**details, status=OrgStatus.PENDING)
    admin = User.objects.create_user(
        email=org.email,
        full_name=org.contact_person,
        role=Role.ICT,
        password=password,
        organization=org,
    )
    record(
        actor=None,
        action="organization.signup",
        object_type="Organization",
        object_id=org.pk,
        new={**snapshot(org), "admin": str(admin.pk)},
        ip=ip,
        organization=org,
    )
    link = verification_link(org)
    _mail(
        [org.email],
        "confirm your email address",
        f"Thank you for signing up {org.name} to AuditLogs.\n\nConfirm this email address here: {link}\n\n"
        "The platform administrator will review the sign-up, and we will email you when it is approved.",
    )
    _mail(
        list(User.objects.filter(role=Role.SYS, is_active=True).values_list("email", flat=True)),
        "new organization waiting for approval",
        "A new organization has signed up and is waiting for your approval in the platform dashboard.",
    )
    return org, admin, link


@transaction.atomic
def verify_email(*, token: str, ip=None) -> Organization:
    try:
        data = signing.loads(token, salt=VERIFY_SALT, max_age=VERIFY_MAX_AGE)
    except signing.BadSignature as exc:
        raise OrganizationError("This link has expired or is not valid.") from exc
    org = Organization.objects.select_for_update().filter(pk=data.get("org"), email=data.get("email")).first()
    if org is None:
        raise OrganizationError("This link has expired or is not valid.")
    if org.email_verified_at is None:
        org.email_verified_at = timezone.now()
        org.save(update_fields=["email_verified_at", "updated_at"])
        record(
            actor=None,
            action="organization.email_verified",
            object_type="Organization",
            object_id=org.pk,
            ip=ip,
            organization=org,
        )
    return org
