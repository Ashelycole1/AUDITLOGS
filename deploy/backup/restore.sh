#!/bin/sh
# Restore a backup into the running stack (architecture.md 10). Run from the repository root:
#   docker compose run --rm backup /restore.sh db-20261017-0200.dump files-20261017-0200.tar.gz
# Stop the api and scheduler first:  docker compose stop api scheduler
# This REPLACES the current database and files. Record the restore test result in deploy/runbook.md.
set -eu
dump="${1:?Name of the db-*.dump file in the backups volume}"
files="${2:?Name of the files-*.tar.gz file in the backups volume}"
: "${PGHOST:=db}"
: "${PGDATABASE:=auditlogs}"
export PGHOST PGDATABASE

src="/backups/daily"
[ -f "$src/$dump" ] || src="/backups/monthly"
[ -f "$src/$dump" ] || { echo "No such backup: $dump" >&2; exit 1; }

echo "Restoring database from $src/$dump"
pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="$PGDATABASE" "$src/$dump"

echo "Restoring evidence and import files from $src/$files"
rm -rf /data/evidence/* /data/imports/*
tar -xzf "$src/$files" -C /data

echo "Done. Start the app again (docker compose up -d), then run manage.py verify_audit_chain."
