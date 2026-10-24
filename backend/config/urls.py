from django.urls import include, path
from rest_framework.routers import SimpleRouter

from apps.accounts.views import (
    AuditorListView,
    CsrfView,
    LoginView,
    LogoutView,
    MeView,
    MfaResendView,
    MfaView,
    SetPasswordView,
    UserViewSet,
)
from apps.auditlog.views import AuditLogListView, VerifyChainView
from apps.compliance.views import (
    AccessGrantViewSet,
    BreachViewSet,
    DisposalViewSet,
    RetentionRuleViewSet,
    SubjectExportView,
    SubjectSearchView,
)
from apps.core.views import HealthView
from apps.followup.views import EvidenceDownloadView
from apps.imports.views import ImportBatchViewSet
from apps.notifications.views import NotificationViewSet
from apps.organizations.views import (
    OrganizationViewSet,
    PlatformLogView,
    PlatformStatsView,
    PlatformVerifyView,
    SignupVerifyView,
    SignupView,
)
from apps.queries.dashboards import RegisteredNumbersView, StatusSummaryView, SystemStatsView
from apps.queries.views import CeoDashboardQueriesView, CiaActivityView, QueryViewSet
from apps.reports.views import ReportViewSet
from apps.workflow.views import ExportRequestViewSet, ReassignmentRequestViewSet, StatusRequestViewSet

router = SimpleRouter(trailing_slash=False)
router.register("users", UserViewSet, basename="users")
router.register("imports", ImportBatchViewSet, basename="imports")
router.register("queries", QueryViewSet, basename="queries")
router.register("status-requests", StatusRequestViewSet, basename="status-requests")
router.register("reassignment-requests", ReassignmentRequestViewSet, basename="reassignment-requests")
router.register("export-requests", ExportRequestViewSet, basename="export-requests")
router.register("notifications", NotificationViewSet, basename="notifications")
router.register("reports", ReportViewSet, basename="reports")
router.register("retention-rules", RetentionRuleViewSet, basename="retention-rules")
router.register("disposals", DisposalViewSet, basename="disposals")
router.register("breaches", BreachViewSet, basename="breaches")
router.register("access-requests", AccessGrantViewSet, basename="access-requests")
router.register("platform/organizations", OrganizationViewSet, basename="platform-organizations")

api = [
    path("health", HealthView.as_view(), name="health"),
    path("auth/csrf", CsrfView.as_view(), name="auth-csrf"),
    path("auth/login", LoginView.as_view(), name="auth-login"),
    path("auth/mfa", MfaView.as_view(), name="auth-mfa"),
    path("auth/mfa/resend", MfaResendView.as_view(), name="auth-mfa-resend"),
    path("auth/logout", LogoutView.as_view(), name="auth-logout"),
    path("auth/me", MeView.as_view(), name="auth-me"),
    path("auth/set-password", SetPasswordView.as_view(), name="auth-set-password"),
    path("signup", SignupView.as_view(), name="signup"),
    path("signup/verify", SignupVerifyView.as_view(), name="signup-verify"),
    path("platform/stats", PlatformStatsView.as_view(), name="platform-stats"),
    path("platform/audit-log", PlatformLogView.as_view(), name="platform-audit-log"),
    path("platform/audit-log/verify", PlatformVerifyView.as_view(), name="platform-audit-log-verify"),
    path("audit-log", AuditLogListView.as_view(), name="audit-log"),
    path("audit-log/verify", VerifyChainView.as_view(), name="audit-log-verify"),
    path("auditors", AuditorListView.as_view(), name="auditors"),
    path("dashboard/queries", CeoDashboardQueriesView.as_view(), name="dashboard-queries"),
    path("dashboard/cia-activity", CiaActivityView.as_view(), name="dashboard-cia-activity"),
    path("dashboard/status-summary", StatusSummaryView.as_view(), name="dashboard-status-summary"),
    path(
        "dashboard/registered-numbers", RegisteredNumbersView.as_view(), name="dashboard-registered-numbers"
    ),
    path("dashboard/system-stats", SystemStatsView.as_view(), name="dashboard-system-stats"),
    path("subject-search", SubjectSearchView.as_view(), name="subject-search"),
    path("subject-export", SubjectExportView.as_view(), name="subject-export"),
    path("evidence/<uuid:pk>/download", EvidenceDownloadView.as_view(), name="evidence-download"),
    *router.urls,
]

# No Django admin: every change goes through the API, its permissions and the audit log.
urlpatterns = [path("api/v1/", include(api))]
