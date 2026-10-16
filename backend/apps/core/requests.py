from django.http import HttpRequest


def client_ip(request: HttpRequest) -> str | None:
    """The address recorded in the audit log.

    Nginx is the only client of the app server, so REMOTE_ADDR is the proxy until the deploy config
    passes the real address in a header that only Nginx can set. Decided in the deployment task.
    """
    return request.META.get("REMOTE_ADDR") or None
