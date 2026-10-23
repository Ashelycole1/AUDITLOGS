from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.requests import client_ip
from apps.core.scoping import ScopedQuerysetMixin
from apps.queries import services as query_services
from apps.queries.filters import FILTER_KEYS
from apps.queries.views import export_response

from . import exports, services
from .models import ExportRequest, ReassignmentRequest, StatusChangeRequest


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
            "decided_status",
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


class DecideMixin:
    def _reason(self, request) -> str:
        data = DecisionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        return data.validated_data["reason"]

    def _ip(self):
        return client_ip(self.request._request)


class StatusRequestViewSet(DecideMixin, ScopedQuerysetMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """Closure proposals, pending first, oldest first (design.md 6). The CIA closes them; the CIA or
    the PIA may return them or keep them in view (owner, 2026-10-22)."""

    allowed_roles = ("PIA", "CIA")
    action_roles = {
        "approve": ("CIA",),
        "reject": ("PIA", "CIA"),
        "keep_in_view": ("PIA", "CIA"),
    }
    scoped_model = StatusChangeRequest
    serializer_class = StatusRequestSerializer

    def get_queryset(self):
        qs = super().get_queryset().select_related("query", "proposed_by", "decided_by")
        decision = self.request.query_params.get("decision")
        if decision:
            qs = qs.filter(decision=decision)
        return qs.order_by("created_at")

    def _decide(self, request, outcome: str):
        item = self.get_object()
        item = services.decide(
            request_id=item.pk,
            actor=request.user,
            outcome=outcome,
            reason=self._reason(request),
            ip=self._ip(),
        )
        return Response(StatusRequestSerializer(item).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, "Closed")

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._decide(request, "Returned")

    @action(detail=True, methods=["post"], url_path="keep-in-view")
    def keep_in_view(self, request, pk=None):
        return self._decide(request, "Kept in View")


class ReassignmentRequestSerializer(serializers.ModelSerializer):
    reference = serializers.CharField(source="query.reference", read_only=True)
    title = serializers.CharField(source="query.title", read_only=True)
    from_assignee_name = serializers.CharField(source="from_assignee.full_name", read_only=True)
    to_assignee_name = serializers.CharField(source="to_assignee.full_name", read_only=True)
    requested_by_name = serializers.CharField(source="requested_by.full_name", read_only=True)
    decided_by_name = serializers.CharField(source="decided_by.full_name", default=None, read_only=True)

    class Meta:
        model = ReassignmentRequest
        fields = [
            "id",
            "query",
            "reference",
            "title",
            "from_assignee",
            "from_assignee_name",
            "to_assignee",
            "to_assignee_name",
            "from_status",
            "requested_by",
            "requested_by_name",
            "reason",
            "decision",
            "decided_by",
            "decided_by_name",
            "decision_reason",
            "decided_at",
            "created_at",
        ]
        read_only_fields = fields


class ReassignmentRequestViewSet(
    DecideMixin, ScopedQuerysetMixin, mixins.ListModelMixin, viewsets.GenericViewSet
):
    """PIA reassignment requests. The PIA sees where they stand; only the CIA decides them."""

    allowed_roles = ("PIA", "CIA")
    action_roles = {"approve": ("CIA",), "reject": ("CIA",)}
    scoped_model = ReassignmentRequest
    serializer_class = ReassignmentRequestSerializer

    def get_queryset(self):
        related = ("query", "from_assignee", "to_assignee", "requested_by", "decided_by")
        qs = super().get_queryset().select_related(*related)
        decision = self.request.query_params.get("decision")
        if decision:
            qs = qs.filter(decision=decision)
        return qs.order_by("created_at")

    def _decide(self, request, approve: bool):
        item = self.get_object()
        item = query_services.decide_reassignment(
            request_id=item.pk,
            actor=request.user,
            approve=approve,
            reason=self._reason(request),
            ip=self._ip(),
        )
        return Response(ReassignmentRequestSerializer(item).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, approve=True)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._decide(request, approve=False)


class ExportRequestSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.CharField(source="requested_by.full_name", read_only=True)
    decided_by_name = serializers.CharField(source="decided_by.full_name", default=None, read_only=True)

    class Meta:
        model = ExportRequest
        fields = [
            "id",
            "filters",
            "reason",
            "requested_by",
            "requested_by_name",
            "decision",
            "decided_by",
            "decided_by_name",
            "decision_reason",
            "decided_at",
            "downloads",
            "created_at",
        ]
        read_only_fields = [f for f in fields if f not in ("filters", "reason")]

    def validate_filters(self, value):
        if not isinstance(value, dict) or set(value) - set(FILTER_KEYS):
            raise serializers.ValidationError(f"Filters may use only: {', '.join(FILTER_KEYS)}.")
        return value


class ExportRequestViewSet(DecideMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """PIA export requests (owner, 2026-10-22). The PIA asks and, once the CIA approves, downloads.
    A PIA sees only their own requests; the CIA sees all of them."""

    allowed_roles = ("PIA", "CIA")
    action_roles = {
        "create": ("PIA",),
        "approve": ("CIA",),
        "reject": ("CIA",),
        "download": ("PIA",),
    }
    serializer_class = ExportRequestSerializer

    def get_queryset(self):
        qs = ExportRequest.objects.select_related("requested_by", "decided_by").order_by("created_at")
        if self.request.user.effective_role() != "CIA":
            qs = qs.filter(requested_by=self.request.user)
        decision = self.request.query_params.get("decision")
        if decision:
            qs = qs.filter(decision=decision)
        return qs

    def create(self, request):
        data = ExportRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        item = exports.request_export(
            actor=request.user,
            filters=data.validated_data.get("filters", {}),
            reason=data.validated_data["reason"],
            ip=self._ip(),
        )
        return Response(ExportRequestSerializer(item).data, status=status.HTTP_201_CREATED)

    def _decide(self, request, approve: bool):
        item = self.get_object()
        item = exports.decide_export(
            request_id=item.pk,
            actor=request.user,
            approve=approve,
            reason=self._reason(request),
            ip=self._ip(),
        )
        return Response(ExportRequestSerializer(item).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, approve=True)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._decide(request, approve=False)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        item = self.get_object()
        content, _ = exports.download_export(request_id=item.pk, actor=request.user, ip=self._ip())
        return export_response(content)
