# AuditLogs backend

Django + Django REST Framework API under `/api/v1/`. Read `../system.md` first.

## Run locally without Docker (SQLite, dummy data)

```sh
cd backend
uv venv --python 3.12 .venv
uv pip install --python .venv -r requirements.txt -r requirements-dev.txt
.venv/Scripts/python manage.py migrate          # .venv/bin/python on Linux/macOS
.venv/Scripts/python manage.py seed_dev_users   # 7 dummy accounts, password demo-password-2026
.venv/Scripts/python manage.py runserver
```

## Run with Docker (PostgreSQL)

```sh
docker compose -f docker-compose.dev.yml up --build
docker compose -f docker-compose.dev.yml exec api python manage.py seed_dev_users
```

## Checks

```sh
.venv/Scripts/python -m pytest          # unit, permission matrix, tamper tests
.venv/Scripts/python -m ruff check .
.venv/Scripts/python -m black --check .
.venv/Scripts/python manage.py verify_audit_chain
```

## Signing in

1. `GET /api/v1/auth/csrf` sets the CSRF cookie. Send it back as `X-CSRFToken` on every write.
2. `POST /api/v1/auth/login` with `{email, password}` returns either:
   - `{"mfa": "verify"}`
   - `{"mfa": "setup", "secret", "otpauth_uri"}` on first sign-in
3. `POST /api/v1/auth/mfa` with `{code}` signs the session in and returns the user.

Until step 3 succeeds, every other endpoint answers 403.

## Layout

| Path | What |
|---|---|
| `config/settings/` | `base`, `dev`, `test`, `prod`. Production refuses unsafe settings at start-up |
| `apps/core` | Default-deny role permission, reason validation, health |
| `apps/accounts` | User and roles, sign-in with TOTP, lockout, ICT account management |
| `apps/auditlog` | Hash-chained append-only log, verifier, `verify_audit_chain` command |
| `tests/` | One file per area. `test_permission_matrix.py` covers every route × role |
