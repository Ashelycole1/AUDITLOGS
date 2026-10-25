"""Dashboard widgets the System Administrator switches per organization (auditlogs-additions_final.md 5
and 10). Each is refused with 403 when its switch is off for the organization.

They give counts for the whole organization to every role in it, as section 10 asks ("all parties"),
and never another organization's: every count starts from the requester's own organization.
"""

from django.db.models import Count, Max, Q, Sum
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import ORG_ROLES, User
from apps.auditlog.models import AuditLog
from apps.followup.models import Comment, Evidence, FollowUpActivity
from apps.imports.models import BatchStatus, ImportBatch
from apps.organizations import features
from apps.reports.models import AuditReport, Criterion

from .models import Query, Status
from .stats import breakdown, by_assignee, by_field


class StatusSummaryView(APIView):
    """The query status pie chart: total, worked on, not worked on and allocated, with a key, and who the
    allocated queries are with (counts per person only)."""

    allowed_roles = ORG_ROLES
    required_feature = features.STATUS_PIE

    def get(self, request):
        queries = Query.objects.in_org(request.user.organization_id)
        return Response({**breakdown(queries), "allocated_to": by_assignee(queries)})


class RegisteredNumbersView(APIView):
    """Registered counts: people and records (open question 8, answered as counts)."""

    allowed_roles = ORG_ROLES
    required_feature = features.REGISTERED_NUMBERS

    def get(self, request):
        org = request.user.organization
        people = User.objects.filter(organization=org)
        roles = features.enabled_roles(org)
        by_role = dict(people.filter(is_active=True).values_list("role").annotate(n=Count("pk")))
        return Response(
            {
                "users": people.count(),
                "active_users": people.filter(is_active=True).count(),
                "users_by_role": {role: by_role.get(role, 0) for role in roles},
                "queries": Query.objects.in_org(org).count(),
                "imports": ImportBatch.objects.in_org(org).filter(status=BatchStatus.CONFIRMED).count(),
                "reports": AuditReport.objects.in_org(org).count(),
                "criteria": Criterion.objects.in_org(org).count(),
            }
        )


class SystemStatsView(APIView):
    """Organization-level system statistics: workload, activity and storage."""

    allowed_roles = ORG_ROLES
    required_feature = features.SYSTEM_STATS

    def get(self, request):
        org_id = request.user.organization_id
        queries = Query.objects.in_org(org_id)
        today = timezone.localdate()
        evidence = Evidence.objects.in_org(org_id).aggregate(files=Count("pk"), size=Sum("size_bytes"))
        log = AuditLog.objects.filter(organization_id=org_id).aggregate(
            entries=Count("pk"), last=Max("timestamp")
        )
        return Response(
            {
                "queries": {
                    "total": queries.count(),
                    "open": queries.exclude(status=Status.CLOSED).count(),
                    "closed": queries.filter(status=Status.CLOSED).count(),
                    "overdue": queries.filter(deadline__lt=today).exclude(status=Status.CLOSED).count(),
                    "by_status": by_field(queries, "status"),
                    "by_risk": by_field(queries, "risk_rating_current"),
                },
                "activity": {
                    "follow_up_entries": FollowUpActivity.objects.in_org(org_id).count(),
                    "comments": Comment.objects.in_org(org_id).count(),
                    "audit_log_entries": log["entries"],
                    "last_activity_at": log["last"],
                    "last_import_at": ImportBatch.objects.in_org(org_id)
                    .filter(status=BatchStatus.CONFIRMED)
                    .aggregate(last=Max("confirmed_at"))["last"],
                },
                "storage": {"evidence_files": evidence["files"], "evidence_bytes": evidence["size"] or 0},
                "people": User.objects.filter(organization_id=org_id).aggregate(
                    active=Count("pk", filter=Q(is_active=True)),
                    disabled=Count("pk", filter=Q(is_active=False)),
                ),
            }
        )
