#!/bin/sh
# Runs once, when the database volume is first created (postgres image: /docker-entrypoint-initdb.d).
# Creates the role the running API connects as. Its privileges are granted after each migration by
# `manage.py apply_db_grants`, which keeps UPDATE, DELETE and TRUNCATE on the audit log away from it.
set -eu
: "${APP_DB_PASSWORD:?Set APP_DB_PASSWORD in .env}"

psql -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE auditlogs_app LOGIN PASSWORD :'app_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO auditlogs_app;
SQL
