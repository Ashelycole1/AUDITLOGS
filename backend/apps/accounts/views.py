import time
from base64 import b32encode

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.db import transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django_otp import login as otp_login
from django_otp.plugins.otp_totp.models import TOTPDevice
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.auditlog.services import record
from apps.core.requests import client_ip
from apps.core.validators import ReasonSerializer

from . import services
from .models import Role, User
from .serializers import (
    LoginSerializer,
    MeSerializer,
    MfaSerializer,
    UserCreateSerializer,
    UserSerializer,
    UserUpdateSerializer,
)

ALL_ROLES = tuple(Role.values)
PENDING_KEY = "mfa_pending"
WRONG_CREDENTIALS = "Email or password is incorrect."
EXPIRED = "Your sign-in has expired. Enter your email and password again."


def locked_message() -> str:
    minutes = int(settings.AXES_COOLOFF_TIME.total_seconds() // 60)
    return f"This account is locked after {settings.AXES_FAILURE_LIMIT} failed attempts. Try again in {minutes} minutes or contact ICT."


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the CSRF cookie the single-page app sends back on every write."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"detail": "ok"})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    """Step 1 of 2: email and password. The session is not signed in until the MFA step passes."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        data = LoginSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        email = data.validated_data["email"].strip().lower()
        raw = request._request
        user = authenticate(raw, username=email, password=data.validated_data["password"])
        ip = client_ip(raw)

        if user is None:
            target = User.objects.filter(email=email).only("pk").first()
            locked = bool(getattr(raw, "axes_locked_out", False))
            record(
                actor=None,
                action="auth.login_failed",
                object_type="User",
                object_id=target.pk if target else "unknown",
                new={"locked": locked},
                ip=ip,
            )
            if locked:
                return Response(
                    {"detail": locked_message(), "code": "locked"}, status=status.HTTP_403_FORBIDDEN
                )
            return Response({"detail": WRONG_CREDENTIALS}, status=status.HTTP_400_BAD_REQUEST)

        request.session.cycle_key()
        request.session[PENDING_KEY] = {"user": str(user.pk), "at": time.time(), "fails": 0}

        if TOTPDevice.objects.filter(user=user, confirmed=True).exists():
            return Response({"mfa": "verify"})

        # First sign-in: enrol an authenticator. The device is confirmed only when a code from it is accepted.
        TOTPDevice.objects.filter(user=user, confirmed=False).delete()
        device = TOTPDevice.objects.create(user=user, name="Authenticator", confirmed=False)
        return Response(
            {"mfa": "setup", "secret": b32encode(device.bin_key).decode(), "otpauth_uri": device.config_url}
        )


@method_decorator(csrf_protect, name="dispatch")
class MfaView(APIView):
    """Step 2 of 2: the authenticator code. Only after this is the session fully signed in."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        pending = request.session.get(PENDING_KEY)
        if not pending or time.time() - pending["at"] > settings.MFA_PENDING_SECONDS:
            request.session.pop(PENDING_KEY, None)
            return Response({"detail": EXPIRED, "code": "expired"}, status=status.HTTP_400_BAD_REQUEST)

        data = MfaSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = User.objects.filter(pk=pending["user"], is_active=True).first()
        device = None
        if user:
            device = (
                TOTPDevice.objects.filter(user=user, confirmed=True).first()
                or TOTPDevice.objects.filter(user=user, confirmed=False).order_by("-id").first()
            )
        if device is None:
            request.session.pop(PENDING_KEY, None)
            return Response({"detail": EXPIRED, "code": "expired"}, status=status.HTTP_400_BAD_REQUEST)

        ip = client_ip(request._request)
        if not device.verify_token(data.validated_data["code"]):
            pending["fails"] += 1
            record(
                actor=None,
                action="auth.mfa_failed",
                object_type="User",
                object_id=user.pk,
                new={"attempt": pending["fails"]},
                ip=ip,
            )
            if pending["fails"] >= settings.MFA_MAX_FAILURES:
                request.session.pop(PENDING_KEY, None)
                return Response(
                    {"detail": "Too many wrong codes. " + EXPIRED, "code": "expired"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            request.session[PENDING_KEY] = pending
            return Response(
                {"detail": "That code is not correct. Check the time on your phone and try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            if not device.confirmed:
                device.confirmed = True
                device.save(update_fields=["confirmed"])
                record(
                    actor=user,
                    action="user.mfa_setup",
                    object_type="User",
                    object_id=user.pk,
                    new={"device": "totp"},
                    ip=ip,
                )
            request.session.pop(PENDING_KEY, None)
            login(request._request, user, backend="django.contrib.auth.backends.ModelBackend")
            otp_login(request._request, device)
            record(
                actor=user,
                action="auth.login",
                object_type="User",
                object_id=user.pk,
                new={"mfa": "totp"},
                ip=ip,
            )
        return Response(MeSerializer(user).data)


class LogoutView(APIView):
    allowed_roles = ALL_ROLES

    def post(self, request):
        record(
            actor=request.user,
            action="auth.logout",
            object_type="User",
            object_id=request.user.pk,
            ip=client_ip(request._request),
        )
        logout(request._request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    allowed_roles = ALL_ROLES

    def get(self, request):
        return Response(MeSerializer(request.user).data)


class UserViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Account management. ICT only (design.md 2): ICT manages accounts but has no rights over findings."""

    allowed_roles = ("ICT",)
    queryset = User.objects.all()
    serializer_class = UserSerializer
    pagination_class = None

    def _ip(self):
        return client_ip(self.request._request)

    def _not_self(self, user: User, what: str) -> None:
        if user.pk == self.request.user.pk:
            raise ValidationError(
                {"detail": f"You cannot {what} your own account. Ask another ICT administrator."}
            )

    def create(self, request):
        data = UserCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = services.create_user(actor=request.user, ip=self._ip(), **data.validated_data)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        user = self.get_object()
        data = UserUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if "role" in data.validated_data and data.validated_data["role"] != user.role:
            self._not_self(user, "change the role of")
        user = services.update_user(actor=request.user, user=user, ip=self._ip(), **data.validated_data)
        return Response(UserSerializer(user).data)

    def _reasoned(self, request, user: User, what: str) -> str:
        self._not_self(user, what)
        data = ReasonSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        return data.validated_data["reason"]

    @action(detail=True, methods=["post"])
    def disable(self, request, pk=None):
        user = self.get_object()
        reason = self._reasoned(request, user, "disable")
        return Response(
            UserSerializer(
                services.set_active(actor=request.user, user=user, active=False, reason=reason, ip=self._ip())
            ).data
        )

    @action(detail=True, methods=["post"])
    def enable(self, request, pk=None):
        user = self.get_object()
        reason = self._reasoned(request, user, "enable")
        return Response(
            UserSerializer(
                services.set_active(actor=request.user, user=user, active=True, reason=reason, ip=self._ip())
            ).data
        )

    @action(detail=True, methods=["post"], url_path="reset-mfa")
    def reset_mfa(self, request, pk=None):
        user = self.get_object()
        reason = self._reasoned(request, user, "reset MFA on")
        services.reset_mfa(actor=request.user, user=user, reason=reason, ip=self._ip())
        return Response(UserSerializer(user).data)
