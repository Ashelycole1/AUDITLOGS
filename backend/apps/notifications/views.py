from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.models import ORG_ROLES

from .models import Notification

LATEST = 100


class NotificationSerializer(serializers.ModelSerializer):
    reference = serializers.CharField(source="query.reference", default=None, read_only=True)

    class Meta:
        model = Notification
        fields = ["id", "headline", "body", "query", "reference", "link", "read_at", "created_at"]
        read_only_fields = fields


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Each person's own notifications, newest first. Nobody can read anyone else's."""

    allowed_roles = ORG_ROLES
    serializer_class = NotificationSerializer
    pagination_class = None

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user).select_related("query")

    def list(self, request):
        items = self.get_queryset()[:LATEST]
        unread = self.get_queryset().filter(read_at__isnull=True).count()
        return Response({"unread": unread, "results": NotificationSerializer(items, many=True).data})

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        item = self.get_object()
        if item.read_at is None:
            item.read_at = timezone.now()
            item.save(update_fields=["read_at"])
        return Response(NotificationSerializer(item).data)

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        marked = self.get_queryset().filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({"marked": marked})
