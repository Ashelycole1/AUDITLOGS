"""Start-up checks for production and staging (architecture.md 12). The app refuses to start if any fail."""

import binascii
import os

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


def _valid_fernet_key(key) -> bool:
    try:
        Fernet(key)
    except (ValueError, TypeError, binascii.Error):
        return False
    return True


def production_problems(*, require_smtp: bool = True) -> list[str]:
    problems = []
    if settings.ENVIRONMENT == "prod" and os.environ.get("RENDER"):
        # Real audit data stays in Uganda (system.md 4.6). Render is for staging with dummy data.
        problems.append(
            "Production cannot run on Render. Use config.settings.staging there, with dummy data only."
        )
    if settings.DEBUG:
        problems.append("DEBUG is on.")
    if not settings.SECRET_KEY_FROM_ENV:
        problems.append("DJANGO_SECRET_KEY is not set.")
    if settings.DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql":
        problems.append("The database is not PostgreSQL.")
    if not settings.ALLOWED_HOSTS or "*" in settings.ALLOWED_HOSTS:
        problems.append("ALLOWED_HOSTS must list the production host names.")
    if not settings.SESSION_COOKIE_SECURE or not settings.CSRF_COOKIE_SECURE:
        problems.append("Session and CSRF cookies must be secure.")
    smtp_ready = (
        settings.EMAIL_HOST and settings.EMAIL_BACKEND == "django.core.mail.backends.smtp.EmailBackend"
    )
    if settings.ENVIRONMENT == "prod" and not settings.MFA_REQUIRED:
        problems.append("MFA_REQUIRED is off. Production always needs the emailed PIN.")
    if require_smtp and not smtp_ready:
        problems.append("SMTP_HOST is not set, so sign-in PINs cannot be sent.")
    if not settings.FILE_ENCRYPTION_KEY:
        problems.append("EVIDENCE_ENCRYPTION_KEY is not set, so evidence cannot be stored.")
    elif not _valid_fernet_key(settings.FILE_ENCRYPTION_KEY):
        # Usually a paste that lost characters, such as the trailing "=".
        problems.append(
            'EVIDENCE_ENCRYPTION_KEY is not a valid key (44 characters ending in "="). Paste it again in full.'
        )
    return problems


def enforce_production_settings() -> None:
    if settings.ENVIRONMENT not in ("prod", "staging"):
        return
    # Staging may print sign-in PINs to its log instead of emailing them (config.settings.staging).
    problems = production_problems(require_smtp=settings.ENVIRONMENT == "prod")
    if problems:
        raise ImproperlyConfigured(f"Refusing to start in {settings.ENVIRONMENT}: " + " ".join(problems))
