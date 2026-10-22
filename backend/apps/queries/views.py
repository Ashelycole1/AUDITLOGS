from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.accounts.models import User
from apps.auditlog.models import AuditLog
from apps.core.requests import client_ip
from apps.core.scoping import ScopedQuerysetMixin
from apps.core.validators import ReasonSerializer, validate_reason
from apps.followup import services as followup
from apps.followup.models import Comment, Evidence, FollowUpActivity
from apps.workflow import exports
from apps.workflow import services as workflow

from . import services
from .filters import apply_filters
from .models import Query, QueryRevision, Risk, Status


def csv_response(content: bytes) -> HttpResponse:
    response = HttpResponse(content, content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="queries-{timezone.localdate().isoformat()}.csv"'
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "no-store"
    return response


class QueryListSerializer(serializers.ModelSerializer):
    assignee_name = serializers.CharField(source="current_assignee.full_name", default=None, read_only=True)
    assignee_role = serializers.CharField(source="current_assignee.role", default=None, read_only=True)
    batch_filename = serializers.CharField(source="batch.source_filename", read_only=True)
    imported_at = serializers.DateTimeField(source="batch.confirmed_at", read_only=True)

    class Meta:
        model = Query
        fields = [
            "id",
            "reference",
            "title",
            "risk_rating_current",
            "status",
            "deadline",
            "responsible_officer",
            "department",
            "current_assignee",
            "assignee_name",
            "assignee_role",
            "batch",
            "batch_filename",
            "imported_at",
            "closed_at",
            "description_current",
            "risk_rating_original",
        ]
        read_only_fields = fields


def _request_summary(item) -> dict | None:
    if item is None:
        return None
    return {
        "id": str(item.pk),
        "proposed_by": str(item.proposed_by_id),
        "proposed_by_name": item.proposed_by.full_name,
        "proposed_reason": item.proposed_reason,
        "decision": item.decision,
        "decided_by": str(item.decided_by_id) if item.decided_by_id else None,
        "decided_by_name": item.decided_by.full_name if item.decided_by_id else None,
        "decision_reason": item.decision_reason,
        "decided_at": item.decided_at,
        "decided_status": item.decided_status or None,
        "created_at": item.created_at,
    }


class QueryDetailSerializer(QueryListSerializer):
    pending_request = serializers.SerializerMethodField()
    last_decision = serializers.SerializerMethodField()
    pending_reassignment = serializers.SerializerMethodField()

    class Meta(QueryListSerializer.Meta):
        fields = [
            *QueryListSerializer.Meta.fields,
            "description_original",
            "pending_request",
            "last_decision",
            "pending_reassignment",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_pending_request(self, obj) -> dict | None:
        """The proposal waiting for the CIA, so the IA sees it is with the CIA."""
        pending = obj.status_requests.filter(decision="Pending").select_related("proposed_by").first()
        return _request_summary(pending)

    def get_last_decision(self, obj) -> dict | None:
        """The latest decision, so a returned query shows the reason given."""
        decided = (
            obj.status_requests.exclude(decision="Pending")
            .select_related("proposed_by", "decided_by")
            .order_by("-decided_at")
            .first()
        )
        return _request_summary(decided)

    def get_pending_reassignment(self, obj) -> dict | None:
        item = (
            obj.reassignment_requests.filter(decision="Pending")
            .select_related("requested_by", "to_assignee")
            .first()
        )
        if item is None:
            return None
        return {
            "id": str(item.pk),
            "requested_by": str(item.requested_by_id),
            "requested_by_name": item.requested_by.full_name,
            "to_assignee": str(item.to_assignee_id),
            "to_assignee_name": item.to_assignee.full_name,
            "from_status": item.from_status,
            "reason": item.reason,
            "created_at": item.created_at,
        }


class CeoQuerySerializer(serializers.ModelSerializer):
    """The fields the CEO may see (design.md 6): no wording, no evidence or responses. The responsible
    personnel, including the auditor, were added at the owner's request (2026-10-22)."""

    assignee_name = serializers.CharField(source="current_assignee.full_name", default=None, read_only=True)
    assignee_role = serializers.CharField(source="current_assignee.role", default=None, read_only=True)
    imported_at = serializers.DateTimeField(source="batch.confirmed_at", read_only=True)

    class Meta:
        model = Query
        fields = [
            "id",
            "reference",
            "title",
            "risk_rating_current",
            "status",
            "deadline",
            "responsible_officer",
            "department",
            "current_assignee",
            "assignee_name",
            "assignee_role",
            "imported_at",
            "closed_at",
        ]
        read_only_fields = fields


class QueryEditSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=300, required=False)
    description_current = serializers.CharField(required=False)
    risk_rating_current = serializers.ChoiceField(choices=Risk.choices, required=False)
    deadline = serializers.DateField(required=False)
    responsible_officer = serializers.CharField(max_length=150, required=False)
    department = serializers.CharField(max_length=150, required=False)
    reason = serializers.CharField(validators=[validate_reason])


class AssignSerializer(serializers.Serializer):
    assignee = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class BulkAssignSerializer(AssignSerializer):
    queries = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=500)


class RevisionSerializer(serializers.ModelSerializer):
    edited_by_name = serializers.CharField(source="edited_by.full_name", read_only=True)

    class Meta:
        model = QueryRevision
        fields = [
            "id",
            "field",
            "old_value",
            "new_value",
            "reason",
            "edited_by",
            "edited_by_name",
            "created_at",
        ]
        read_only_fields = fields


class HistorySerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.full_name", default=None, read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "seq",
            "timestamp",
            "actor",
            "actor_name",
            "actor_role",
            "action",
            "old_value",
            "new_value",
            "reason",
        ]
        read_only_fields = fields


class ActivitySerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", read_only=True)

    class Meta:
        model = FollowUpActivity
        fields = ["id", "kind", "body", "author", "author_name", "created_at"]
        read_only_fields = ["id", "author", "author_name", "created_at"]


class EvidenceSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True)

    class Meta:
        model = Evidence
        fields = [
            "id",
            "original_filename",
            "size_bytes",
            "content_type",
            "sha256",
            "uploaded_by",
            "uploaded_by_name",
            "created_at",
        ]
        read_only_fields = fields


class CommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", read_only=True)

    class Meta:
        model = Comment
        fields = ["id", "body", "author", "author_name", "author_role", "created_at"]
        read_only_fields = ["id", "author", "author_name", "author_role", "created_at"]


class DirectStatusSerializer(ReasonSerializer):
    to_status = serializers.ChoiceField(choices=Status.choices)


READ = ("PIA", "CIA", "IA", "SIA")
WORKERS = ("CIA", "IA", "SIA")
ASSIGNERS = ("PIA", "CIA")


class QueryViewSet(
    ScopedQuerysetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """Queries and their follow-up (design.md 6). Every lookup goes through Query.objects.for_user,
    so an IA reaches only their own assigned queries and anyone else's is a 404.
    Status changes go through apps.workflow.services only.
    """

    allowed_roles = READ
    action_roles = {
        "partial_update": ("CIA",),
        "assign": ASSIGNERS,
        "bulk_assign": ASSIGNERS,
        "activities": {"GET": READ, "POST": WORKERS},
        "evidence": {"GET": READ, "POST": WORKERS},
        "comments": {"GET": (*READ, "CEO"), "POST": ("CIA", "CEO")},
        "propose_status": ("IA", "SIA"),
        "change_status": ("CIA",),
        "export": ("CIA",),
    }
    scoped_model = Query
    parser_classes = [JSONParser, MultiPartParser]

    def _ip(self):
        return client_ip(self.request._request)

    def get_serializer_class(self):
        return QueryDetailSerializer if self.action == "retrieve" else QueryListSerializer

    def get_queryset(self):
        qs = super().get_queryset().select_related("current_assignee", "batch")
        if self.action != "list":
            return qs
        return apply_filters(qs, self.request.query_params)

    def _detail(self, query: Query) -> Response:
        return Response(
            QueryDetailSerializer(
                Query.objects.select_related("current_assignee", "batch").get(pk=query.pk)
            ).data
        )

    # CIA: correct a field after import. Each changed field becomes a revision with the reason.
    def partial_update(self, request, pk=None):
        query = self.get_object()
        data = QueryEditSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        changes = {k: v for k, v in data.validated_data.items() if k != "reason"}
        if not changes:
            raise ValidationError({"detail": "Change at least one field."})
        services.edit_query(
            query=query,
            actor=request.user,
            changes=changes,
            reason=data.validated_data["reason"],
            ip=self._ip(),
        )
        return self._detail(query)

    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        query = self.get_object()
        data = AssignSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if query.current_assignee_id and request.user.effective_role() != "CIA":
            # A PIA's reassignment waits for the CIA (owner, 2026-10-22).
            services.request_reassignment(
                query=query, actor=request.user, ip=self._ip(), **data.validated_data
            )
        else:
            services.assign(query=query, actor=request.user, ip=self._ip(), **data.validated_data)
        return self._detail(query)

    @action(detail=False, methods=["post"], url_path="bulk-assign")
    def bulk_assign(self, request):
        data = BulkAssignSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        ids = set(data.validated_data["queries"])
        queries = list(self.get_queryset().filter(pk__in=ids))
        if len(queries) != len(ids):
            raise ValidationError({"detail": "Some of these queries were not found."})
        services.bulk_assign(
            queries=queries,
            actor=request.user,
            assignee=data.validated_data["assignee"],
            reason=data.validated_data["reason"],
            ip=self._ip(),
        )
        return Response({"assigned": len(queries)})

    @action(detail=True, methods=["get"])
    def revisions(self, request, pk=None):
        query = self.get_object()
        return Response(RevisionSerializer(query.revisions.select_related("edited_by"), many=True).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        """Change history of one query (design.md 2: PIA read, CIA, IA own)."""
        query = self.get_object()
        entries = AuditLog.objects.filter(object_type="Query", object_id=str(query.pk)).select_related(
            "actor"
        )
        return Response(HistorySerializer(entries.order_by("seq"), many=True).data)

    @action(detail=True, methods=["get", "post"])
    def activities(self, request, pk=None):
        query = self.get_object()
        if request.method == "GET":
            return Response(ActivitySerializer(query.activities.select_related("author"), many=True).data)
        data = ActivitySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        activity = followup.add_activity(
            query=query,
            actor=request.user,
            kind=data.validated_data["kind"],
            body=data.validated_data["body"],
            ip=self._ip(),
        )
        return Response(ActivitySerializer(activity).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"])
    def evidence(self, request, pk=None):
        query = self.get_object()
        if request.method == "GET":
            return Response(EvidenceSerializer(query.evidence.select_related("uploaded_by"), many=True).data)
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"detail": "Choose a file to upload."})
        item = followup.add_evidence(
            query=query, actor=request.user, filename=upload.name, content=upload.read(), ip=self._ip()
        )
        return Response(EvidenceSerializer(item).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"])
    def comments(self, request, pk=None):
        """Oversight comments by the CIA and the CEO (owner, 2026-10-22). The assigned auditor reads them."""
        query = self.get_object()
        if request.method == "GET":
            return Response(CommentSerializer(query.comments.select_related("author"), many=True).data)
        data = CommentSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        comment = followup.add_comment(
            query=query, actor=request.user, body=data.validated_data["body"], ip=self._ip()
        )
        return Response(CommentSerializer(comment).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def export(self, request):
        """CIA export as CSV, with the list's filters. Logged (system.md 4.9). A PIA asks through
        /export-requests instead."""
        content, _ = exports.export_now(actor=request.user, filters=request.query_params, ip=self._ip())
        return csv_response(content)

    @action(detail=True, methods=["post"], url_path="propose-status")
    def propose_status(self, request, pk=None):
        query = self.get_object()
        data = ReasonSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        workflow.propose_closure(
            query=query, actor=request.user, reason=data.validated_data["reason"], ip=self._ip()
        )
        return self._detail(query)

    @action(detail=True, methods=["post"], url_path="status")
    def change_status(self, request, pk=None):
        """CIA direct change, for correcting mistakes. Needs a reason and shows on CIA Activity."""
        query = self.get_object()
        data = DirectStatusSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        workflow.change_directly(
            query=query,
            actor=request.user,
            to_status=data.validated_data["to_status"],
            reason=data.validated_data["reason"],
            ip=self._ip(),
        )
        return self._detail(query)


class CeoDashboardQueriesView(ScopedQuerysetMixin, generics.ListAPIView):
    """Read-only summary for the CEO dashboard (design.md 6). Summary fields only."""

    allowed_roles = ("CEO",)
    scoped_model = Query
    serializer_class = CeoQuerySerializer
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().select_related("batch", "current_assignee")


# Direct CIA changes shown to the CEO (design.md 11): the control on the person who edits and approves.
CIA_ACTIVITY_ACTIONS = ("status.direct", "query.edit", "query.reassign", "reassign.approve", "status.approve")


class CiaActivitySerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.full_name", default=None, read_only=True)
    reference = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "seq",
            "timestamp",
            "actor",
            "actor_name",
            "action",
            "object_id",
            "reference",
            "old_value",
            "new_value",
            "reason",
        ]
        read_only_fields = fields

    def get_reference(self, obj) -> str:
        return self.context["references"].get(obj.object_id, "")


class CiaActivityView(generics.ListAPIView):
    allowed_roles = ("CEO",)
    serializer_class = CiaActivitySerializer
    pagination_class = None

    def get_queryset(self):
        return (
            AuditLog.objects.filter(actor_role="CIA", action__in=CIA_ACTIVITY_ACTIONS, object_type="Query")
            .select_related("actor")
            .order_by("-seq")
        )

    def get_serializer_context(self):
        ids = list(self.get_queryset().values_list("object_id", flat=True))
        refs = dict(Query.objects.filter(pk__in=ids).values_list("pk", "reference"))
        return {**super().get_serializer_context(), "references": {str(k): v for k, v in refs.items()}}
