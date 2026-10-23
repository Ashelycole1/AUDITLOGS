from django.http import HttpResponse
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.core.requests import client_ip
from apps.reports.models import AuditReport

from . import services
from .models import ImportBatch, ImportRow
from .parsing import ImportFileError


class ImportBatchSerializer(serializers.ModelSerializer):
    imported_by_name = serializers.CharField(source="imported_by.full_name", read_only=True)
    report_title = serializers.CharField(source="report.title", default=None, read_only=True)

    class Meta:
        model = ImportBatch
        fields = [
            "id",
            "source_filename",
            "source_sha256",
            "status",
            "row_count",
            "error_count",
            "imported_by",
            "imported_by_name",
            "created_at",
            "confirmed_at",
            "report",
            "report_title",
            "report_meta",
        ]
        read_only_fields = fields


class ImportRowSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImportRow
        fields = ["line", "data", "errors", "warnings"]
        read_only_fields = fields


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True)


class ImportBatchViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Import of final queries. CIA only: moved from the PIA at the owner's request (2026-10-22).
    The original file can be downloaded by the CIA, the PIA and the CEO (auditlogs-additions_final.md 12).
    Only the organization's own batches are reachable; anyone else's is a 404."""

    allowed_roles = ("CIA",)
    action_roles = {"original": ("CIA", "PIA", "CEO")}
    serializer_class = ImportBatchSerializer
    parser_classes = [MultiPartParser, JSONParser]
    pagination_class = None

    def get_queryset(self):
        return ImportBatch.objects.in_org(self.request.user.organization_id).select_related(
            "imported_by", "report"
        )

    def _ip(self):
        return client_ip(self.request._request)

    def _report(self, request) -> AuditReport | None:
        report_id = request.data.get("report")
        if not report_id:
            return None
        report = AuditReport.objects.in_org(request.user.organization_id).filter(pk=report_id).first()
        if report is None:
            raise ImportFileError("That report was not found.")
        return report

    def create(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return Response(
                {"detail": "Choose the final queries file to upload."}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            batch = services.upload(
                actor=request.user,
                filename=upload.name,
                content=upload.read(),
                report=self._report(request),
                ip=self._ip(),
            )
        except ImportFileError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self._preview(batch), status=status.HTTP_201_CREATED)

    def _preview(self, batch: ImportBatch) -> dict:
        return {
            **ImportBatchSerializer(batch).data,
            "rows": ImportRowSerializer(batch.rows.all(), many=True).data,
        }

    @action(detail=True, methods=["get"])
    def preview(self, request, pk=None):
        return Response(self._preview(self.get_object()))

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        batch = self.get_object()
        try:
            batch = services.confirm(actor=request.user, batch_id=batch.pk, ip=self._ip())
        except services.ImportStateError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(ImportBatchSerializer(batch).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        batch = self.get_object()
        data = CancelSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            batch = services.cancel(
                actor=request.user,
                batch_id=batch.pk,
                reason=data.validated_data.get("reason", ""),
                ip=self._ip(),
            )
        except services.ImportStateError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(ImportBatchSerializer(batch).data)

    @action(detail=True, methods=["get"])
    def original(self, request, pk=None):
        batch = self.get_object()
        content = services.open_original(batch=batch, actor=request.user, ip=self._ip())
        response = HttpResponse(content, content_type="application/octet-stream")
        safe_name = batch.source_filename.replace('"', "").replace("\r", "").replace("\n", "")
        response["Content-Disposition"] = f'attachment; filename="{safe_name}"'
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "no-store"
        return response
