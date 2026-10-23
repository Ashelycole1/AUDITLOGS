"""One-time links to set a password (auditlogs-additions_final.md 4: first administrator accounts).

The link carries Django's password-reset token, which stops working as soon as the password is set or
after PASSWORD_RESET_TIMEOUT. It is emailed to the person; nobody else is shown a password. Outside
production the link is also returned to the caller, because staging has no mail server yet.
"""

import logging

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from .models import User

log = logging.getLogger(__name__)


def set_password_link(user: User) -> str:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    base = (settings.APP_URL or "").rstrip("/")
    path = "/platform/set-password" if user.organization_id is None else "/set-password"
    return f"{base}{path}?uid={uid}&token={token}"


def send_set_password(user: User) -> str:
    """Email the link after commit. A mail failure is logged and never undoes the change."""
    link = set_password_link(user)
    hours = settings.PASSWORD_RESET_TIMEOUT // 3600
    text = (
        "An AuditLogs account has been set up for you.\n\n"
        f"Choose your password here: {link}\n\n"
        f"The link works once and expires in {hours} hours. If you did not expect this, ignore this email."
    )

    def deliver() -> None:
        try:
            send_mail("AuditLogs: choose your password", text, None, [user.email])
        except Exception:  # noqa: BLE001 - mail is best effort; the account itself is saved
            log.exception("Set-password email could not be sent.")

    transaction.on_commit(deliver)
    return link


def user_for_token(uid: str, token: str) -> User | None:
    try:
        pk = force_str(urlsafe_base64_decode(uid))
        user = User.objects.get(pk=pk, is_active=True)
    except (ValueError, TypeError, OverflowError, ValidationError, User.DoesNotExist):
        return None
    return user if default_token_generator.check_token(user, token) else None
