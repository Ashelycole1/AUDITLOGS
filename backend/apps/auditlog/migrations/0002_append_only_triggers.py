"""The database refuses UPDATE, DELETE and TRUNCATE on the audit log (system.md 4.5, architecture.md 5.3).

PostgreSQL is the production database. The SQLite triggers make local development and tests behave
the same way. Revoking UPDATE/DELETE/TRUNCATE from the application's role is a deployment step:
see deploy/db_grants.sql.
"""

from django.db import migrations

PG_UP = """
CREATE OR REPLACE FUNCTION auditlog_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'auditlog_auditlog is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auditlog_no_update_delete
    BEFORE UPDATE OR DELETE ON auditlog_auditlog
    FOR EACH ROW EXECUTE FUNCTION auditlog_append_only();

CREATE TRIGGER auditlog_no_truncate
    BEFORE TRUNCATE ON auditlog_auditlog
    FOR EACH STATEMENT EXECUTE FUNCTION auditlog_append_only();
"""

PG_DOWN = """
DROP TRIGGER IF EXISTS auditlog_no_truncate ON auditlog_auditlog;
DROP TRIGGER IF EXISTS auditlog_no_update_delete ON auditlog_auditlog;
DROP FUNCTION IF EXISTS auditlog_append_only();
"""

SQLITE_UP = [
    """CREATE TRIGGER auditlog_no_update BEFORE UPDATE ON auditlog_auditlog
       BEGIN SELECT RAISE(ABORT, 'auditlog_auditlog is append-only'); END;""",
    """CREATE TRIGGER auditlog_no_delete BEFORE DELETE ON auditlog_auditlog
       BEGIN SELECT RAISE(ABORT, 'auditlog_auditlog is append-only'); END;""",
]

SQLITE_DOWN = ["DROP TRIGGER IF EXISTS auditlog_no_update;", "DROP TRIGGER IF EXISTS auditlog_no_delete;"]


def forwards(apps, schema_editor):
    vendor = schema_editor.connection.vendor
    if vendor == "postgresql":
        schema_editor.execute(PG_UP)
    elif vendor == "sqlite":
        for sql in SQLITE_UP:
            schema_editor.execute(sql)
    else:
        raise RuntimeError(f"No append-only triggers defined for {vendor}.")


def backwards(apps, schema_editor):
    vendor = schema_editor.connection.vendor
    if vendor == "postgresql":
        schema_editor.execute(PG_DOWN)
    elif vendor == "sqlite":
        for sql in SQLITE_DOWN:
            schema_editor.execute(sql)


class Migration(migrations.Migration):
    dependencies = [("auditlog", "0001_initial")]

    operations = [migrations.RunPython(forwards, backwards)]
