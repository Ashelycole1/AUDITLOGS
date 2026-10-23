"""Audit reports and criteria (auditlogs-additions_final.md 8.1).

Everyone in the audit chain and the CEO can read the organization's reports; the queries listed under
each criterion are only those the reader may see (an IA or SIA sees their own). The CIA creates and
corrects reports and criteria, and exports a report as PDF. A PIA asks for the PDF through an export
request with the report as its filter.
"""

from django.db import transaction
from django.db.models import Count
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.auditlog.services import record
from apps.core.requests import client_ip
from apps.queries.models import Query
from apps.queries.stats import breakdown
from apps.queries.views import export_response
from apps.workflow import exports
from apps.workflow.models import ExportFormat

from .models import AuditReport, Criterion

READ = ("PIA", "CIA", "IA", "SIA", "CEO")


class CriterionSerializer(serializers.ModelSerializer):
    queries = serializers.IntegerField(source="query_count", read_only=True, default=0)

    class Meta:
        model = Criterion
        fields = ["id", "report", "title", "description", "position", "queries", "created_at"]
        read_only_fields = ["id", "report", "queries", "created_at"]


class ReportSerializer(serializers.ModelSerializer):
    criteria_count = serializers.IntegerField(read_only=True, default=0)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True)

    class Meta:
        model = AuditReport
        fields = [
            "id",
            "title",
            "audit_period",
            "report_date",
            "prepared_by",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
            "criteria_count",
        ]
        read_only_fields = [
            "id",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
            "criteria_count",
        ]


class ReportEditSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=300, required=False)
    audit_period = serializers.CharField(max_length=100, required=False, allow_blank=True)
    report_date = serializers.DateField(required=False, allow_null=True)
    prepared_by = serializers.CharField(max_length=150, required=False, allow_blank=True)


class CriterionEditSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=300, required=False)
    description = serializers.CharField(required=False, allow_blank=True)


def _snapshot(obj, fields) -> dict:
    return {f: (str(getattr(obj, f)) if getattr(obj, f) is not None else None) for f in fields}


class ReportViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    allowed_roles = READ
    action_roles = {
        "create": ("CIA",),
        "partial_update": ("CIA",),
        "criteria": {"GET": READ, "POST": ("CIA",)},
        "update_criterion": ("CIA",),
        "pdf": ("CIA",),
    }
    serializer_class = ReportSerializer
    pagination_class = None

    def get_queryset(self):
        return (
            AuditReport.objects.in_org(self.request.user.organization_id)
            .select_related("created_by")
            .annotate(criteria_count=Count("criteria", distinct=True))
        )

    def _ip(self):
        return client_ip(self.request._request)

    def _visible(self):
        return Query.objects.for_user(self.request.user)

    def retrieve(self, request, pk=None):
        report = self.get_object()
        visible = self._visible().filter(criterion__report=report)
        criteria = []
        for c in report.criteria.all():
            queries = visible.filter(criterion=c).select_related("current_assignee")
            criteria.append(
                {
                    **CriterionSerializer(c).data,
                    "queries": queries.count(),
                    "items": [
                        {
                            "id": str(q.pk),
                            "reference": q.reference,
                            "title": q.title,
                            "status": q.status,
                            "risk_rating_current": q.risk_rating_current,
                            "assignee_name": q.current_assignee.full_name if q.current_assignee_id else None,
                        }
                        for q in queries
                    ],
                }
            )
        return Response(
            {**ReportSerializer(report).data, "criteria": criteria, "summary": breakdown(visible)}
        )

    @transaction.atomic
    def create(self, request):
        data = ReportSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        report = AuditReport.objects.create(
            organization_id=request.user.organization_id, created_by=request.user, **data.validated_data
        )
        record(
            actor=request.user,
            action="report.create",
            object_type="AuditReport",
            object_id=report.pk,
            new=_snapshot(report, ("title", "audit_period", "report_date", "prepared_by")),
            ip=self._ip(),
        )
        return Response(
            ReportSerializer(self.get_queryset().get(pk=report.pk)).data, status=status.HTTP_201_CREATED
        )

    @transaction.atomic
    def partial_update(self, request, pk=None):
        report = self.get_object()
        data = ReportEditSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        fields = list(data.validated_data)
        before = _snapshot(report, fields)
        for f, v in data.validated_data.items():
            setattr(report, f, v)
        after = _snapshot(report, fields)
        if before != after:
            report.save(update_fields=[*fields, "updated_at"])
            record(
                actor=request.user,
                action="report.edit",
                object_type="AuditReport",
                object_id=report.pk,
                old=before,
                new=after,
                ip=self._ip(),
            )
        return Response(ReportSerializer(self.get_queryset().get(pk=report.pk)).data)

    @action(detail=True, methods=["get", "post"])
    def criteria(self, request, pk=None):
        report = self.get_object()
        if request.method == "GET":
            items = report.criteria.annotate(query_count=Count("queries"))
            return Response(CriterionSerializer(items, many=True).data)
        data = CriterionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        title = data.validated_data["title"].strip()
        if report.criteria.filter(title=title).exists():
            return Response(
                {"detail": "This report already has a criterion with that title."},
                status=status.HTTP_409_CONFLICT,
            )
        with transaction.atomic():
            criterion = Criterion.objects.create(
                report=report,
                title=title,
                description=data.validated_data.get("description", ""),
                position=report.criteria.count() + 1,
            )
            record(
                actor=request.user,
                action="criterion.create",
                object_type="AuditReport",
                object_id=report.pk,
                new={"criterion": str(criterion.pk), "title": criterion.title},
                ip=self._ip(),
            )
        return Response(CriterionSerializer(criterion).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["patch"], url_path=r"criteria/(?P<criterion_id>[0-9a-f-]{36})")
    def update_criterion(self, request, pk=None, criterion_id=None):
        report = self.get_object()
        criterion = report.criteria.filter(pk=criterion_id).first()
        if criterion is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        data = CriterionEditSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        fields = list(data.validated_data)
        before = _snapshot(criterion, fields)
        for f, v in data.validated_data.items():
            setattr(criterion, f, v.strip() if isinstance(v, str) else v)
        after = _snapshot(criterion, fields)
        if before != after:
            if (
                "title" in fields
                and report.criteria.exclude(pk=criterion.pk).filter(title=criterion.title).exists()
            ):
                return Response(
                    {"detail": "This report already has a criterion with that title."},
                    status=status.HTTP_409_CONFLICT,
                )
            with transaction.atomic():
                criterion.save(update_fields=[*fields, "updated_at"])
                record(
                    actor=request.user,
                    action="criterion.edit",
                    object_type="AuditReport",
                    object_id=report.pk,
                    old={"criterion": str(criterion.pk), **before},
                    new={"criterion": str(criterion.pk), **after},
                    ip=self._ip(),
                )
        return Response(CriterionSerializer(criterion).data)

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        report = self.get_object()
        content = exports.export_report(actor=request.user, report=report, ip=self._ip())
        return export_response(content, ExportFormat.PDF, report)
