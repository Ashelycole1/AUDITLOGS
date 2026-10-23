"""Writing and verifying the hash-chained audit log (design.md 10, architecture.md 5.3).

entry_hash = SHA-256(prev_hash || canonical_json(entry_without_hashes)). The first entry is sealed
to a fixed genesis value. Call record() inside the same transaction as the change it records.
"""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime

from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection, transaction
from django.utils import timezone

from .models import AuditLog

GENESIS = "0" * 64
# Key for pg_advisory_xact_lock: serialises inserts so two writers never share a prev_hash.
CHAIN_LOCK_KEY = 0x4155_4449  # "AUDI"


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def normalise(value):
    """Exactly what the JSON column will hand back, so the stored value and the hashed value agree."""
    return None if value is None else json.loads(json.dumps(value, cls=DjangoJSONEncoder))


def _ts(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def body_of(entry: AuditLog) -> dict:
    body = {
        "seq": entry.seq,
        "timestamp": _ts(entry.timestamp),
        "actor": str(entry.actor_id) if entry.actor_id else None,
        "actor_role": entry.actor_role,
        "action": entry.action,
        "object_type": entry.object_type,
        "object_id": entry.object_id,
        "old_value": entry.old_value,
        "new_value": entry.new_value,
        "reason": entry.reason,
        "ip_address": entry.ip_address,
    }
    # Added with organizations. Left out when blank, so entries written before then keep their hashes.
    if entry.organization_id is not None:
        body["organization"] = str(entry.organization_id)
    return body


def hash_entry(prev_hash: str, entry: AuditLog) -> str:
    return hashlib.sha256((prev_hash + canonical(body_of(entry))).encode("utf-8")).hexdigest()


def record(
    *,
    actor,
    action: str,
    object_type: str,
    object_id,
    old=None,
    new=None,
    reason: str = "",
    ip: str | None = None,
    organization=None,
) -> AuditLog:
    """`organization` defaults to the actor's own. Pass it when there is no actor (a failed sign-in) or
    when a System Administrator acts on an organization."""
    if organization is None and actor is not None and actor.is_authenticated:
        organization = actor.organization_id
    with transaction.atomic():
        if connection.vendor == "postgresql":
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s)", [CHAIN_LOCK_KEY])
        last = AuditLog.objects.order_by("-seq").only("seq", "entry_hash").first()
        entry = AuditLog(
            seq=(last.seq + 1) if last else 1,
            timestamp=timezone.now(),
            organization_id=getattr(organization, "pk", organization),
            actor=actor if actor is not None and actor.is_authenticated else None,
            actor_role=actor.effective_role() if actor is not None and actor.is_authenticated else "",
            action=action,
            object_type=object_type,
            object_id=str(object_id),
            old_value=normalise(old),
            new_value=normalise(new),
            reason=reason or "",
            ip_address=ip,
            prev_hash=last.entry_hash if last else GENESIS,
        )
        entry.entry_hash = hash_entry(entry.prev_hash, entry)
        entry.save(force_insert=True)
        return entry


@dataclass(frozen=True)
class ChainResult:
    ok: bool
    checked: int
    broken_at: int | None = None


def verify_chain(organization=None) -> ChainResult:
    """Recompute every fingerprint in order and report the first entry that does not match.

    There is one chain for the whole platform, so it is always walked in full. With an organization the
    result speaks only of that organization's entries: how many were checked, and the break only if it
    is one of theirs (a break elsewhere is reported as broken without saying where).
    """
    org_id = getattr(organization, "pk", organization)
    prev_hash = GENESIS
    expected_seq = 1
    checked = 0
    for entry in AuditLog.objects.order_by("seq").iterator(chunk_size=2000):
        mine = org_id is None or entry.organization_id == org_id
        if (
            entry.seq != expected_seq
            or entry.prev_hash != prev_hash
            or hash_entry(prev_hash, entry) != entry.entry_hash
        ):
            return ChainResult(ok=False, checked=checked, broken_at=entry.seq if mine else None)
        prev_hash = entry.entry_hash
        expected_seq += 1
        if mine:
            checked += 1
    return ChainResult(ok=True, checked=checked)
