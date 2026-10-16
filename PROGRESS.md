# PROGRESS.md

Updated at the end of every session and whenever work is paused (see `agent_workflow.md` section 10).

## Status: 2026-10-16

### Done
- Specs written: `system.md`, `design.md`, `architecture.md`, `agent_workflow.md`.
- Clickable frontend prototype in `frontend/` (React 18, TypeScript, Vite 6, Tailwind 4, React Router 6, locally bundled IBM Plex fonts).
  - Screens for all five roles: Login with MFA step and lockout; PIA Import, Batches, All queries, Progress; CIA Queries, Query detail, Approvals, Audit log, Reports, Compliance; IA My queries and workspace; CEO Overview and CIA activity; ICT Users and System.
  - `src/store.tsx` is an in-browser stand-in for the Django API so screens can be reviewed before the backend exists. It is **not** the security boundary.
  - `src/lib/rules.ts` has the transition table, IA scoping and reason checks. `src/lib/auditChain.ts` and `src/lib/sha256.ts` handle the hash-chained log.
  - `src/data/seed.ts` contains dummy data only.
  - `npm run build` (tsc + vite) passes.

- 2026-10-16: visual redesign of the whole prototype, called "the working paper". It replaced the glass look at the owner's request.
  - Ledger-green paper, a bottle-green binder spine for nav with index tabs, and red pencil only for exceptions. IBM Plex is kept, so there are no new dependencies.
  - Status shown as auditor's tick marks (`StatusMark` in `src/components.tsx`) instead of coloured pills.
  - The audit log shows the hash chain: a strip of links plus a link gutter in the table. "Verify chain" walks the links, and hovering a row highlights the fingerprint it is sealed to.
  - Tokens are in `src/index.css`. The old `lake` token names were kept and now point to the green palette.
- 2026-10-16: refinement pass on the remaining screens. Shared `Check` tick/cross mark added in `src/components.tsx`.
  - Import: drag-and-drop, the required columns shown as a header row, per-line ticks and crosses, a "show only problems" filter, and a confirm bar that stays visible.
  - Approvals: review sheets showing time waiting and a checklist from the closure rule.
  - Reports: status ledger with a total line, and overdue bars.
  - Compliance: time left on approved ICT access, and a breach register. Its chain status is computed live, but its download-volume line is still a placeholder.
  - CIA activity: counts that work as filters. A missing reason is flagged only where a reason is required.
  - Users and System: marks for account, MFA and health status, and full role names.

- 2026-10-16: third redesign, because the owner found the working-paper look not professional enough. The new direction is a professional finance-dashboard style.
  - Navy sidebar with icons, a top bar with query search, white cards on a cool grey page, and pill status badges. Inline icons live in `src/icons.tsx`, so there's no icon package.
  - New **Dashboard** (`src/pages/Dashboard.tsx`) is the home page for PIA, CIA, IA and CEO, and replaces Overview/Progress. `/overview` redirects to it.
    - **Headline tiles:** open, overdue, closure rate, plus one per role. They have sparklines and 30-day changes.
    - **Charts:** open/overdue trend, status, overdue aging, risk × status heatmap, progress by department, and (CIA only) auditor workload.
    - **Lists:** "Needs attention" and recent activity.
  - The charts are an in-house kit in `src/charts.tsx`, with no chart library. Each has a hover tooltip, keyboard focus and a table view. Colours were checked with the dataviz palette validator.
  - Trend figures are rebuilt from batch confirm, deadline and `closedAt` dates. Reopened queries lose their earlier closure, so history is approximate until the backend stores status history.

- 2026-10-16: **Backend started: Phase 1 setup and Phase 2.1.** See `backend/README.md` and `DECISIONS.md`.
  - **Project setup:**
    - `backend/` uses Django 5.2 LTS, DRF and Python 3.12, with pinned requirements.
    - Settings are split into `base`/`dev`/`test`/`prod`. The production start-up check refuses DEBUG, the dev secret key, non-Postgres databases, wildcard hosts and insecure cookies.
    - Also added: `docker-compose.dev.yml` (Postgres 16 + api), `backend/Dockerfile`, `.env.example`, `.gitignore`, CI (`.github/workflows/ci.yml`: ruff, black, migration check, pytest on Postgres, frontend build), and ruff/black/pytest config.
  - **Accounts (`apps/accounts`):**
    - Email user with role and acting-CIA expiry. No superuser and no admin site.
    - Argon2 passwords, minimum 12 characters.
    - Two-step sign-in: password, then TOTP. First sign-in enrols the authenticator.
    - Axes lockout after 5 failures for 15 minutes, with case-insensitive email.
    - 30-minute idle session, CSRF on login.
    - ICT account management: create, edit and role change, disable/enable, reset MFA. Reasons are required and ICT can't act on its own account.
    - `seed_dev_users` creates the 7 dummy accounts.
  - **Core (`apps/core`):** default-deny `RoleRequired` permission (views declare `allowed_roles`), reason validator, health endpoint.
  - **Audit log (`apps/auditlog`):**
    - Hash-chained, append-only entries, written under an advisory lock in Postgres.
    - Triggers block UPDATE/DELETE/TRUNCATE in Postgres and UPDATE/DELETE in SQLite.
    - `verify_audit_chain` command, CIA log list with filters, and a verify endpoint (CIA and ICT, counts only).
    - `deploy/db_grants.sql` revokes UPDATE/DELETE/TRUNCATE from the app role.
  - **Tests:**
    - 118 passing on SQLite. They include the full permission matrix (every route × role, anonymous, and password-without-MFA), plus tamper tests where an edited or removed entry breaks verification.
    - Ruff and black are clean.
    - Smoke-tested over HTTP with `runserver`.

- 2026-10-16 (later), **owner decisions:**
  - MFA is now a **one-time PIN emailed** through the client SMTP server, replacing TOTP and QR codes. It's valid for 5 minutes, works once, and can be resent up to 3 times.
  - **No secrets in the repo.** Dev and test passwords and the dev key are generated or come from `.env`, and CI uses a passwordless throwaway Postgres.
  - **Commits carry only the owner as author.**
  - Committed as `8fb504e` and `78c9124`, not pushed.
- 2026-10-16, **Phase 2.2 and 2.4:**
  - **Query models** (`apps/queries`: Query, QueryRevision, Assignment):
    - The original wording, original risk and reference can't be changed, and queries can't be deleted (model and queryset guards).
    - `for_user` scoping is enforced by `tests/test_scoping.py`.
    - Endpoints: `GET /queries` (filters: status, risk, department, assignee, overdue, search) and `GET /queries/{id}`.
  - **Import** (`apps/imports`):
    - Upload CSV or xlsx, then validate. Per-row errors and warnings appear in the preview.
    - Confirm creates every query in one transaction, re-checking references, with an `import.confirm` entry plus a `query.create` entry per query. Cancel is the other option.
    - The source file is kept with its SHA-256. PIA only.
  - 183 tests passing on SQLite, lint clean.

- 2026-10-16, **Phase 3 (core workflow) done:**
  - CIA edits with revisions, and the original is kept.
  - Assign, reassign and bulk assign.
  - Notes and management responses (append-only).
  - Encrypted evidence upload and download, with the import source files now encrypted too.
  - The workflow service with the design.md 5 table. Status changes outside it are refused by the model.
  - Closure proposal, then approve or return, with no self-approval. Direct CIA changes need a reason and are flagged.
  - Approvals inbox (`/status-requests`) and per-query history.
  - 317 tests passing, including the end-to-end import-to-Closed test, a test of every transition pair for every role, and IA isolation on every nested route.

### Not done
- Nothing is committed yet. The repo has no commits on `main`.
- **Not run against PostgreSQL yet.** Docker and Postgres aren't installed on this machine. The Postgres trigger SQL, advisory lock, `docker-compose.dev.yml` and CI job are written but unexecuted. CI or a Docker machine will be the first real run.
- The frontend still uses its in-browser store. It isn't wired to the API yet; that needs an API client and TanStack Query.
- MFA enrolment shows a secret and `otpauth://` URI but no QR code. That needs either a frontend dependency or an in-house encoder (owner to decide).
- Acting-CIA grant endpoint, one-time enrolment links and email are not built. Real client IP from Nginx is still to come.
- Pre-commit hooks and dummy query fixtures are not set up.

### In flight
- The frontend dev server (http://localhost:5173) was stopped automatically on 2026-10-16 because the machine ran low on memory. Restart it with `npm run dev` in `frontend/` when needed.

### Next (proposed)
1. Owner: confirm the extra dependencies in `DECISIONS.md` item 2 (`openpyxl` is named in system.md).
2. Wire the frontend to the API: sign-in (password, then PIN), then queries, import, follow-up and approvals.
3. Phase 4: dashboard and overdue endpoints (CEO summary fields), CIA Activity view, email notifications, compliance (retention, breach register, subject search and export, break-glass).
4. First run against PostgreSQL (CI or a machine with Docker).

### Open questions (system.md section 9, still unanswered)
- Is the organisation a public body?
- What are the retention periods per record type?
- What is the PDPO registration status, and who is the DPO?
- What is the final production host?
- Can we get sample import files and formats?
- What is the final scope of the CEO's visible details?
