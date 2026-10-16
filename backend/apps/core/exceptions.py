from rest_framework.response import Response
from rest_framework.views import exception_handler


class RuleError(Exception):
    """A business rule refused the request. The message is shown to the user as it is."""

    status_code = 400


def handler(exc, context):
    if isinstance(exc, RuleError):
        return Response({"detail": str(exc)}, status=exc.status_code)
    return exception_handler(exc, context)
