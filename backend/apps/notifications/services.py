"""Notifications (owner, 2026-10-22). They are in-app for now: each one is a Notification row the
person sees in AuditLogs. Email through the client's SMTP server (system.md 5) can be switched on
later with NOTIFY_BY_EMAIL=true; it is then sent after commit, one message per person, and a mail
failure is logged and never undoes the change.

A notification names the query by reference and links to it. It never carries evidence or free
text such as titles, reasons or comments (design.md 9): those stay on the query, behind its checks.
"""

import logging
from collections.abc import Iterable

from django.conf import settings
from django.core.mail import EmailMessage, get_connection
from django.db import transaction

from apps.accounts.models import Role, User

from .models import Notification

log = logging.getLogger(__name__)


def chief_auditors(organization) -> list[User]:
    """The CIAs of this one organization, and anyone acting as CIA now (design.md 8). A request never
    reaches another organization's people."""
    from django.db.models import Q
    from django.utils import timezone

    org_id = getattr(organization, "pk", organization)
    return list(
        User.objects.filter(organization_id=org_id, is_active=True).filter(
            Q(role=Role.CIA) | Q(acting_cia_until__gt=timezone.now())
        )
    )


def send(
    recipients: Iterable[User | None],
    headline: str,
    body: str = "",
    *,
    query=None,
    link: str = "",
    exclude: User | None = None,
) -> None:
    people = {
        u.pk: u
        for u in recipients
        if u is not None
        and u.is_active
        and u.organization_id is not None
        and (exclude is None or u.pk != exclude.pk)
        and (query is None or u.organization_id == query.organization_id)
    }
    if not people:
        return
    link = link or (f"/queries/{query.pk}" if query is not None else "")
    Notification.objects.bulk_create(
        [
            Notification(
                organization_id=u.organization_id,
                recipient=u,
                headline=headline,
                body=body,
                query=query,
                link=link,
            )
            for u in people.values()
        ]
    )
    if settings.NOTIFY_BY_EMAIL:
        _email(sorted(u.email for u in people.values() if u.email), headline, body, link)


def _email(emails: list[str], headline: str, body: str, link: str) -> None:
    base = (settings.APP_URL or "").rstrip("/")
    text = f"{headline}.\n\n{body}".strip() + (
        f"\n\nOpen it in AuditLogs: {base}{link}" if base and link else ""
    )

    def deliver() -> None:
        try:
            with get_connection() as connection:
                connection.send_messages(
                    [EmailMessage(f"AuditLogs: {headline}", text, to=[e]) for e in emails]
                )
        except Exception:  # noqa: BLE001 - mail is best effort; the change itself is already saved
            log.exception("Notification email could not be sent: %s", headline)

    if emails:
        transaction.on_commit(deliver)


def about_query(
    recipients: Iterable[User | None], query, headline: str, detail: str = "", *, exclude=None
) -> None:
    send(
        recipients,
        f"{query.reference} {headline[0].lower()}{headline[1:]}",
        detail,
        query=query,
        exclude=exclude,
    )
