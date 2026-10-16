#!/bin/sh
# Nightly backups (architecture.md 10), run by the backup service on the postgres:16 image so pg_dump
# matches the server version. Keeps 30 daily and 12 monthly copies in the backups volume.
#   backup.sh          run every night at BACKUP_TIME (Africa/Kampala), forever
#   backup.sh --now    run one backup now and exit
# The backups volume must also be copied to a second location in Uganda (deploy/DOCKER.md).
set -eu
: "${BACKUP_TIME:=02:00}"
: "${BACKUP_KEEP_DAYS:=30}"
: "${BACKUP_KEEP_MONTHS:=12}"
: "${PGHOST:=db}"
: "${PGDATABASE:=auditlogs}"
export PGHOST PGDATABASE

run_backup() {
    stamp=$(date +%Y%m%d-%H%M)
    mkdir -p /backups/daily /backups/monthly
    # Custom format: compressed, and restorable table by table with pg_restore.
    pg_dump --format=custom --no-owner --file="/backups/daily/db-$stamp.dump.part"
    mv "/backups/daily/db-$stamp.dump.part" "/backups/daily/db-$stamp.dump"
    # Evidence and import files are already encrypted at rest; copy them as they are.
    tar -czf "/backups/daily/files-$stamp.tar.gz.part" -C /data evidence imports
    mv "/backups/daily/files-$stamp.tar.gz.part" "/backups/daily/files-$stamp.tar.gz"
    # Keep a monthly copy from the first night of each month.
    if [ "$(date +%d)" = "01" ]; then
        cp "/backups/daily/db-$stamp.dump" "/backups/daily/files-$stamp.tar.gz" /backups/monthly/
    fi
    find /backups/daily -type f -mtime +"$BACKUP_KEEP_DAYS" -delete
    find /backups/monthly -type f -mtime +"$((BACKUP_KEEP_MONTHS * 31))" -delete
    echo "$(date '+%Y-%m-%d %H:%M') backup ok: db-$stamp.dump, files-$stamp.tar.gz"
}

if [ "${1:-}" = "--now" ]; then
    run_backup
    exit 0
fi

echo "Backups scheduled daily at $BACKUP_TIME ($(date +%Z))"
while true; do
    now=$(date +%s)
    next=$(date -d "today $BACKUP_TIME" +%s)
    [ "$next" -le "$now" ] && next=$(date -d "tomorrow $BACKUP_TIME" +%s)
    sleep $((next - now))
    run_backup || echo "$(date '+%Y-%m-%d %H:%M') BACKUP FAILED" >&2
done
