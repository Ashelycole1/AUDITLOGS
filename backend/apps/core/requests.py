from django.conf import settings
from django.http import HttpRequest


def client_ip(request: HttpRequest) -> str | None:
    """The address recorded in the audit log.

    Behind Nginx every connection comes from the proxy, so the real address travels in a header.
    CLIENT_IP_HEADER names it (e.g. HTTP_X_REAL_IP). Nginx overwrites that header on every request, so a
    client cannot forge it. Without the setting (development, staging) the connection address is used.
    """
    header = getattr(settings, "CLIENT_IP_HEADER", None)
    if header:
        value = request.META.get(header, "").split(",")[0].strip()
        if value:
            return value
    return request.META.get("REMOTE_ADDR") or None
