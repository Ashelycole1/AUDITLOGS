"""Encrypted file storage for evidence and import source files (architecture.md 5.5).

Files are written under a random name outside any web root, encrypted with Fernet (AES-128-CBC plus
HMAC-SHA256). The key comes from EVIDENCE_ENCRYPTION_KEY and is held apart from the backups.
Every read checks the SHA-256 recorded when the file arrived.
"""

import hashlib
import uuid
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from apps.core.exceptions import RuleError


class StoredFileError(RuleError):
    """The stored file is missing, cannot be decrypted, or does not match its fingerprint."""

    status_code = 409


def _fernet() -> Fernet:
    key = settings.FILE_ENCRYPTION_KEY
    if not key:
        raise ImproperlyConfigured("EVIDENCE_ENCRYPTION_KEY is not set.")
    return Fernet(key)


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def org_folder(root: str, organization_id) -> str:
    """Each organization's files live under a folder of its own (auditlogs-additions_final.md 3.4)."""
    return str(Path(root) / str(organization_id))


def save_encrypted(content: bytes, folder: str) -> str:
    target = Path(folder)
    target.mkdir(parents=True, exist_ok=True)
    path = target / uuid.uuid4().hex
    path.write_bytes(_fernet().encrypt(content))
    return str(path)


def read_encrypted(path: str, expected_sha256: str) -> bytes:
    try:
        content = _fernet().decrypt(Path(path).read_bytes())
    except (OSError, InvalidToken) as exc:
        raise StoredFileError("The stored file could not be read. Tell ICT.") from exc
    if sha256(content) != expected_sha256:
        raise StoredFileError("The stored file does not match its fingerprint. Tell ICT.")
    return content
