from django.db.models import Q
from django.utils import timezone
from rest_framework import mixins, serializers, viewsets

from apps.core.scoping import ScopedQuerysetMixin

from .models import Query, Status


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


class QueryViewSet(
    ScopedQuerysetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """Query list and detail (design.md 6). Read-only here; edits go through the workflow and CIA services.

    An IA sees only queries assigned to them; anyone else's query is a 404, so nothing leaks.
    """

    allowed_roles = ("PIA", "CIA", "IA")
    scoped_model = Query

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
