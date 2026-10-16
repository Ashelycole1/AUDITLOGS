from django.db.models import Q
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
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
from apps.followup.models import Evidence, FollowUpActivity
from apps.workflow import services as workflow

from . import services
from .models import Query, QueryRevision, Risk, Status


class QueryListSerializer(serializers.ModelSerializer):
    assignee_name = serializers.CharField(source="current_assignee.full_name", default=None, read_only=True)
    batch_filename = serializers.CharField(source="batch.source_filename", read_only=True)

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
            "batch",
            "batch_filename",
            "closed_at",
        ]
        read_only_fields = fields


class QueryDetailSerializer(QueryListSerializer):
    class Meta(QueryListSerializer.Meta):
        fields = [
            *QueryListSerializer.Meta.fields,
            "description_original",
            "description_current",
            "risk_rating_original",
            "created_at",
            "updated_at",
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


class DirectStatusSerializer(ReasonSerializer):
    to_status = serializers.ChoiceField(choices=Status.choices)


READ = ("PIA", "CIA", "IA")
WORKERS = ("CIA", "IA")


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
        "assign": ("CIA",),
        "bulk_assign": ("CIA",),
        "activities": {"GET": READ, "POST": WORKERS},
        "evidence": {"GET": READ, "POST": WORKERS},
        "propose_status": ("IA",),
        "change_status": ("CIA",),
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
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("risk"):
            qs = qs.filter(risk_rating_current=p["risk"])
        if p.get("department"):
            qs = qs.filter(department=p["department"])
        if p.get("assignee") == "none":
            qs = qs.filter(current_assignee__isnull=True)
        elif p.get("assignee"):
            qs = qs.filter(current_assignee_id=p["assignee"])
        if p.get("overdue") in ("1", "true"):
            qs = qs.filter(deadline__lt=timezone.localdate()).exclude(status=Status.CLOSED)
        if p.get("q"):
            term = p["q"].strip()
            qs = qs.filter(
                Q(reference__icontains=term)
                | Q(title__icontains=term)
                | Q(description_current__icontains=term)
            )
        return qs

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
