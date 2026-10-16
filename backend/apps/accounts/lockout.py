def lockout_username(request, credentials: dict | None = None) -> str | None:
    """The key django-axes counts failures against: the email, lower-cased, so case variants share one count."""
    credentials = credentials or {}
    # Axes passes the login under "username" when recording a failure and under its form-field name
    # when checking a lock, so read both.
    value = credentials.get("username") or credentials.get("email")
    if not value:
        data = getattr(request, "data", None) or getattr(request, "POST", {})
        value = data.get("email") if hasattr(data, "get") else None
    return value.strip().lower() if isinstance(value, str) and value.strip() else None


def lockout_response(request, original_response=None, credentials=None):
    """What a locked account sees: the same JSON shape as every other API error, with a plain explanation."""
    from django.http import JsonResponse

    from .views import locked_message

    return JsonResponse({"detail": locked_message(), "code": "locked"}, status=403)
