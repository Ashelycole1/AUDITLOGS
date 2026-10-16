from rest_framework import serializers
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.requests import client_ip

from .models import AuditLog
from .services import record, verify_chain


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.full_name", default=None, read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "seq", "timestamp", "actor", "actor_name", "actor_role", "action", "object_type", "object_id",
            "old_value", "new_value", "reason", "ip_address", "prev_hash", "entry_hash",
        ]  # fmt: skip
        read_only_fields = fields


class AuditLogListView(ListAPIView):
    """The CIA can view the log and filter by object, user, action and date (design.md 10)."""

    allowed_roles = ("CIA",)
    serializer_class = AuditLogSerializer

    def get_queryset(self):
        qs = AuditLog.objects.select_related("actor").order_by("-seq")
        p = self.request.query_params
        if p.get("actor"):
            qs = qs.filter(actor_id=p["actor"])
        if p.get("action"):
            qs = qs.filter(action__startswith=p["action"])
        if p.get("object_type"):
            qs = qs.filter(object_type=p["object_type"])
        if p.get("object_id"):
            qs = qs.filter(object_id=p["object_id"])
        if p.get("from"):
            qs = qs.filter(timestamp__date__gte=p["from"])
        return qs


class VerifyChainView(APIView):
    """Recompute the chain on demand. Returns counts only, so ICT can run it without seeing audit content."""

    allowed_roles = ("CIA", "ICT")

    def post(self, request):
        result = verify_chain()
        outcome = f"intact ({result.checked})" if result.ok else f"broken at {result.broken_at}"
        record(
            actor=request.user,
            action="auditlog.verify",
            object_type="AuditLog",
            object_id="chain",
            new={"result": outcome},
            ip=client_ip(request._request),
        )
        return Response({"ok": result.ok, "checked": result.checked, "broken_at": result.broken_at})
