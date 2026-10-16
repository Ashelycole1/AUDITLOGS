"""Production start-up checks (architecture.md 12). The app refuses to start if any of these fail."""

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


def production_problems() -> list[str]:
    problems = []
    if settings.DEBUG:
        problems.append("DEBUG is on.")
    if not settings.SECRET_KEY or settings.SECRET_KEY == settings.DEV_SECRET_KEY:
        problems.append("DJANGO_SECRET_KEY is not set.")
    if settings.DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql":
        problems.append("The database is not PostgreSQL.")
    if not settings.ALLOWED_HOSTS or "*" in settings.ALLOWED_HOSTS:
        problems.append("ALLOWED_HOSTS must list the production host names.")
    if not settings.SESSION_COOKIE_SECURE or not settings.CSRF_COOKIE_SECURE:
        problems.append("Session and CSRF cookies must be secure.")
    return problems


def enforce_production_settings() -> None:
    if settings.ENVIRONMENT != "prod":
        return
    problems = production_problems()
    if problems:
        raise ImproperlyConfigured("Refusing to start in production: " + " ".join(problems))
