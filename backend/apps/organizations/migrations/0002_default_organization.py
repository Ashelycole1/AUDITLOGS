"""Give the data that existed before organizations to one organization (auditlogs-additions_final.md 3.2).

If the database already holds people or queries, they all belong to a single "Default organisation",
created Active with every feature on, so nothing changes for them. An empty database gets nothing.
The audit log is left as it is: it is append-only, and entries without an organization stay valid.
"""

from django.db import migrations
from django.utils import timezone

FEATURE_KEYS = (
    "dashboard.IA",
    "dashboard.SIA",
    "dashboard.PIA",
    "dashboard.CIA",
    "dashboard.CEO",
    "component.registered_numbers",
    "component.system_stats",
    "component.status_pie",
)
# (app, model, parent field the organization follows, or None to use the default directly)
OWNED = [
    ("imports", "ImportBatch"),
    ("imports", "ImportRow"),
    ("queries", "Query"),
    ("queries", "QueryRevision"),
    ("queries", "Assignment"),
    ("workflow", "StatusChangeRequest"),
    ("workflow", "ReassignmentRequest"),
    ("workflow", "ExportRequest"),
    ("followup", "FollowUpActivity"),
    ("followup", "Evidence"),
    ("followup", "Comment"),
    ("notifications", "Notification"),
    ("reports", "AuditReport"),
    ("reports", "Criterion"),
]


def forwards(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    Query = apps.get_model("queries", "Query")
    if not User.objects.exists() and not Query.objects.exists():
        return
    Organization = apps.get_model("organizations", "Organization")
    Feature = apps.get_model("organizations", "OrganizationFeature")
    now = timezone.now()
    org = Organization.objects.create(
        name="Default organisation",
        country="Uganda",
        contact_person="ICT administrator",
        email="ict@example.invalid",
        status="Active",
        approved_at=now,
    )
    Feature.objects.bulk_create(Feature(organization=org, feature_key=key, enabled=True) for key in FEATURE_KEYS)
    User.objects.exclude(role="SYS").filter(organization__isnull=True).update(organization=org)
    for app, model in OWNED:
        apps.get_model(app, model).objects.filter(organization__isnull=True).update(organization=org)


class Migration(migrations.Migration):
    dependencies = [
        ("organizations", "0001_initial"),
        ("accounts", "0003_organization"),
        ("imports", "0002_organization_and_report"),
        ("queries", "0004_organization_and_record_fields"),
        ("workflow", "0003_organization"),
        ("followup", "0003_organization"),
        ("notifications", "0002_organization"),
        ("reports", "0001_initial"),
        ("auditlog", "0003_organization"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
