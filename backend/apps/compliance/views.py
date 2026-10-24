"""Compliance endpoints (architecture.md 6): retention rules, disposals, the breach register, data
subject search and export, and break-glass requests. Every change goes through a service that writes
the audit entry; every list is limited to the signed-in person's organization."""

from django.db.models import Q
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.auditlog.models import AuditLog
from apps.core.requests import client_ip
from apps.core.validators import ReasonSerializer, validate_reason
from apps.queries import workbook
from apps.queries.views import XLSX

from . import breaches, disposal, grants, subject
from .models import AccessGrant, BreachRecord, DisposalRecord, RecordType, RetentionRule

KEEPERS = ("CIA", "ICT")


class OrgViewMixin:
    model = None

    def get_queryset(self):
        return self.model.objects.in_org(self.request.user.organization_id)

    def _ip(self):
        return client_ip(self.request._request)


# Retention and disposal ------------------------------------------------------------------------------


class RetentionRuleSerializer(serializers.ModelSerializer):
    approved_by_name = serializers.CharField(source="approved_by.full_name", read_only=True)
    label = serializers.CharField(source="get_record_type_display", read_only=True)

    class Meta:
        model = RetentionRule
        fields = [
            "id",
            "record_type",
            "label",
            "retention_months",
            "approved_by_name",
            "approved_at",
            "reason",
        ]
        read_only_fields = fields


class SetRuleSerializer(serializers.Serializer):
    record_type = serializers.ChoiceField(choices=RecordType.choices)
    retention_months = serializers.IntegerField(min_value=1, max_value=disposal.MAX_MONTHS)
    reason = serializers.CharField(validators=[validate_reason])


class RetentionRuleViewSet(OrgViewMixin, viewsets.GenericViewSet):
    """GET lists every record type with its rule (or none yet); POST sets one. CIA only."""

    allowed_roles = ("CIA",)
    model = RetentionRule
    pagination_class = None

    def list(self, request):
        rules = {r.record_type: r for r in self.get_queryset().select_related("approved_by")}
        return Response(
            [
                {
                    "record_type": value,
                    "label": label,
                    "rule": RetentionRuleSerializer(rules[value]).data if value in rules else None,
                }
                for value, label in RecordType.choices
            ]
        )

    def create(self, request):
        data = SetRuleSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        rule = disposal.set_rule(
            actor=request.user,
            record_type=data.validated_data["record_type"],
            months=data.validated_data["retention_months"],
            reason=data.validated_data["reason"],
            ip=self._ip(),
        )
        return Response(RetentionRuleSerializer(rule).data, status=status.HTTP_201_CREATED)


class DisposalSerializer(serializers.ModelSerializer):
    approved_by_name = serializers.CharField(source="approved_by.full_name", default=None, read_only=True)
    record_type_label = serializers.CharField(source="get_record_type_display", read_only=True)

    class Meta:
        model = DisposalRecord
        fields = [
            "id",
            "record_type",
            "record_type_label",
            "object_id",
            "label",
            "since",
            "retention_months",
            "status",
            "approved_by_name",
            "reason",
            "decided_at",
            "disposed_at",
            "created_at",
        ]
        read_only_fields = fields


class DisposalViewSet(OrgViewMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    allowed_roles = ("CIA",)
    model = DisposalRecord
    serializer_class = DisposalSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset().select_related("approved_by")
        wanted = self.request.query_params.get("status")
        return qs.filter(status=wanted) if wanted else qs

    @action(detail=False, methods=["post"])
    def check(self, request):
        """Run the retention check for this organization now, rather than waiting for the weekly run."""
        return Response({"flagged": disposal.check_organization(request.user.organization)})

    def _decide(self, request, approve: bool):
        item = self.get_object()
        data = ReasonSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        item = disposal.decide(
            actor=request.user,
            item=item,
            approve=approve,
            reason=data.validated_data["reason"],
            ip=self._ip(),
        )
        return Response(DisposalSerializer(item).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, True)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._decide(request, False)


# Breach register ------------------------------------------------------------------------------------


class BreachSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    recorded_by_name = serializers.CharField(source="recorded_by.full_name", default=None, read_only=True)
    subject_name = serializers.CharField(source="subject_user.full_name", default=None, read_only=True)

    class Meta:
        model = BreachRecord
        fields = [
            "id",
            "kind",
            "kind_label",
            "is_draft",
            "detected_at",
            "description",
            "data_affected",
            "people_affected",
            "actions_taken",
            "pdpo_notified_at",
            "closed_at",
            "subject_name",
            "recorded_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class BreachWriteSerializer(serializers.Serializer):
    detected_at = serializers.DateTimeField(required=False)
    description = serializers.CharField(min_length=10, required=False)
    data_affected = serializers.CharField(required=False, allow_blank=True)
    people_affected = serializers.CharField(required=False, allow_blank=True)
    actions_taken = serializers.CharField(required=False, allow_blank=True)
    pdpo_notified_at = serializers.DateTimeField(required=False, allow_null=True)


class BreachUpdateSerializer(BreachWriteSerializer):
    reason = serializers.CharField(validators=[validate_reason])


class BreachViewSet(OrgViewMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """The CIA and ICT keep the register together (owner, 2026-10-24)."""

    allowed_roles = KEEPERS
    model = BreachRecord
    serializer_class = BreachSerializer
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().select_related("recorded_by", "subject_user")

    def create(self, request):
        data = BreachWriteSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if not data.validated_data.get("description"):
            raise serializers.ValidationError({"description": ["Describe what happened."]})
        breach = breaches.record_breach(actor=request.user, ip=self._ip(), **data.validated_data)
        return Response(BreachSerializer(breach).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        breach = self.get_object()
        data = BreachUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        changes = {k: v for k, v in data.validated_data.items() if k in breaches.EDITABLE}
        breach = breaches.update_breach(
            actor=request.user,
            breach=breach,
            changes=changes,
            reason=data.validated_data["reason"],
            ip=self._ip(),
        )
        return Response(BreachSerializer(breach).data)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        breach = self.get_object()
        data = ReasonSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        breach = breaches.close_breach(
            actor=request.user, breach=breach, reason=data.validated_data["reason"], ip=self._ip()
        )
        return Response(BreachSerializer(breach).data)


# Data subject requests ------------------------------------------------------------------------------


class SubjectSearchView(APIView):
    allowed_roles = ("CIA",)

    def get(self, request):
        found = subject.search(
            actor=request.user, term=request.query_params.get("q", ""), ip=client_ip(request._request)
        )
        return Response(
            {
                "term": found["term"],
                "queries": [
                    {
                        "id": str(q.pk),
                        "reference": q.reference,
                        "title": q.title,
                        "status": q.status,
                        "department": q.department,
                        "responsible_officer": q.responsible_officer,
                        "disposed_at": q.disposed_at,
                    }
                    for q in found["queries"]
                ],
                "people": [
                    {
                        "id": str(p.pk),
                        "full_name": p.full_name,
                        "email": p.email,
                        "role": p.role,
                        "is_active": p.is_active,
                        "log_entries": found["log_counts"][str(p.pk)],
                    }
                    for p in found["people"]
                ],
            }
        )


class SubjectExportSerializer(ReasonSerializer):
    q = serializers.CharField(max_length=150)


class SubjectExportView(APIView):
    allowed_roles = ("CIA",)
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "export"

    def post(self, request):
        from django.http import HttpResponse

        data = SubjectExportSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        content, _ = subject.export(
            actor=request.user,
            term=data.validated_data["q"],
            reason=data.validated_data["reason"],
            ip=client_ip(request._request),
        )
        response = HttpResponse(content, content_type=XLSX)
        response["Content-Disposition"] = f'attachment; filename="subject-{workbook.filename()}"'
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "no-store"
        return response


# Break-glass ----------------------------------------------------------------------------------------


class AccessGrantSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.CharField(source="requested_by.full_name", read_only=True)
    decided_by_name = serializers.CharField(source="decided_by.full_name", default=None, read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    reads = serializers.SerializerMethodField()

    class Meta:
        model = AccessGrant
        fields = [
            "id",
            "requested_by",
            "requested_by_name",
            "reason",
            "hours",
            "status",
            "is_active",
            "decided_by",
            "decided_by_name",
            "decision_reason",
            "decided_at",
            "expires_at",
            "ended_at",
            "reads",
            "created_at",
        ]
        read_only_fields = fields

    def get_reads(self, grant) -> int:
        """How many pages and files were opened under this grant, from the audit log."""
        if grant.decided_at is None or grant.status == "Rejected":
            return 0
        end = grant.ended_at or grant.expires_at
        entries = AuditLog.objects.filter(
            organization_id=grant.organization_id,
            actor_id=grant.requested_by_id,
            action="breakglass.read",
            timestamp__gte=grant.decided_at,
        )
        return entries.filter(timestamp__lte=end).count() if end else entries.count()


class GrantRequestSerializer(serializers.Serializer):
    reason = serializers.CharField(validators=[validate_reason])
    hours = serializers.IntegerField(min_value=1, max_value=grants.MAX_HOURS, default=grants.DEFAULT_HOURS)


class AccessGrantViewSet(OrgViewMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """ICT asks and sees its own requests; the CIA sees all of the organization's and decides."""

    allowed_roles = KEEPERS
    action_roles = {
        "list": KEEPERS,
        "create": ("ICT",),
        "approve": ("CIA",),
        "reject": ("CIA",),
        "end": KEEPERS,
    }
    model = AccessGrant
    serializer_class = AccessGrantSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset().select_related("requested_by", "decided_by")
        if self.request.user.effective_role() != "CIA":
            qs = qs.filter(Q(requested_by=self.request.user))
        return qs

    def create(self, request):
        data = GrantRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        grant = grants.request_grant(actor=request.user, ip=self._ip(), **data.validated_data)
        return Response(AccessGrantSerializer(grant).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        grant = grants.decide_grant(
            actor=request.user,
            grant=self.get_object(),
            approve=True,
            reason=str(request.data.get("reason", "")),
            ip=self._ip(),
        )
        return Response(AccessGrantSerializer(grant).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        grant = self.get_object()
        data = ReasonSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        grant = grants.decide_grant(
            actor=request.user,
            grant=grant,
            approve=False,
            reason=data.validated_data["reason"],
            ip=self._ip(),
        )
        return Response(AccessGrantSerializer(grant).data)

    @action(detail=True, methods=["post"])
    def end(self, request, pk=None):
        grant = grants.end_grant(
            actor=request.user,
            grant=self.get_object(),
            reason=str(request.data.get("reason", "")),
            ip=self._ip(),
        )
        return Response(AccessGrantSerializer(grant).data)
