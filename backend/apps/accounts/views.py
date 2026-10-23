import time

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.db import transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django_otp import login as otp_login
from django_otp.plugins.otp_email.models import EmailDevice
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.auditlog.services import record
from apps.core.permissions import SESSION_ORG_KEY, session_org_value
from apps.core.requests import client_ip
from apps.core.validators import ReasonSerializer
from apps.organizations.features import role_enabled
from apps.organizations.models import OrgStatus

from . import passwords, services
from .models import AUDITORS, Role, User, can_assign
from .serializers import (
    LoginSerializer,
    MeSerializer,
    MfaSerializer,
    SetPasswordSerializer,
    UserCreateSerializer,
    UserSerializer,
    UserUpdateSerializer,
    check_role_enabled,
)

ALL_ROLES = tuple(Role.values)
PENDING_KEY = "mfa_pending"
WRONG_CREDENTIALS = "Email or password is incorrect."
EXPIRED = "Your sign-in has expired. Enter your email and password again."


def locked_message() -> str:
    minutes = int(settings.AXES_COOLOFF_TIME.total_seconds() // 60)
    return (
        f"This account is locked after {settings.AXES_FAILURE_LIMIT} failed attempts. "
        f"Try again in {minutes} minutes or contact ICT."
    )


def masked(email: str) -> str:
    """Enough to recognise the address the PIN went to, without spelling it out."""
    local, _, domain = email.partition("@")
    return f"{local[:1]}•••@{domain}"


def email_device(user: User) -> EmailDevice:
    # The PIN goes to the account's own email address, which only ICT can change (and that change is logged).
    device, _ = EmailDevice.objects.get_or_create(
        user=user, defaults={"name": "Email PIN", "confirmed": True}
    )
    return device


def pending_user(request) -> tuple[dict | None, User | None]:
    pending = request.session.get(PENDING_KEY)
    if not pending or time.time() - pending["at"] > settings.MFA_PENDING_SECONDS:
        request.session.pop(PENDING_KEY, None)
        return None, None
    user = User.objects.filter(pk=pending["user"], is_active=True).first()
    if user is None:
        request.session.pop(PENDING_KEY, None)
        return None, None
    return pending, user


def expired() -> Response:
    return Response({"detail": EXPIRED, "code": "expired"}, status=status.HTTP_400_BAD_REQUEST)


ORGANIZATION_CLOSED = {
    OrgStatus.PENDING: "Your organization is waiting for approval by the platform administrator.",
    OrgStatus.SUSPENDED: "Your organization's access is suspended. Contact the platform administrator.",
    OrgStatus.DEACTIVATED: "Your organization's access has ended. Contact the platform administrator.",
    OrgStatus.REJECTED: "Your organization's sign-up was not approved. Contact the platform administrator.",
}


def sign_in_problem(user: User, portal: str) -> tuple[str, str] | None:
    """Why a correct password still does not let this person in, as (code, message). Checked only after
    the password is right, so it reveals nothing to someone guessing."""
    if user.organization_id is None:
        if portal != "platform":
            return "portal", "Platform administrators sign in on the platform sign-in page."
        return None
    if portal == "platform":
        return "portal", "This page is for platform administrators. Use your organization's sign-in page."
    org = user.organization
    if org.status != OrgStatus.ACTIVE:
        return "organization", ORGANIZATION_CLOSED.get(org.status, ORGANIZATION_CLOSED[OrgStatus.DEACTIVATED])
    if not role_enabled(org, user.effective_role()):
        return "role", "Your role is not enabled for your organization. Ask your ICT administrator."
    return None


def mark_session(request, user: User) -> None:
    # The session carries the organization it was signed in to; RoleRequired checks it on every request.
    request.session[SESSION_ORG_KEY] = session_org_value(user)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the CSRF cookie the single-page app sends back on every write."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"detail": "ok"})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    """Step 1 of 2: email and password. On success a one-time PIN is emailed; nothing is signed in yet.
    With MFA paused (MFA_REQUIRED=false, staging only) this step signs in and returns the user."""

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
                organization=target.organization_id if target else None,
            )
            if locked:
                return Response(
                    {"detail": locked_message(), "code": "locked"}, status=status.HTTP_403_FORBIDDEN
                )
            return Response({"detail": WRONG_CREDENTIALS}, status=status.HTTP_400_BAD_REQUEST)

        problem = sign_in_problem(user, data.validated_data["portal"])
        if problem:
            code, message = problem
            record(
                actor=None,
                action="auth.login_refused",
                object_type="User",
                object_id=user.pk,
                new={"why": code},
                ip=ip,
                organization=user.organization_id,
            )
            return Response({"detail": message, "code": code}, status=status.HTTP_403_FORBIDDEN)

        if not settings.MFA_REQUIRED:
            # MFA paused (staging only): the password alone signs in, and the log says so.
            with transaction.atomic():
                login(raw, user, backend="django.contrib.auth.backends.ModelBackend")
                mark_session(request, user)
                record(
                    actor=user,
                    action="auth.login",
                    object_type="User",
                    object_id=user.pk,
                    new={"mfa": "off"},
                    ip=ip,
                )
            return Response(MeSerializer(user).data)

        request.session.cycle_key()
        request.session[PENDING_KEY] = {
            "user": str(user.pk),
            "at": time.time(),
            "fails": 0,
            "resends": 0,
            "portal": data.validated_data["portal"],
        }
        # Within the cooldown a repeated sign-in reuses the PIN already sent, rather than sending another.
        email_device(user).generate_challenge()
        return Response({"mfa": "email", "sent_to": masked(user.email)})


@method_decorator(csrf_protect, name="dispatch")
class MfaResendView(APIView):
    """Send a fresh PIN for a sign-in in progress. Limited to one a minute and three in all."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        pending, user = pending_user(request)
        if user is None:
            return expired()
        if pending["resends"] >= settings.MFA_MAX_RESENDS:
            request.session.pop(PENDING_KEY, None)
            return Response(
                {"detail": "Too many codes sent. " + EXPIRED, "code": "expired"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        device = email_device(user)
        allowed, _ = device.generate_is_allowed()
        if not allowed:
            return Response(
                {"detail": "Wait a minute before asking for another code.", "code": "cooldown"},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        device.generate_challenge()
        pending["resends"] += 1
        request.session[PENDING_KEY] = pending
        record(
            actor=None,
            action="auth.mfa_resent",
            object_type="User",
            object_id=user.pk,
            new={"resend": pending["resends"]},
            ip=client_ip(request._request),
            organization=user.organization_id,
        )
        return Response({"mfa": "email", "sent_to": masked(user.email)})


@method_decorator(csrf_protect, name="dispatch")
class MfaView(APIView):
    """Step 2 of 2: the emailed PIN. Only after this is the session fully signed in."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        pending, user = pending_user(request)
        if user is None:
            return expired()
        data = MfaSerializer(data=request.data)
        data.is_valid(raise_exception=True)

        device = email_device(user)
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
                organization=user.organization_id,
            )
            if pending["fails"] >= settings.MFA_MAX_FAILURES:
                request.session.pop(PENDING_KEY, None)
                return Response(
                    {"detail": "Too many wrong codes. " + EXPIRED, "code": "expired"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            request.session[PENDING_KEY] = pending
            return Response(
                {"detail": "That code is not correct or has expired. Check the latest email and try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # The organization may have been suspended, or the role switched off, since the password step.
        problem = sign_in_problem(user, pending.get("portal", "organization"))
        if problem:
            request.session.pop(PENDING_KEY, None)
            return Response({"detail": problem[1], "code": problem[0]}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            request.session.pop(PENDING_KEY, None)
            login(request._request, user, backend="django.contrib.auth.backends.ModelBackend")
            otp_login(request._request, device)
            mark_session(request, user)
            record(
                actor=user,
                action="auth.login",
                object_type="User",
                object_id=user.pk,
                new={"mfa": "email_pin"},
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


@method_decorator(csrf_protect, name="dispatch")
class SetPasswordView(APIView):
    """Choose a password from the one-time emailed link. The link stops working once it is used."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        data = SetPasswordSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = passwords.user_for_token(data.validated_data["uid"], data.validated_data["token"])
        if user is None:
            return Response(
                {
                    "detail": "This link has expired or was already used. Ask for a new one.",
                    "code": "expired",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            validate_password(data.validated_data["password"], user)
        except DjangoValidationError as exc:
            raise ValidationError({"password": list(exc.messages)}) from exc
        with transaction.atomic():
            user.set_password(data.validated_data["password"])
            user.save(update_fields=["password", "updated_at"])
            record(
                actor=None,
                action="auth.password_set",
                object_type="User",
                object_id=user.pk,
                ip=client_ip(request._request),
                organization=user.organization_id,
            )
        return Response({"detail": "Your password is set. You can sign in now."})


class UserViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Account management. ICT only (design.md 2): ICT manages accounts but has no rights over findings.
    ICT is the organization's administrator and sees and manages only its own organization's people,
    in the roles enabled for it (auditlogs-additions_final.md 5 and 6)."""

    allowed_roles = ("ICT",)
    serializer_class = UserSerializer
    pagination_class = None

    def get_queryset(self):
        return User.objects.filter(organization_id=self.request.user.organization_id)

    def _ip(self):
        return client_ip(self.request._request)

    def _not_self(self, user: User, what: str) -> None:
        if user.pk == self.request.user.pk:
            raise ValidationError(
                {"detail": f"You cannot {what} your own account. Ask another ICT administrator."}
            )

    def create(self, request):
        data = UserCreateSerializer(data=request.data, context={"organization": request.user.organization})
        data.is_valid(raise_exception=True)
        user = services.create_user(
            actor=request.user, organization=request.user.organization, ip=self._ip(), **data.validated_data
        )
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        user = self.get_object()
        data = UserUpdateSerializer(data=request.data, context={"user": user})
        data.is_valid(raise_exception=True)
        changes = data.validated_data
        if changes.get("role", user.role) != user.role:
            self._not_self(user, "change the role of")
        if changes.get("email", user.email) != user.email:
            # The sign-in PIN goes to this address, so ICT may not redirect its own.
            self._not_self(user, "change the email of")
        user = services.update_user(actor=request.user, user=user, ip=self._ip(), **changes)
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
        user = services.set_active(actor=request.user, user=user, active=False, reason=reason, ip=self._ip())
        return Response(UserSerializer(user).data)

    @action(detail=True, methods=["post"])
    def enable(self, request, pk=None):
        user = self.get_object()
        reason = self._reasoned(request, user, "enable")
        try:
            check_role_enabled(user.organization, user.role)
        except ValidationError as exc:
            raise ValidationError({"detail": exc.detail[0] + " Change the role first."}) from exc
        user = services.set_active(actor=request.user, user=user, active=True, reason=reason, ip=self._ip())
        return Response(UserSerializer(user).data)


class AuditorListView(APIView):
    """The auditors this person may assign to: active IAs and SIAs ranked below them (owner, 2026-10-22)."""

    allowed_roles = ("PIA", "CIA")

    def get(self, request):
        auditors = User.objects.filter(
            organization_id=request.user.organization_id, role__in=AUDITORS, is_active=True
        ).order_by("full_name")
        return Response(
            [
                {"id": str(u.pk), "full_name": u.full_name, "role": u.role}
                for u in auditors
                if can_assign(request.user, u)
            ]
        )
