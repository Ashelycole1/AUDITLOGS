from django.urls import include, path
from rest_framework.routers import SimpleRouter

from apps.accounts.views import CsrfView, LoginView, LogoutView, MeView, MfaResendView, MfaView, UserViewSet
from apps.auditlog.views import AuditLogListView, VerifyChainView
from apps.core.views import HealthView
from apps.followup.views import EvidenceDownloadView
from apps.imports.views import ImportBatchViewSet
from apps.queries.views import QueryViewSet
from apps.workflow.views import StatusRequestViewSet

router = SimpleRouter(trailing_slash=False)
router.register("users", UserViewSet, basename="users")
router.register("imports", ImportBatchViewSet, basename="imports")
router.register("queries", QueryViewSet, basename="queries")
router.register("status-requests", StatusRequestViewSet, basename="status-requests")

api = [
    path("health", HealthView.as_view(), name="health"),
    path("auth/csrf", CsrfView.as_view(), name="auth-csrf"),
    path("auth/login", LoginView.as_view(), name="auth-login"),
    path("auth/mfa", MfaView.as_view(), name="auth-mfa"),
    path("auth/mfa/resend", MfaResendView.as_view(), name="auth-mfa-resend"),
    path("auth/logout", LogoutView.as_view(), name="auth-logout"),
    path("auth/me", MeView.as_view(), name="auth-me"),
    path("audit-log", AuditLogListView.as_view(), name="audit-log"),
    path("audit-log/verify", VerifyChainView.as_view(), name="audit-log-verify"),
    path("evidence/<uuid:pk>/download", EvidenceDownloadView.as_view(), name="evidence-download"),
    *router.urls,
]

# No Django admin: every change goes through the API, its permissions and the audit log.
urlpatterns = [path("api/v1/", include(api))]
