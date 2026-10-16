from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.requests import client_ip
from apps.core.scoping import ScopedQuerysetMixin

from . import services
from .models import StatusChangeRequest


class StatusRequestSerializer(serializers.ModelSerializer):
    reference = serializers.CharField(source="query.reference", read_only=True)
    title = serializers.CharField(source="query.title", read_only=True)
    proposed_by_name = serializers.CharField(source="proposed_by.full_name", read_only=True)
    decided_by_name = serializers.CharField(source="decided_by.full_name", default=None, read_only=True)
    responses = serializers.SerializerMethodField()
    evidence_files = serializers.SerializerMethodField()

    class Meta:
        model = StatusChangeRequest
        fields = [
            "id",
            "query",
            "reference",
            "title",
            "from_status",
            "to_status",
            "proposed_by",
            "proposed_by_name",
            "proposed_reason",
            "decision",
            "decided_by",
            "decided_by_name",
            "decision_reason",
            "decided_at",
            "created_at",
            "responses",
            "evidence_files",
        ]
        read_only_fields = fields

    def get_responses(self, obj) -> int:
        return obj.query.activities.filter(kind="ManagementResponse").count()

    def get_evidence_files(self, obj) -> int:
        return obj.query.evidence.count()


class DecisionSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class StatusRequestViewSet(ScopedQuerysetMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """The CIA's approvals inbox (design.md 6): pending first, oldest first."""

    allowed_roles = ("CIA",)
    scoped_model = StatusChangeRequest
    serializer_class = StatusRequestSerializer

    def get_queryset(self):
        qs = super().get_queryset().select_related("query", "proposed_by", "decided_by")
        decision = self.request.query_params.get("decision")
        if decision:
            qs = qs.filter(decision=decision)
        return qs.order_by("created_at")

    def _decide(self, request, approve: bool):
        item = self.get_object()
        data = DecisionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        item = services.decide(
            request_id=item.pk,
            actor=request.user,
            approve=approve,
            reason=data.validated_data["reason"],
            ip=client_ip(request._request),
        )
        return Response(StatusRequestSerializer(item).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, approve=True)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._decide(request, approve=False)
