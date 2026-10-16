-- Database roles for production (architecture.md 5.3). Run once as the database owner, after migrations.
--
-- auditlogs_owner : owns the schema and runs migrations. Used only during deployment.
-- auditlogs_app   : what the running application connects as.
--
-- The application role may INSERT and SELECT on the audit log, never UPDATE, DELETE or TRUNCATE.
-- The append-only triggers from migration auditlog.0002 stop even the owner from changing rows.

GRANT USAGE ON SCHEMA public TO auditlogs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO auditlogs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO auditlogs_app;

REVOKE UPDATE, DELETE, TRUNCATE ON auditlog_auditlog FROM auditlogs_app;
GRANT SELECT, INSERT ON auditlog_auditlog TO auditlogs_app;

-- Check: this must list only INSERT and SELECT for auditlogs_app.
-- SELECT privilege_type FROM information_schema.role_table_grants
--  WHERE table_name = 'auditlog_auditlog' AND grantee = 'auditlogs_app';
