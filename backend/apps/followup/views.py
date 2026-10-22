from django.http import HttpResponse
from rest_framework.generics import GenericAPIView

from apps.core.requests import client_ip
from apps.core.scoping import ScopedQuerysetMixin

from . import services
from .models import Evidence


class EvidenceDownloadView(ScopedQuerysetMixin, GenericAPIView):
    """Evidence leaves only through here, never a public URL (architecture.md 5.5). CEO never sees it."""

    allowed_roles = ("PIA", "CIA", "IA", "SIA")
    scoped_model = Evidence

    def get(self, request, pk=None):
        evidence = self.get_object()
        content = services.open_evidence(
            evidence=evidence, actor=request.user, ip=client_ip(request._request)
        )
        response = HttpResponse(content, content_type=evidence.content_type)
        safe_name = evidence.original_filename.replace('"', "").replace("\r", "").replace("\n", "")
        response["Content-Disposition"] = f'attachment; filename="{safe_name}"'
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "no-store"
        return response
