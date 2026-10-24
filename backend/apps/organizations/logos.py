"""Organization logos (owner, 2026-10-25).

An uploaded picture is opened with Pillow and drawn again as a PNG of at most 512 pixels a side, so what is
kept and served is always a plain image made here: no SVG (it can carry script), no metadata, and nothing
of the original file's bytes.
"""

import io

from django.urls import reverse
from PIL import Image, UnidentifiedImageError

from apps.core.exceptions import RuleError

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
MAX_SIDE = 512
# What Pillow is allowed to open. Anything else is refused before decoding.
FORMATS = ("PNG", "JPEG", "WEBP", "GIF")
# A small file that unpacks into a huge picture is refused before it is decoded.
MAX_PIXELS = 16_000_000


class LogoError(RuleError):
    """The file is not a picture that can be used as a logo."""


def normalise(content: bytes) -> bytes:
    if not content:
        raise LogoError("Choose a picture to upload.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise LogoError(f"The logo is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    try:
        with Image.open(io.BytesIO(content), formats=FORMATS) as img:
            if img.width * img.height > MAX_PIXELS:
                raise LogoError("The logo picture is too large. Use one under 4000 by 4000 pixels.")
            img.load()
            img = img.convert("RGBA")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError) as exc:
        raise LogoError("Upload the logo as a PNG, JPEG, WebP or GIF picture.") from exc
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()


def logo_url(org, *, platform: bool = False) -> str | None:
    """Where the browser fetches the logo, versioned so a new one is not hidden by the cache."""
    if org.logo_updated_at is None:
        return None
    path = (
        reverse("platform-organizations-logo", kwargs={"pk": org.pk})
        if platform
        else reverse("organization-logo")
    )
    return f"{path}?v={int(org.logo_updated_at.timestamp())}"
