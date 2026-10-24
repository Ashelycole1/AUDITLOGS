# DECISIONS.md

Date, decision, reason. Newest last.

## 2026-10-16: Backend foundation

1. **Django 5.2 LTS, DRF 3.16, Python 3.12.** Django 5.2 is the long-term support release (security fixes into 2028). Python 3.12 matches system.md 7. Versions are pinned in `backend/requirements*.txt`.

2. **Dependencies added beyond the names in system.md 5.** All are needed for the locked stack to work, and none calls an outside service:
   - `psycopg[binary]`, the PostgreSQL driver.
   - `argon2-cffi`, the Argon2 implementation Django uses.
   - `pytest-django`, which runs pytest against Django.
   - `ruff` and `black`, already named in system.md 7.

   The owner should confirm these in writing, per system.md 5.

3. **Session cookies, not tokens.** The SPA uses Django sessions with CSRF protection. Login and MFA endpoints check CSRF explicitly. Sessions give the 30-minute idle timeout and server-side logout for free, and keep tokens out of browser storage.

4. **Two-step sign-in.** A correct password only marks the session as pending, for 5 minutes. The session is signed in after a valid one-time PIN (decision 12). A password-only session is refused by every endpoint (tested). Five wrong codes end the pending sign-in.

5. ~~First sign-in enrols a TOTP authenticator.~~ Replaced by decision 12.

6. **Lockout is per account, not per IP.** Axes locks after 5 failures for 15 minutes, counting email case variants together. IP lockout stays off while Nginx is the only client, because every request would share one IP. DRF rate limits cover bursts.

7. **No superuser and no Django admin.** Every power comes from a role. The `User` model has no `is_staff` or `is_superuser`. The admin site is not mounted.

8. **Default deny.** Every API view must declare `allowed_roles`. A view without it refuses everyone. `tests/test_permission_matrix.py` fails if a route is missing from the matrix.

9. **Audit log.**
   - Entries are written under a PostgreSQL advisory lock.
   - Each entry is hashed as `SHA-256(prev_hash || canonical JSON)`.
   - Canonical JSON means sorted keys, compact separators and UTF-8, with the timestamp as ISO UTC including microseconds.
   - Triggers refuse UPDATE, DELETE and TRUNCATE in PostgreSQL, and UPDATE and DELETE in SQLite.
   - The model and queryset also refuse changes.
   - Role grants are in `deploy/db_grants.sql`.

10. **SQLite for local runs without Docker.** If `DATABASE_URL` is unset, dev uses `backend/dev.sqlite3` and tests use in-memory SQLite. CI runs the same tests against PostgreSQL 16. Production refuses to start on anything but PostgreSQL.

11. **Client IP in the log is REMOTE_ADDR for now.** The real client address will be taken from a header only Nginx can set. That will be decided in the deployment task.

## 2026-10-16: Owner decisions after the first push

12. **MFA is a one-time PIN by email, not an authenticator app (owner).**
    - After the password step, the server emails a 6-digit PIN through the client's own SMTP server.
    - The PIN is valid for 5 minutes and works once. One resend is allowed per minute, three in all. Five wrong PINs end the attempt, and django-otp adds growing delays.
    - The email contains only the PIN.
    - This uses django-otp's built-in email plugin, so there's no new dependency.
    - **Trade-off:** the second factor is only as strong as the user's mailbox. Whoever controls a work email can complete a sign-in if they also have the password. ICT alone can change an account's email (logged as `user.email_change`) and can't change its own.
    - SMS would need a Ugandan SMS provider and owner approval.
    - Production refuses to start without SMTP configured.

13. **No password or secret is written in the repository (owner).**
    - The dev secret key, the dev database password, the demo-account password and the test password are now generated or read from `.env`.
    - CI uses a passwordless throwaway Postgres.
    - The earlier commits still contain dev-only dummy values: `demo-password`, `demo-password-2026`, `auditlogs-dev-only`, `ci-only`, `correct-horse-battery-2026` and a dev key string. None was ever a real credential.
    - Rewriting the published history is the owner's call.

14. **Commits carry the owner as the only author (owner).** No AI co-author or attribution lines.

## 2026-10-16: Query scoping and import

15. **`for_user` scoping is enforced by a test, not by convention.**
    - Models holding audit content are listed in `apps/core/scoping.py`. Views reach them only through `ScopedQuerysetMixin`.
    - `tests/test_scoping.py` fails if a view sets a plain `queryset` on such a model, or overrides `get_queryset` without calling `super()`.
    - IA requests for someone else's query get 404, not 403, so the response doesn't reveal that the query exists.
    - CEO is in scope for all queries but reaches only summary endpoints, which choose the fields (design.md 6).
    - ICT sees no queries until the break-glass grant exists.

16. **Import rules.**
    - Headers are matched through `IMPORT_HEADER_ALIASES` until the client's template is final.
    - Dates are read as YYYY-MM-DD or DD/MM/YYYY, and Excel date cells are read directly.
    - Risk ratings are matched without regard to case.
    - A deadline before the import date is a warning, not a block (design.md 13).
    - References are re-checked inside the confirm transaction, so two previews of the same file can't both create queries.
    - The limits are 10 MB and 5,000 rows.
    - PDF and Word are refused with a message for now. The lower-reliability fallback comes later.
    - **Open:** import source files are stored as plain files outside the web root. Encrypting them at rest, like evidence, comes with the evidence task. That needs `cryptography`, which architecture.md names.

## 2026-10-16: Core workflow (Phase 3)

17. **The status is guarded at the model level.**
    - `Query.save()` and `QuerySet.update()` refuse any status change unless it comes through `apps.workflow.services.transition`, which holds the design.md 5 table.
    - A test walks every from/to pair for every role and checks only the table's moves pass.
    - A CIA direct change may go to any status except Proposed, which only an auditor's proposal can create.
    - A direct change needs a reason and is logged as `status.direct` for the CIA Activity view.
    - A direct change is refused while a closure proposal is waiting.
    - Assigned, In Progress and Returned need an auditor.

18. **No self-approval is checked by person, not role.** Whoever proposed a closure can never decide it, including an IA who later holds acting-CIA rights.

19. **Follow-up is append-only.** Notes, responses and evidence can't be edited or deleted (model and queryset guards). An auditor's first entry moves Assigned or Returned to In Progress. CIA entries don't change status.

20. **Encryption at rest for evidence and import files.**
    - Files use Fernet (`cryptography`, named in architecture.md) with `EVIDENCE_ENCRYPTION_KEY`, under random names outside the web root. This closes the open item in decision 16.
    - Every download decrypts, checks the SHA-256, is logged as `evidence.download`, and is served as an attachment with `nosniff`. A file that fails the check is refused.
    - In dev, the key lives in `backend/var/dev-file.key` (git-ignored). Production refuses to start without the variable.
    - **Open:** a file write that happens before a failed transaction leaves an orphan encrypted file. It's harmless, but a cleanup job belongs with retention.

21. **Reassignment is all-or-nothing in bulk** and needs a reason, as a first assignment doesn't. The old IA gets 404 at once, and the new IA sees the full history through `GET queries/{id}/history`.

## 2026-10-17: Hosted staging (owner request)

22. **Vercel and Render are a staging environment with dummy data only (owner request, architecture.md 9).**
    - Both platforms are outside Uganda, so they may never hold real audit data (system.md 4.6).
    - **Guardrails:**
      - `config.settings.prod` refuses to start when Render's `RENDER` variable is present.
      - Staging uses `config.settings.staging`: production security, but PINs may go to the service log.
      - The hosted sign-in page says it is a dummy-data test copy. (The yellow banner on every page was removed at the owner's request on 2026-10-17.)
      - `noindex` headers keep search engines out.
    - Vercel forwards `/api/*` to Render, so cookies stay first-party and `SameSite=Lax`. There's no cross-site cookie or CORS setup.
    - The region is Frankfurt, the closest Render region.
    - Demo accounts are created at start-up only when `SEED_DEMO_USERS=true` and a chosen `DEV_SEED_PASSWORD` is set.
    - Adds `gunicorn`, named in architecture.md 2.
    - Not deployed or run here: gunicorn doesn't run on Windows. The first real check is the first Render deploy.

23. **The frontend has two data sources behind one store contract** (`src/storeTypes.ts`).
    - `VITE_DATA_SOURCE=api` uses `src/apiStore.tsx`. Every read and change goes to the Django API, which enforces every rule.
    - Without that setting, the in-browser demo runs, so the screens can still be reviewed with no backend.
    - Store actions are asynchronous in both. The API store reloads what changed after each action, so the screen always shows the server's state.
    - **Not connected yet,** because Phase 4 builds these on the server: CSV export (it must be produced and logged server-side, system.md 4.9), ICT access requests and decisions, and the breach register. In API mode they say so instead of pretending.

## 2026-10-17: Docker (owner request)

24. **Docker Compose for production and development** (architecture.md 3). See `deploy/DOCKER.md`.
    - **Production** (`docker-compose.yml`) runs these services:
      - `web`: Nginx serving the React build, terminating TLS and setting the headers;
      - `api`: gunicorn running as a non-root user;
      - `migrate`: a one-off run of the migrations and grants;
      - `db`: Postgres 16;
      - `scheduler` and `backup`.
    - **Networks:** only `web` publishes ports. The database is on an internal network with no route out. `api` and `scheduler` also join the `app` network, so they can reach the client's mail server for sign-in PINs.
    - **Development** (`docker-compose.dev.yml`) runs Postgres, the API with live reload, and the Vite frontend in API mode.
    - **Not run on this machine,** which has no Docker. The CI `docker` job builds the images and starts the production stack with throwaway secrets on every push. That is the first real run.

25. **Two database roles.**
    - `auditlogs_owner` runs migrations and backups.
    - The API connects as `auditlogs_app`. That role is created on the database's first start, and `manage.py apply_db_grants` gives it ordinary table rights after every migration, but never UPDATE, DELETE or TRUNCATE on the audit log. This replaces `deploy/db_grants.sql`.
    - **Note:** the official Postgres image makes the owner a superuser, which can get past the triggers. That is why the hash chain, the nightly verification and off-server backups still matter (architecture.md 14).

26. **The audit log records the real client IP.** Nginx overwrites `X-Real-IP` on every request, and production reads it through `CLIENT_IP_HEADER`. Without that setting the header is ignored, so a client can't forge it. This closes decision 11.

27. **Scheduler and backups need no new dependency.**
    - `manage.py run_scheduler` runs jobs at fixed Kampala times. Today that's chain verification at 01:30; more jobs join as they are built.
    - Backups use the `postgres:16` image, so `pg_dump` matches the server version. They keep 30 daily and 12 monthly copies.
    - **Open:** copying the backups to a second site in Uganda is a server task for ICT.

## 2026-10-17: Emailed PIN paused on staging (owner request)

28. **Staging signs in with the password alone for now.** Staging has no mail server, so PINs only reached the Render log, which made it hard to try.
    - `MFA_REQUIRED=false` (set in `render.yaml`) makes a correct password sign in directly. The audit log records the sign-in as `auth.login` with `{"mfa": "off"}`, so these sign-ins can be told apart.
    - Lockout, throttling, idle timeout and CSRF are unchanged.
    - **Production can't use it.** The start-up check refuses to run in prod with `MFA_REQUIRED` off, and the default is on everywhere, including development and tests.
    - To bring the PIN back, set `MFA_REQUIRED=true` on Render (with `SMTP_*` set, or PINs go to the log again) and change `render.yaml` to match.

## 2026-10-17: Look and feel after zaro.ai (owner request)

29. **The interface follows zaro.ai's fonts, colours and structure.** This replaces the navy finance-dashboard look (decision history in PROGRESS.md).
    - **Fonts.** zaro.ai uses Saans, a commercial typeface we have no licence for, so we use its own fallback, **Host Grotesk** (OFL). **JetBrains Mono** (OFL) is used for small uppercase labels, table headings, references and dates. Both are bundled through `@fontsource`, so there are still no third-party font hosts. These replace the two IBM Plex packages, so the dependency count is unchanged.
    - **Colours** are zaro's: off-white "cloud" page (`#f3f2ed`) and cards (`#fbfbf9`), umber ink (`#201613`), dark umber primary buttons, and one lilac accent (`#7345e2`) for links, focus and in-progress work. Status colours use their teal, amber, green and rose steps.
    - **Charts:** lilac (open), green `#4a9d54` (closed) and rose `#e0294f` (overdue) pass every dataviz validator check on the card surface. The heatmap uses a lilac ramp.
    - **Structure:** a light top navigation bar (wordmark, plain text links, search, user) replaces the dark sidebar. On phones it opens as a dropdown. Headings are medium weight with tight tracking, and page headers can carry a mono "eyebrow" label. The sign-in page uses zaro's hero layout: a large headline with numbered points.
    - **Not copied:** zaro's logo, wording, illustrations and font files.


## 2026-10-17: Dark mode (owner request)

30. **Light and dark themes from one set of tokens.**
    - Every colour is a CSS variable in `frontend/src/index.css`. The light values are unchanged, and `:root[data-theme="dark"]` redefines all of them. Screens use only tokens, with no raw hex values, so a new screen gets both themes for free.
    - **Dark palette:** a warm umber night (page `#141110`, cards `#1c1817`), so it reads as the same product. The lilac accent and status colours are lifted to keep text contrast on the dark card. The sign-in page gets its own deep-forest variant.
    - **Charts** have their own dark steps rather than an automatic flip. Lilac `#8f72f0`, green `#56a862` and rose `#ec4f75` pass every dataviz validator check on `#1c1817`, and the heatmap ramp passes the ordinal checks. Tooltips use `--color-tip`.
    - **Choosing a theme:** the app opens in **light mode for everyone** by default, whatever the computer's own setting (owner decision, 2026-10-17). The sun/moon button in the top bar and on the sign-in page switches between light and dark, and the choice is kept in `localStorage` (`auditlogs.theme`).
    - **No flash, no CSP change.** `public/theme-init.js` sets `data-theme` before the first paint. It is a same-origin file because the CSP forbids inline scripts.

## 2026-10-17: Risk ratings follow the Standard Risk Matrix Color Mapping Reference (owner request)

31. **Four risk tiers: Low, Medium, High, Critical.** The owner's reference (`assets/Standard Risk Matrix Color Mapping Reference.pdf`, which cites ISO/IEC 31010 Annex B.29 and ANSI/ASSP Z590.3) answers the open question in design.md 13 ("confirm scale with the client").
    - **Data:** `Risk` gains `Critical`, and the rating columns widen to 8 characters (migration `queries 0002`). Existing ratings are unchanged. Imports accept the four names in any case, and also read **"Extreme"** as Critical, since the reference uses both names.
    - **Colours are the reference's own**, green to red. Light mode uses its dark steps (`#2e7d32`, `#fbc02d`, `#ef6c00`, `#c62828`) and dark mode its light steps (`#4caf50`, `#ffeb3b`, `#ff9800`, `#f44336`). They are tokens (`--color-risk-*`), and each has its own label ink chosen so the letter clears the reference's 4.5:1 rule.
    - **Dual coding**, as the reference's accessibility section requires: every rating shows a colour chip with its letter code (L, M, H, C) and the name. Colour is never on its own.
    - **Meaning and escalation** from the reference are in `frontend/src/lib/risk.ts`. The query page shows them under Details, and so does the CIA's edit dialog when choosing a rating. "Needs attention" on the dashboard puts the highest rating first within overdue and due-soon.
    - **Not done:** the reference's numeric indices (1–4, 5–9, 10–15, 16–25) assume likelihood × impact scores, which the import file does not carry. Automatic escalation (for example, emailing the CEO on a Critical query) waits for the notification work in Phase 4.

## 2026-10-22: Role hierarchy, review statuses and approvals (client meeting notes, owner request)

32. **Changes from `auditlogs-required-changes.md` (v2), confirmed items only.** The ⚠️ items in its section 9 are not built and are listed as open in system.md 9.
    - **SIA role and rank.** New role `SIA` (Senior Internal Auditor). Rank IA 1 < SIA 2 < PIA 3 < CIA 4 (`accounts.models.RANK`, `can_assign`). Assignment goes only to an active IA or SIA ranked below the actor. An SIA works its assigned queries exactly as an IA does. The rank would let an SIA assign an IA, but the assign endpoint stays PIA and CIA only until SIA permissions are agreed.
    - **Import and batches moved from the PIA to the CIA.** The PIA assigns (single and bulk, unassigned queries only).
    - **New statuses** `Pending Approval` and `Kept in View` (`Returned` already existed). Status values keep the existing title case.
    - **Reassignment.** The CIA reassigns directly. A PIA's reassignment creates a `ReassignmentRequest`; the query is Pending Approval and stays with the current auditor until the CIA approves (Assigned, new auditor) or rejects (back to its earlier status, reason required). A query proposed for closure must be reviewed before it can be reassigned. Direct status changes are refused while a reassignment waits.
    - **PIA review of closure proposals.** "Returned / Kept in view / passed on for closure" is read as the PIA's review of an auditor's closure proposal: the PIA may return it (reason) or keep it in view (reason), or leave it for the CIA. Only the CIA closes. Kept in View goes back to In Progress when the auditor resumes work, or to Returned by the PIA or CIA. The decided outcome is stored on the proposal (`decided_status`).
    - **Exports.** The CIA exports directly (`GET /queries/export`, CSV, with the list filters). A PIA asks (`POST /export-requests`, with filters and a reason; one waiting at a time), the CIA approves or rejects, and only then can that PIA download it. Every request, decision and download is logged. CSV cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so they cannot run as spreadsheet formulas.
    - **Comments.** New append-only `Comment` on a query, by the CIA or the CEO, read by everyone who can see the query (the CEO through the comments endpoint only). Commenting changes nothing on the query. The CEO comments from the new Personnel page and from CIA activity.
    - **Responsible personnel.** The CEO summary now includes the assigned auditor's name and role. The responsible owner's name is shown under the department on lists and the query page; the CEO's Personnel page lists owners and auditors per department and per open query.
    - **Email notifications** (`apps/core/notify.py`) through Django's mail backend, which is the client SMTP server in production and the console in development. Sent after commit, one message per person, and a failure is logged and never undoes the change. Following design.md 9, messages carry the reference and a link (`APP_URL`), never titles, reasons or comments. The department owner is not emailed: the import carries no address for them.
    - **CIA activity** now also lists approved reassignments.
    - **Seed:** a dummy SIA account, `grace.namutebi@auditlogs.test`.

## 2026-10-23: Owner answers on the open change items

33. **Answers to the open items of DECISIONS 32.**
    - **Notifications are in the app for now.** New `apps/notifications` (the sender moved there from `apps/core/notify.py`): a `Notification` row per person with a headline and a link to the query or page, and a read time. `GET /notifications` lists your own (newest 100, with the unread count); `POST /notifications/{id}/read` and `/notifications/read-all`. Nobody can see anyone else's. The top bar has a bell with the unread count, and every role has a Notifications page. Email is off; `NOTIFY_BY_EMAIL=true` turns it on once the client SMTP server is connected, with the same reference-and-link content.
    - **The CIA can also keep a closure proposal in view** (transition table, endpoint and buttons).
    - **Follow-up, evidence and comments** are added by IA, SIA, PIA and CIA on the queries they can see (an IA or SIA only on their own), and comments by the CEO too. Work by the PIA or CIA does not move the status; only the assigned auditor's first entry starts the query. The auditor is notified of comments by others.
    - **Left out for now:** "SRA" and the CEO's blank third bullet.

## 2026-10-23: Exports as formatted Excel workbooks (owner request)

34. **Query exports are an Excel workbook, not CSV.** CSV cannot carry column widths or styling, so dates showed as `####` and the file was hard to read or print. Both export paths (the CIA's `GET /queries/export` and the PIA's approved `GET /export-requests/{id}/download`) now return `.xlsx` from `apps/queries/workbook.py`, built with openpyxl (already a dependency).
    - **Queries sheet.** A title block gives who exported it (name and role), when (Kampala time), the filters in words and the row count. A PIA export also gives when it was requested, the purpose, and who approved it and when. Below that is one row per query: reference, title, description, department, responsible officer, risk at import and current risk (coloured as in DECISIONS 31), status, deadline, time to deadline (overdue in red), assignee and closed date. Dates are real date cells with fixed widths. Text wraps, with row heights set to fit. The header is frozen and filterable.
    - **Summary sheet.** Open, overdue and closed counts, plus counts by status, current risk and department.
    - **Print-ready.** A4 fitted to page width (the register in landscape, the summary in portrait), the header row repeated on each page, and a "Confidential: internal audit" and page-number footer.
    - **Left out on purpose:** internal ids and fingerprints, which stay in the audit log. Text is always written as text, so a value starting with `=` cannot run as a formula; the old `'` prefix is no longer needed.
    - The in-browser demo store still downloads CSV: it has no spreadsheet library, and deployed builds use the API.

## 2026-10-24: Organizations, platform administration and the expanded query record (auditlogs-additions_final.md, owner request)

35. **Built from `auditlogs-additions_final.md`, with the owner's answers of 2026-10-24.**
    - **Database stays PostgreSQL in production** (deviation from section 3). SQLite on Render's web service has no persistent disk, and the audit log's protections (advisory lock, TRUNCATE trigger, restricted role) are PostgreSQL features. The isolation design of 3.3 is built as written and works on both engines. Local SQLite runs now set WAL, foreign keys, a 5-second busy timeout, `synchronous=NORMAL` and IMMEDIATE transactions.
    - **Formats are added, not replaced** (deviation from section 13). Word (.docx) import sits beside CSV and Excel, and PDF export beside the Excel workbook (DECISIONS 34). New dependencies, approved by the owner: `python-docx` and `reportlab`.
    - **Organizations.** New `apps/organizations`. Every table holding an organization's data has `organization_id` (`OrgOwned`); child records take it from their parent and a mismatch is refused. Query references are unique per organization. Scoping: `for_user` and `in_org` filter by the signed-in person's organization; anything else is a 404. The session carries the organization and must still match. People of a Pending, Suspended, Deactivated or Rejected organization are refused, including open sessions. Existing data moved into one "Default organisation" with everything on (migration `organizations 0002`). Old audit entries keep no organization, which is allowed by the hash: the organization is sealed into an entry's fingerprint only when set, so the existing chain still verifies.
    - **System Administrator** (role `SYS`, no organization, own sign-in page `/platform/login`). It approves, rejects, suspends, reactivates and deactivates organizations (reasons required except to approve), edits their details, chooses their features, and sets up or resets their first ICT administrator. It sees counts and its own log, never audit content (open question 1). A new administrator gets a one-time emailed link to choose a password, never a password from anyone. Outside production the link is also returned, because staging has no mail server. `create_sysadmin` makes the first one.
    - **Features** (section 5): a dashboard per role (IA, SIA, PIA, CIA, CEO) and three components (registered numbers, system stats, status pie). ICT is always on and IA cannot be switched off. A disabled dashboard disables the role: it cannot be given, its holders cannot sign in, and the switch is refused while active people hold it. Presets "Full" (the default on approval) and "Core". Every change is logged with old and new values and the organization.
    - **Sign-up** (section 6): a public form creates a Pending organization whose contact becomes its ICT administrator. Email confirmation is by signed link; approval is required (open question 7), and the contact is emailed when the organization is approved or its status changes.
    - **Query record** (section 8.2): management response, recommendation, audit observation, policy title and policy reference (open question 3: title, then text or clause), and notable numbers (free text, open question 5). "Action party & time" is the responsible officer and the deadline. The risk scale stays the four tiers of DECISIONS 31. All fields are imported, editable by the CIA with revisions, shown on the query page, and in the PDF.
    - **Audit reports and criteria** (section 8.1, open question 2): a report has a header and criteria; queries sit under a criterion. A Word report's header and "Criterion n:" headings create them on confirm; a file naming criteria without a report gets one named after the file.
    - **CEO** (section 9) now reads every query in full, read-only, and keeps commenting (open question 6). Evidence, follow-up and history stay with the audit team.
    - **Status pie chart** (section 10, open question 4): "worked on" means past Assigned; a query waiting for a reassignment counts by its earlier status. The three slices are worked on, allocated but not yet worked on, and not allocated; allocated is also given on its own. Every role in the organization sees organization-wide counts. Clicking a slice filters the query list.
    - **Registered numbers** are counts of people and records (open question 8). No other features are switchable (open question 9).
    - **Original file** (section 12): the CIA, PIA and CEO can download it. It is checked against its SHA-256 before it is served, and every download is logged. Files are stored under a folder per organization.

## 2026-10-25: Queries per person and the organization's profile (owner request)

37. **Who holds the queries, and the organization's name and logo.**
    - **Queries per person.** `GET /dashboard/status-summary` now also returns `allocated_to`: per person, their name, role, how many queries they hold and how many of those are worked on. Nothing else about the queries (no reference, title or text): those stay with the people allowed to open them. Every role of the organization sees it, behind the same "status pie" switch. The dashboard shows it as a second donut, "Queries per person". Its key lists every person with their count, and the PIA, CIA and CEO can open that person's queries from it (the IA and SIA cannot, as before).
    - **Colours.** Three people get a colour each (blue, orange, aqua) and everyone after them shares a grey slice. Six hues were tried, but once any slice can sit beside any other, some pairs could not be told apart (dataviz validator, every pair, both themes). The grey stays off the coloured hues, and since aqua and the grey are below 3:1 on the card, the key and the table view name everyone.
    - **The organization's profile.** The System Administrator can now also set an address, a website and a logo, besides the name and contact details. Everything needs a reason and is logged. The organization's people see the logo and name in the top bar, and the details on their profile; on phones the AuditLogs word gives way to the logo. Only the System Administrator can change them.
    - **Logo safety.** The upload (PNG, JPEG, WebP or GIF, up to 2 MB and 16 million pixels) is opened with Pillow and redrawn as a PNG of at most 512 pixels a side. Only that redrawn PNG is kept, in the database, so no SVG, script or metadata from the file survives. Pillow now appears in `requirements.in`; it was already installed with reportlab, so nothing new is shipped. The logo is served from the same origin (`/organization/logo` to its own people, `/platform/organizations/{id}/logo` to the platform), so the content policy needs no change. The audit entry keeps the picture's SHA-256, not the picture.
