from .base import *  # noqa: F403

DEBUG = True
ENVIRONMENT = "dev"
CSRF_TRUSTED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
# Sign-in PINs are printed in the runserver terminal instead of being emailed.
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
