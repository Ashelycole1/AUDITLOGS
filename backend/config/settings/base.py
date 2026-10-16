"""Settings shared by every environment. Secrets and hosts come from environment variables only."""

import os
from datetime import timedelta
from pathlib import Path
from urllib.parse import unquote, urlparse

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parents[2]


def env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def env_list(name: str, default: str = "") -> list[str]:
    return [v.strip() for v in (env(name, default) or "").split(",") if v.strip()]


def database_from_url(url: str | None) -> dict:
    """Parse DATABASE_URL (postgres://user:pass@host:port/name). Without one, dev and tests use SQLite."""
    if not url:
        return {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "dev.sqlite3",
            "ATOMIC_REQUESTS": True,
        }
    parsed = urlparse(url)
    if parsed.scheme not in ("postgres", "postgresql"):
        raise ImproperlyConfigured("DATABASE_URL must be a postgres:// URL.")
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": parsed.path.lstrip("/"),
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname or "",
        "PORT": str(parsed.port or ""),
        "ATOMIC_REQUESTS": True,
    }


ENVIRONMENT = env("ENVIRONMENT", "dev")
DEV_SECRET_KEY = "dev-only-insecure-key-never-use-in-production"  # noqa: S105
SECRET_KEY = env("DJANGO_SECRET_KEY", DEV_SECRET_KEY)
DEBUG = False
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "rest_framework",
    "django_otp",
    "django_otp.plugins.otp_totp",
    "axes",
    "apps.core",
    "apps.accounts",
    "apps.auditlog",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django_otp.middleware.OTPMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "axes.middleware.AxesMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
TEMPLATES: list = []

DATABASES = {"default": database_from_url(env("DATABASE_URL"))}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Accounts and authentication (architecture.md 5.6).
AUTH_USER_MODEL = "accounts.User"
AUTHENTICATION_BACKENDS = [
    "axes.backends.AxesStandaloneBackend",
    "django.contrib.auth.backends.ModelBackend",
]
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Lockout: 5 failures locks the account for 15 minutes. Usernames are kept out of the application log.
AXES_FAILURE_LIMIT = int(env("AXES_FAILURE_LIMIT", "5") or 5)
AXES_COOLOFF_TIME = timedelta(minutes=int(env("AXES_COOLOFF_MINUTES", "15") or 15))
AXES_LOCKOUT_PARAMETERS = ["username"]
AXES_RESET_ON_SUCCESS = True
AXES_USERNAME_FORM_FIELD = "username"
AXES_USERNAME_CALLABLE = "apps.accounts.lockout.lockout_username"
AXES_LOCKOUT_CALLABLE = "apps.accounts.lockout.lockout_response"
AXES_VERBOSE = False
# Lockout is per account, as design.md asks. IP lockout stays off until Nginx passes the real client
# address: behind the proxy every request shares one IP, so an IP lockout would lock everyone out.
# Rate limiting by DRF throttles covers repeated attempts meanwhile.
SILENCED_SYSTEM_CHECKS = ["axes.W006"]

# Sessions: 30 minutes idle, renewed on every request.
SESSION_IDLE_MINUTES = int(env("SESSION_IDLE_MINUTES", "30") or 30)
SESSION_COOKIE_AGE = SESSION_IDLE_MINUTES * 60
SESSION_SAVE_EVERY_REQUEST = True
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
# How long a correct password stays valid while the user enters the MFA code.
MFA_PENDING_SECONDS = 300
MFA_MAX_FAILURES = 5
OTP_TOTP_ISSUER = "AuditLogs"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    # Default deny: a view without allowed_roles refuses everyone (architecture.md 5.1).
    "DEFAULT_PERMISSION_CLASSES": ["apps.core.permissions.RoleRequired"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_RATES": {"login": "10/min", "export": "10/hour"},
    "UNAUTHENTICATED_USER": None,
}

LANGUAGE_CODE = "en-gb"
TIME_ZONE = "UTC"  # Stored in UTC; the frontend displays Africa/Kampala.
USE_I18N = False
USE_TZ = True

# Application log: no personal data (architecture.md 8).
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "WARNING"},
}
