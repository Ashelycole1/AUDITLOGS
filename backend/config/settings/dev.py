from cryptography.fernet import Fernet

from .base import *  # noqa: F403
from .base import BASE_DIR, FILE_ENCRYPTION_KEY

DEBUG = True
ENVIRONMENT = "dev"
CSRF_TRUSTED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
# Sign-in PINs are printed in the runserver terminal instead of being emailed.
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Without EVIDENCE_ENCRYPTION_KEY, dev keeps its own key in backend/var (git-ignored), so files stay
# readable across restarts. Production must set the variable.
if not FILE_ENCRYPTION_KEY:
    _key_file = BASE_DIR / "var" / "dev-file.key"
    if not _key_file.exists():
        _key_file.parent.mkdir(parents=True, exist_ok=True)
        _key_file.write_bytes(Fernet.generate_key())
    FILE_ENCRYPTION_KEY = _key_file.read_bytes().strip()
