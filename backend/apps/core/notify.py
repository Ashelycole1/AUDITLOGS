"""Email notifications (owner, 2026-10-22), sent through the client's own SMTP server (system.md 5).

Messages go out only after the change is committed, one per person so nobody sees another's
address, and a mail failure never undoes the change: it is logged for ICT instead. A message
carries the reference and a link, never evidence or free text such as titles, reasons or comments
(design.md 9): the reader opens AuditLogs to see those.
"""

import logging
from collections.abc import Iterable

from django.conf import settings
from django.core.mail import EmailMessage, get_connection
from django.db import transaction

from apps.accounts.models import Role, User

log = logging.getLogger(__name__)


def query_link(query) -> str:
    base = (settings.APP_URL or "").rstrip("/")
    return f"\n\nOpen it in AuditLogs: {base}/queries/{query.pk}" if base else ""


def chief_auditors() -> list[User]:
    return list(User.objects.filter(role=Role.CIA, is_active=True))


def send(recipients: Iterable[User | None], subject: str, body: str, *, exclude: User | None = None) -> None:
    emails = sorted(
        {
            u.email
            for u in recipients
            if u is not None and u.is_active and u.email and (exclude is None or u.pk != exclude.pk)
        }
    )
    if not emails:
        return

    def deliver() -> None:
        try:
            with get_connection() as connection:
                connection.send_messages(
                    [EmailMessage(f"AuditLogs: {subject}", body, to=[email]) for email in emails]
                )
        except Exception:  # noqa: BLE001 - mail is best effort; the change itself is already saved
            log.exception("Notification email could not be sent: %s", subject)

    transaction.on_commit(deliver)


def about_query(
    recipients: Iterable[User | None], query, headline: str, detail: str = "", *, exclude=None
) -> None:
    body = f"{headline}: {query.reference}."
    if detail:
        body += f"\n\n{detail}"
    send(
        recipients,
        f"{query.reference} {headline[0].lower()}{headline[1:]}",
        body + query_link(query),
        exclude=exclude,
    )
