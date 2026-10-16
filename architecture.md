# architecture.md: AuditLogs Technical Architecture

How the system is built and deployed. Rules are in `system.md`; behaviour is in `design.md`.

## 1. Principles

- One server, one Docker Compose file, one database. Add complexity only when usage demands it.
- Security rules enforced in the backend and database, not the UI.
- Everything runs in Uganda in production. No foreign services receive real data.
- Boring, well-known tools that local developers can support.

## 2. System overview

```
 Browser (React SPA)
        |  HTTPS
        v
   +----------+       +-----------------------------+
   |  Nginx   |-----> | Django + DRF (gunicorn)     |
   | TLS,     |       |  - auth, MFA, RBAC          |
   | static   |       |  - business rules           |
   +----------+       |  - audit log writer         |
                      +---+---------+----------+----+
                          |         |          |
                          v         v          v
                   PostgreSQL   Evidence    SMTP (client
                   (data +      files       mail server)
                   audit log)   (encrypted)
                          |         |
                          v         v
                   Nightly backups (stored in Uganda)

   Scheduler (cron container): chain verification, deadline emails,
   backup jobs, retention checks.
```

All of this runs on one Linux server in Uganda (own data centre, NITA-U National Data Centre, or a Ugandan provider).

## 3. Containers (docker-compose)

| Service | Image | Purpose |
|---|---|---|
| nginx | nginx | TLS, serves frontend build and proxies `/api` |
| api | python (Django, gunicorn) | Application |
| db | postgres | Database |
| scheduler | same as api | Runs management commands on a schedule |
| clamav (optional) | clamav | Scan uploaded evidence |

Volumes: `pgdata`, `evidence` (encrypted files), `backups`.

## 4. Repository layout

```
auditlogs/
  system.md  design.md  architecture.md  agent_workflow.md
  docker-compose.yml  docker-compose.dev.yml  .env.example
  backend/
    manage.py
    config/            settings (base, dev, prod), urls, wsgi
    apps/
      core/            base models, permissions, utilities
      accounts/        users, roles, MFA, lockout
      imports/         ImportBatch, parsers, preview, confirm
      queries/         Query, QueryRevision, Assignment
      followup/        FollowUpActivity, Evidence
      workflow/        StatusChangeRequest, transitions
      auditlog/        AuditLog, hash chain, verifier
      dashboard/       aggregates, CIA Activity view
      compliance/      retention, disposal, breach register, exports
      notifications/   email templates and senders
    tests/
  frontend/
    src/ (pages, components, api client, auth, role routes)
  deploy/
    nginx.conf  backup.sh  restore.sh  runbook.md
```

## 5. Backend design

### 5.1 Authorisation (the most important part)

- Custom DRF permission classes per role and action, default deny.
- **Queryset scoping:** every model that holds query data exposes `objects.for_user(user)`. IAs get `filter(current_assignee=user)`, others get the role's allowed set. ViewSets must use it; a test fails the build if a ViewSet reads query data without it.
- Object lookups use the scoped queryset, so an IA requesting another IA's query gets 404.
- ICT is excluded from all audit content endpoints except through an approved, unexpired break-glass grant.

### 5.2 Workflow service

A single `transition(query, to_status, actor, reason)` function holds the allowed-transition table from `design.md`. Views never set `status` directly. It checks: transition allowed, actor role, no self-approval, required reason. It writes the audit entry in the same database transaction.

### 5.3 Audit log

- `AuditLog` insert happens inside the same transaction as the change it records.
- Chain integrity: inserts take a PostgreSQL advisory lock, read the latest `entry_hash`, compute the new hash (SHA-256 over previous hash plus canonical JSON), and insert.
- Database enforcement: the app's DB role has `INSERT, SELECT` only on `auditlog_auditlog`; a trigger raises an error on `UPDATE` or `DELETE` and on `TRUNCATE`.
- A management command `verify_audit_chain` recomputes every hash and reports the first break. It runs nightly and on demand.
- Backups of the log are kept so a tampered database can be compared.

### 5.4 Import pipeline

Upload → store source file with SHA-256 → parse (openpyxl or pandas) → validate rows → save a Previewed batch with parsed rows in a staging table → PIA confirms → create Query rows in one transaction → audit entry. Cancelled batches leave no queries.

### 5.5 Files

- Evidence stored under random UUID filenames outside the web root.
- Encrypted at rest with the `cryptography` library (Fernet), key from an environment secret held separately from backups. The server disk is also encrypted (LUKS) if the host allows.
- Downloads go through an authorised API endpoint, never a public URL.
- Optional ClamAV scan before accepting.

### 5.6 Authentication and sessions

- Argon2 password hashing, minimum length 12.
- MFA with django-otp: a 6-digit one-time PIN emailed through the client SMTP server after the password step (owner decision 2026-10-16, replacing TOTP). It is valid for 5 minutes, works once, and is required before any session is fully active.
- django-axes: lock after 5 failed attempts for 15 minutes; failures logged.
- Sessions: secure cookies, HttpOnly, SameSite=Lax, 30 minute idle timeout.
- DRF throttling on login and export endpoints.

### 5.7 Time and scheduling

The scheduler container runs management commands via cron: `verify_audit_chain` (nightly), `send_deadline_emails` (daily), `expire_grants` (every 15 minutes), `run_backup` (nightly), `check_retention` (weekly).

## 6. API outline (REST, JSON, prefix `/api/v1/`)

| Area | Endpoints |
|---|---|
| Auth | `POST auth/login`, `POST auth/mfa`, `POST auth/logout`, `GET auth/me` |
| Users (ICT) | `GET/POST users`, `PATCH users/{id}`, `POST users/{id}/disable`, `POST users/{id}/reset-mfa` |
| Imports (PIA) | `POST imports` (upload), `GET imports/{id}/preview`, `POST imports/{id}/confirm`, `POST imports/{id}/cancel`, `GET imports` |
| Queries | `GET queries`, `GET queries/{id}`, `PATCH queries/{id}` (CIA, reason required), `GET queries/{id}/revisions` |
| Assignment (CIA) | `POST queries/{id}/assign`, `POST queries/bulk-assign` |
| Follow-up | `GET/POST queries/{id}/activities`, `GET/POST queries/{id}/evidence`, `GET evidence/{id}/download` |
| Workflow | `POST queries/{id}/propose-status`, `GET status-requests`, `POST status-requests/{id}/approve`, `POST status-requests/{id}/reject`, `POST queries/{id}/status` (CIA direct) |
| Dashboard | `GET dashboard/summary`, `GET dashboard/overdue`, `GET dashboard/cia-activity` |
| Audit log | `GET audit-log` (CIA), `POST audit-log/verify` (CIA, ICT) |
| Compliance | `GET/POST retention-rules`, `GET/POST disposals`, `GET/POST breaches`, `GET subject-search`, `POST subject-export` |
| Break-glass | `POST access-requests`, `POST access-requests/{id}/approve` |

Every endpoint declares its allowed roles in code and is covered by a permission test.

## 7. Frontend design

- React + TypeScript + Vite, Tailwind CSS, React Router, TanStack Query for data fetching.
- Role-based route guards for navigation only; the backend is the real gate.
- Pages follow `design.md` section 6. Shared components: DataTable, StatusBadge, ReasonDialog, EvidenceUploader, Timeline.
- No third-party scripts, fonts or analytics loaded from foreign hosts. Bundle fonts locally.

## 8. Security architecture

| Concern | Control |
|---|---|
| Transport | HTTPS only, HSTS, modern TLS |
| Headers | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| Input | DRF serializers validate everything; parameterised queries via ORM |
| Secrets | Environment variables or a secrets file readable only by the service user |
| Logging | Structured logs on the server, no personal data in application logs |
| Monitoring | Health endpoint, disk and backup checks, alerts by email. No external SaaS |
| Dependencies | Pinned versions, `pip-audit` and `npm audit` in CI |
| Admin | Django admin disabled in production or restricted to ICT on an internal path |

## 9. Deployment

| Environment | Where | Data |
|---|---|---|
| dev | Developer laptop, Docker Compose | Dummy data only |
| staging (optional) | Foreign host acceptable | Dummy data only |
| production | Server in Uganda | Real data |

Release process: build images in CI, tag, copy to the Uganda server, run `docker compose pull && up -d`, run migrations, smoke test. Rollback by redeploying the previous tag; migrations must be reversible or backward compatible.

## 10. Backup and recovery

- Nightly `pg_dump` plus a copy of the evidence volume to a second location in Uganda.
- Retain 30 daily, 12 monthly backups (confirm with ICT).
- Encryption key for evidence stored separately and also backed up securely.
- Quarterly restore test with a written result. Target: restore within 4 hours, loss up to 24 hours.
- `deploy/runbook.md` documents recovery step by step.

## 11. Testing strategy

| Level | Tooling | Must cover |
|---|---|---|
| Unit | pytest | Transition rules, hash chain, import validation |
| Permissions | pytest matrix | Every endpoint × every role × allowed/denied, IA scoping |
| Integration | pytest + test DB | Import to close workflow, audit entries created |
| Chain tamper test | pytest | Modifying a row makes verification fail |
| End-to-end | Playwright | Login with MFA, import, assign, follow-up, propose, approve |
| Security | pip-audit, npm audit, bandit | Dependency and code checks |
| Load | Locust (optional) | 50 concurrent users under 3 s |

CI (GitHub Actions or a self-hosted runner) runs lint, tests and audits on every pull request. CI uses dummy data only.

## 12. Configuration (.env)

`DJANGO_SECRET_KEY`, `DATABASE_URL`, `ALLOWED_HOSTS`, `EVIDENCE_ENCRYPTION_KEY`, `EVIDENCE_DIR`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SESSION_IDLE_MINUTES`, `AXES_FAILURE_LIMIT`, `BACKUP_DIR`, `ENVIRONMENT` (dev/prod). A production start-up check refuses to run if `DEBUG` is true or a foreign SMTP or storage host is configured.

## 13. Cost-keeping choices

- Single server, no Kubernetes, no managed cloud services.
- All open source; no licences.
- Reuse the client's mail server and storage.
- Add MinIO, a read replica or a second server only if volume requires it.

## 14. Risks specific to the architecture

| Risk | Response |
|---|---|
| Single server failure | Tested restores; document rebuild from Docker and backups; consider a warm standby later |
| DB superuser edits the log | Hash chain plus nightly verification plus off-box backup comparison |
| Lost encryption key | Key escrow with the CIA and ICT lead; tested recovery |
| Slow import of large files | Process in background task if over a size threshold |
