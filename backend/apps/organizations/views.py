"""Platform administration and organization sign-up (auditlogs-additions_final.md 4 to 6).

The System Administrator (role SYS) manages institutions: their details, status, package of features
and first administrator. These views give counts about an organization, never its audit content.
"""

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Q
from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import ORG_ROLES, Role, User
from apps.accounts.views import masked
from apps.auditlog.models import AuditLog
from apps.auditlog.services import verify_chain
from apps.core.requests import client_ip
from apps.core.validators import validate_reason
from apps.queries.models import Query, Status

from . import features as catalogue
from . import services
from .logos import logo_url
from .models import Organization, OrgStatus

PLATFORM = ("SYS",)


def show_links() -> bool:
    """Outside production, one-time links are also returned to the caller: staging has no mail server."""
    return settings.ENVIRONMENT != "prod"


class OrganizationDetailsSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    country = serializers.CharField(max_length=100)
    contact_person = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    address = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    website = serializers.URLField(max_length=200, required=False, allow_blank=True, default="")

    def validate_name(self, value: str) -> str:
        return value.strip()

    def validate_email(self, value: str) -> str:
        return value.strip().lower()


def logo_response(org) -> HttpResponse:
    if org.logo is None:
        raise NotFound("This organization has no logo.")
    response = HttpResponse(bytes(org.logo), content_type="image/png")
    response["Cache-Control"] = "private, max-age=86400"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Disposition"] = 'inline; filename="logo.png"'
    return response


class OrganizationSerializer(serializers.ModelSerializer):
    features = serializers.SerializerMethodField()
    logo_url = serializers.SerializerMethodField()
    users = serializers.IntegerField(source="user_count", read_only=True, default=0)
    active_users = serializers.IntegerField(source="active_user_count", read_only=True, default=0)
    queries = serializers.IntegerField(source="query_count", read_only=True, default=0)
    administrators = serializers.SerializerMethodField()

    class Meta:
        model = Organization
        fields = [
            "id",
            "name",
            "country",
            "contact_person",
            "email",
            "phone",
            "address",
            "website",
            "logo_url",
            "status",
            "email_verified_at",
            "approved_at",
            "created_at",
            "updated_at",
            "features",
            "users",
            "active_users",
            "queries",
            "administrators",
        ]
        read_only_fields = fields

    def get_features(self, org) -> dict:
        return services.feature_map(org)

    def get_logo_url(self, org) -> str | None:
        return logo_url(org, platform=True)

    def get_administrators(self, org) -> list[dict]:
        admins = User.objects.filter(organization=org, role=Role.ICT).order_by("full_name")
        return [
            {"id": str(u.pk), "full_name": u.full_name, "email": u.email, "is_active": u.is_active}
            for u in admins
        ]


class FeatureChangeSerializer(serializers.Serializer):
    preset = serializers.ChoiceField(choices=list(catalogue.PRESETS), required=False, allow_null=True)
    features = serializers.DictField(child=serializers.BooleanField(), required=False, default=dict)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class CreateOrganizationSerializer(OrganizationDetailsSerializer, FeatureChangeSerializer):
    admin_email = serializers.EmailField(required=False, allow_blank=True, default="")
    admin_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")


class UpdateOrganizationSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    country = serializers.CharField(max_length=100, required=False)
    contact_person = serializers.CharField(max_length=150, required=False)
    email = serializers.EmailField(required=False)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    address = serializers.CharField(max_length=500, required=False, allow_blank=True)
    website = serializers.URLField(max_length=200, required=False, allow_blank=True)
    reason = serializers.CharField(validators=[validate_reason])


class LogoSerializer(serializers.Serializer):
    file = serializers.FileField()
    reason = serializers.CharField(validators=[validate_reason])


class StatusChangeSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class ApproveSerializer(StatusChangeSerializer, FeatureChangeSerializer):
    pass


class AdminSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=150)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


def with_counts(qs):
    return qs.annotate(
        user_count=Count("users", distinct=True),
        active_user_count=Count("users", filter=Q(users__is_active=True), distinct=True),
    )


def query_counts(org_ids) -> dict:
    rows = Query.objects.filter(organization_id__in=org_ids).values("organization_id").annotate(n=Count("id"))
    return {r["organization_id"]: r["n"] for r in rows}


class OrganizationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Institutions, for the System Administrator only."""

    allowed_roles = PLATFORM
    serializer_class = OrganizationSerializer
    pagination_class = None

    def get_queryset(self):
        # The logo itself is read only by the logo route.
        qs = with_counts(Organization.objects.defer("logo")).order_by("name")
        wanted = self.request.query_params.get("status")
        return qs.filter(status=wanted) if wanted else qs

    def _ip(self):
        return client_ip(self.request._request)

    def _out(self, org, **extra):
        org = with_counts(Organization.objects.defer("logo").filter(pk=org.pk)).get()
        org.query_count = query_counts([org.pk]).get(org.pk, 0)
        return {**OrganizationSerializer(org).data, **extra}

    def list(self, request):
        orgs = list(self.get_queryset())
        counts = query_counts([o.pk for o in orgs])
        for org in orgs:
            org.query_count = counts.get(org.pk, 0)
        return Response(OrganizationSerializer(orgs, many=True).data)

    def retrieve(self, request, pk=None):
        return Response(self._out(self.get_object()))

    def create(self, request):
        data = CreateOrganizationSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        wanted = services.resolve_features(preset=v.get("preset"), values=v["features"])
        details = {
            k: v[k] for k in ("name", "country", "contact_person", "email", "phone", "address", "website")
        }
        org = services.create_organization(actor=request.user, details=details, wanted=wanted, ip=self._ip())
        extra = {}
        if v["admin_email"]:
            user, _, link = services.set_admin(
                org=org,
                actor=request.user,
                email=v["admin_email"],
                full_name=v["admin_name"] or v["contact_person"],
                ip=self._ip(),
            )
            extra = self._admin_out(user, link)
        return Response(self._out(org, **extra), status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        org = self.get_object()
        data = UpdateOrganizationSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        changes = {k: v for k, v in data.validated_data.items() if k != "reason"}
        if "email" in changes:
            changes["email"] = changes["email"].strip().lower()
        org = services.update_details(
            org=org, actor=request.user, changes=changes, reason=data.validated_data["reason"], ip=self._ip()
        )
        return Response(self._out(org))

    def _move(self, request, move: str):
        org = self.get_object()
        serializer = ApproveSerializer if move == "approve" else StatusChangeSerializer
        data = serializer(data=request.data)
        data.is_valid(raise_exception=True)
        wanted = None
        if move == "approve":
            wanted = services.resolve_features(
                preset=data.validated_data.get("preset"), values=data.validated_data["features"]
            )
        org = services.change_status(
            org=org,
            actor=request.user,
            move=move,
            reason=data.validated_data["reason"],
            wanted=wanted,
            ip=self._ip(),
        )
        return Response(self._out(org))

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._move(request, "approve")

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._move(request, "reject")

    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        return self._move(request, "suspend")

    @action(detail=True, methods=["post"])
    def reactivate(self, request, pk=None):
        return self._move(request, "reactivate")

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        return self._move(request, "deactivate")

    @action(detail=True, methods=["get", "put"])
    def features(self, request, pk=None):
        org = self.get_object()
        if request.method == "GET":
            return Response(services.feature_map(org))
        data = FeatureChangeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        wanted = services.resolve_features(
            preset=data.validated_data.get("preset"),
            values=data.validated_data["features"],
            base=services.feature_map(org),
        )
        services.set_features(
            org=org, actor=request.user, wanted=wanted, reason=data.validated_data["reason"], ip=self._ip()
        )
        return Response(self._out(org))

    @action(detail=True, methods=["get", "post", "delete"], parser_classes=[MultiPartParser, JSONParser])
    def logo(self, request, pk=None):
        """Read, put up or take down the organization's logo. Changing it needs a reason."""
        org = self.get_object()
        if request.method == "GET":
            return logo_response(Organization.objects.get(pk=org.pk))
        if request.method == "DELETE":
            reason = StatusChangeSerializer(data=request.data)
            reason.is_valid(raise_exception=True)
            services.set_logo(
                org=org,
                actor=request.user,
                content=None,
                reason=reason.validated_data["reason"],
                ip=self._ip(),
            )
            return Response(self._out(org))
        data = LogoSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        services.set_logo(
            org=org,
            actor=request.user,
            content=data.validated_data["file"].read(),
            reason=data.validated_data["reason"],
            ip=self._ip(),
        )
        return Response(self._out(org))

    def _admin_out(self, user: User, link: str) -> dict:
        out = {"admin": {"id": str(user.pk), "full_name": user.full_name, "sent_to": masked(user.email)}}
        if show_links():
            out["admin"]["set_password_link"] = link
        return out

    @action(detail=True, methods=["post"])
    def admin(self, request, pk=None):
        org = self.get_object()
        data = AdminSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user, created, link = services.set_admin(
            org=org, actor=request.user, ip=self._ip(), **data.validated_data
        )
        return Response(
            self._out(org, **self._admin_out(user, link)),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class OrganizationLogoView(APIView):
    """The signed-in person's own organization's logo, for the top bar."""

    allowed_roles = ORG_ROLES

    def get(self, request):
        return logo_response(Organization.objects.get(pk=request.user.organization_id))


class PlatformStatsView(APIView):
    """Platform statistics: counts per organization, without opening any audit record (section 4)."""

    allowed_roles = PLATFORM

    def get(self, request):
        orgs = list(with_counts(Organization.objects.all()).order_by("name"))
        totals = Query.objects.values("organization_id").annotate(
            n=Count("id"), open=Count("id", filter=~Q(status=Status.CLOSED))
        )
        per_org = {r["organization_id"]: r for r in totals}
        by_status = {s: 0 for s in OrgStatus.values}
        for org in orgs:
            by_status[org.status] += 1
        return Response(
            {
                "organizations": len(orgs),
                "by_status": by_status,
                "users": sum(o.user_count for o in orgs),
                "queries": sum(r["n"] for r in per_org.values()),
                "per_organization": [
                    {
                        "id": str(o.pk),
                        "name": o.name,
                        "status": o.status,
                        "users": o.user_count,
                        "active_users": o.active_user_count,
                        "queries": per_org.get(o.pk, {}).get("n", 0),
                        "open_queries": per_org.get(o.pk, {}).get("open", 0),
                    }
                    for o in orgs
                ],
            }
        )


class PlatformLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.full_name", default=None, read_only=True)
    organization_name = serializers.CharField(source="organization.name", default=None, read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "seq", "timestamp", "actor", "actor_name", "actor_role", "action", "object_type", "object_id",
            "organization", "organization_name", "old_value", "new_value", "reason", "entry_hash",
        ]  # fmt: skip
        read_only_fields = fields


class PlatformLogView(ListAPIView):
    """What the System Administrators did, and platform sign-ins. Not any organization's audit content."""

    allowed_roles = PLATFORM
    serializer_class = PlatformLogSerializer

    def get_queryset(self):
        return (
            AuditLog.objects.filter(Q(actor_role=Role.SYS) | Q(object_type="Organization"))
            .select_related("actor", "organization")
            .order_by("-seq")
        )


class PlatformVerifyView(APIView):
    """The whole chain, every organization's entries included. Counts only."""

    allowed_roles = PLATFORM

    def post(self, request):
        from apps.auditlog.services import record

        result = verify_chain()
        record(
            actor=request.user,
            action="auditlog.verify",
            object_type="AuditLog",
            object_id="chain",
            new={"result": f"intact ({result.checked})" if result.ok else f"broken at {result.broken_at}"},
            ip=client_ip(request._request),
        )
        return Response({"ok": result.ok, "checked": result.checked, "broken_at": result.broken_at})


# Public sign-up ---------------------------------------------------------------------------------------


class SignupSerializer(OrganizationDetailsSerializer):
    password = serializers.CharField(trim_whitespace=False, max_length=200, write_only=True)

    def validate_email(self, value: str) -> str:
        value = value.strip().lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        probe = User(email=attrs["email"], full_name=attrs["contact_person"])
        try:
            validate_password(attrs["password"], probe)
        except DjangoValidationError as exc:
            raise ValidationError({"password": list(exc.messages)}) from exc
        return attrs


@method_decorator(csrf_protect, name="dispatch")
class SignupView(APIView):
    """Public: an institution signs up. It waits as Pending until the System Administrator approves it."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "signup"

    def post(self, request):
        data = SignupSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        details = {
            k: v[k] for k in ("name", "country", "contact_person", "email", "phone", "address", "website")
        }
        org, _, link = services.sign_up(
            details=details, password=v["password"], ip=client_ip(request._request)
        )
        out = {
            "detail": "Thank you. Confirm your email address, then wait for the platform administrator to approve "
            "your organization. We will email you.",
            "status": org.status,
        }
        if show_links():
            out["verify_link"] = link
        return Response(out, status=status.HTTP_201_CREATED)


class VerifySerializer(serializers.Serializer):
    token = serializers.CharField(max_length=500)


@method_decorator(csrf_protect, name="dispatch")
class SignupVerifyView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "signup"

    def post(self, request):
        data = VerifySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        services.verify_email(token=data.validated_data["token"], ip=client_ip(request._request))
        return Response({"detail": "Thank you. Your email address is confirmed."})
