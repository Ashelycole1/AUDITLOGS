#!/bin/sh
# Refuse to start without a TLS certificate: the site is HTTPS only (architecture.md 8).
set -eu
for f in /etc/nginx/certs/fullchain.pem /etc/nginx/certs/privkey.pem; do
    if [ ! -s "$f" ]; then
        echo "Missing $f. Put the certificate and key in deploy/certs (see deploy/DOCKER.md)." >&2
        exit 1
    fi
done
if [ -z "${SERVER_NAME:-}" ]; then
    echo "SERVER_NAME is not set (the public host name, e.g. auditlogs.example.ug)." >&2
    exit 1
fi
