"""Give the application's database role what it needs, and no more (architecture.md 5.3).

Run as the schema owner after every migration (the migrate service does this). The running API
connects as APP_DB_ROLE, which may read and add audit log entries but never change or remove them.
"""

import os

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from psycopg import sql


class Command(BaseCommand):
    help = "Grant the application role its privileges; revoke UPDATE, DELETE and TRUNCATE on the audit log."

    def add_arguments(self, parser):
        parser.add_argument("--role", default=os.environ.get("APP_DB_ROLE", "auditlogs_app"))

    def handle(self, *args, **options):
        if connection.vendor != "postgresql":
            self.stdout.write("Not PostgreSQL: there are no database roles to grant. Nothing to do.")
            return
        role = options["role"]
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [role])
            if cursor.fetchone() is None:
                raise CommandError(
                    f"Database role {role} does not exist. The db service creates it on first start."
                )
            r = sql.Identifier(role)
            statements = [
                sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                    sql.Identifier(connection.settings_dict["NAME"]), r
                ),
                sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(r),
                sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}").format(
                    r
                ),
                sql.SQL("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {}").format(r),
                # The audit log is append-only for the running application (system.md 4.5).
                sql.SQL("REVOKE UPDATE, DELETE, TRUNCATE ON auditlog_auditlog FROM {}").format(r),
            ]
            for statement in statements:
                cursor.execute(statement)
            cursor.execute(
                "SELECT privilege_type FROM information_schema.role_table_grants "
                "WHERE table_name = 'auditlog_auditlog' AND grantee = %s ORDER BY 1",
                [role],
            )
            granted = [row[0] for row in cursor.fetchall()]
        if set(granted) & {"UPDATE", "DELETE", "TRUNCATE"}:
            raise CommandError(f"{role} still holds {granted} on the audit log.")
        self.stdout.write(
            self.style.SUCCESS(f"Grants applied to {role}. Audit log: {', '.join(granted)} only.")
        )
