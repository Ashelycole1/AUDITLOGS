"""Staging on a hosted platform (Render): production security, DUMMY DATA ONLY.

architecture.md 9 allows a foreign staging host only because it never holds real audit data
(system.md 4.6 and 4.10). Real data belongs on the production server in Uganda (config.settings.prod).
"""

from .base import env
from .prod import *  # noqa: F403

ENVIRONMENT = "staging"

# Without an SMTP server configured, sign-in PINs are written to the service log, which only the
# owner can read. Fine for dummy accounts; set SMTP_* to email them instead.
if not env("SMTP_HOST"):
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
