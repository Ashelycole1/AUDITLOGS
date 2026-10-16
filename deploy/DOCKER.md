# Running AuditLogs with Docker

There are two stacks:

| File | For | Data |
|---|---|---|
| `docker-compose.yml` | Production on the server in Uganda (architecture.md 2, 3, 9) | Real, once go-live is approved |
| `docker-compose.dev.yml` | A developer's machine | Dummy data only (system.md 4.10) |

Hosted staging (Vercel and Render, dummy data) does not use Docker: see `deploy/STAGING.md`.

## Production stack

```
                    ┌───────────── app network ─────────────┐
 Internet ─ 443 ──> │ web (Nginx: TLS, React build, /api) ──> api (Django on gunicorn) ──> mail server
          ─  80 ──> │   redirects to HTTPS                        │                         │
                    └─────────────────────────────────────────────┼─────────────────────────┘
                    ┌───────── data network: no route out ────────┼──────────────────┐
                    │ db (Postgres 16) <── migrate (one-off) ── scheduler ── backup  │
                    └────────────────────────────────────────────────────────────────┘
```

| Service | What it does |
|---|---|
| `web` | Serves the React build, terminates TLS, redirects HTTP to HTTPS, and forwards `/api` to the API. It sets the security headers (CSP, HSTS, no framing) and refuses to start without a certificate. |
| `api` | Django on gunicorn as a non-root user, with `config.settings.prod`. It connects as **`auditlogs_app`**, which cannot UPDATE, DELETE or TRUNCATE the audit log. |
| `migrate` | Runs on every `up`: migrations as **`auditlogs_owner`**, then `apply_db_grants`. The API starts only if this succeeds. |
| `db` | PostgreSQL 16, never published to the host or the internet. |
| `scheduler` | `manage.py run_scheduler`: verifies the audit chain at 01:30 Kampala time every night. More jobs join as they are built. |
| `backup` | `pg_dump`, plus a copy of the (already encrypted) evidence and import files, at 02:00 Kampala time. Keeps 30 daily and 12 monthly copies in `BACKUP_DIR`. |

### First start

1. On the server: install Docker Engine with the Compose plugin, and clone the repository.
2. Run `cp .env.example .env` and fill in the **Production stack** and **Both stacks** sections. Generate every secret separately, using the commands in the file. Keep `EVIDENCE_ENCRYPTION_KEY` somewhere safe and apart from the backups: without it, uploaded files can't be read.
3. Put the TLS certificate for `SERVER_NAME` in `deploy/certs/` as `fullchain.pem` and `privkey.pem`. Files in that folder are never committed.
4. Run `docker compose up -d --build`.
5. Check it:
   - `docker compose ps` shows `db`, `api`, `web`, `scheduler` and `backup` running, and `migrate` exited with code 0.
   - `https://SERVER_NAME/api/v1/health` answers `{"status": "ok"}`.
6. Create the first ICT account, then let ICT create everyone else in the app:
   ```sh
   docker compose exec api python manage.py shell -c "from apps.accounts.models import User; User.objects.create_user(email='ict.lead@example.ug', full_name='ICT Lead', role='ICT')"
   docker compose exec api python manage.py changepassword ict.lead@example.ug
   ```

### Everyday operations

| Task | Command |
|---|---|
| Update to a new version | `git pull && docker compose up -d --build`. Migrations and grants run automatically. |
| Logs | `docker compose logs -f api` (or `web`, `scheduler`, `backup`) |
| Verify the audit chain now | `docker compose exec api python manage.py verify_audit_chain` |
| Back up now | `docker compose exec backup /bin/sh /backup.sh --now` |
| Restore | Run `docker compose stop api scheduler`, then `docker compose run --rm --entrypoint /bin/sh backup /restore.sh db-YYYYMMDD-HHMM.dump files-YYYYMMDD-HHMM.tar.gz`, then `docker compose up -d`. |

**Backups must leave the server.** Copy `BACKUP_DIR` to a second location in Uganda every night (architecture.md 10). Test a restore every quarter, record the result, and run `verify_audit_chain` after it.

### What CI checks

On every push, the `docker` job in `.github/workflows/ci.yml`:
1. builds both images;
2. starts this whole stack with throwaway secrets and a self-signed certificate;
3. checks that the site answers over HTTPS, that HTTP redirects, and that the security headers are present;
4. checks that the `auditlogs_app` role is refused UPDATE, DELETE and TRUNCATE on the audit log;
5. runs the scheduler and one backup.

## Development stack

```sh
cp .env.example .env      # set POSTGRES_PASSWORD (and DEV_SEED_PASSWORD if you want a fixed one)
docker compose -f docker-compose.dev.yml up --build
docker compose -f docker-compose.dev.yml exec api python manage.py seed_dev_users
```

Open http://localhost:5173. The backend code reloads on save, and so does the frontend. Sign-in PINs are printed in `docker compose -f docker-compose.dev.yml logs -f api`. Tests run with `docker compose -f docker-compose.dev.yml exec api pytest`.
