# AuditLogs: Feature Additions Specification

| | |
|---|---|
| **System** | https://auditlog.ashelycole.dev |
| **Source** | Handwritten notes (3 pages) plus follow-up requirements |
| **Database** | SQLite, embedded in the codebase (see section 3) |
| **Status** | Draft for client confirmation |

> **Note on the live site:** The site is a login-gated single-page app, so only the shell was reachable. Check every item below against staging to confirm whether it already exists, partly exists, or is new.

---

## 1. Roles

**Platform level**

| Role | Purpose |
|------|---------|
| **System Administrator** | Manages institutions, their feature packages and platform health. Does not manage audit content. |

**Organization level (lowest to highest)**

| Role | Notes |
|------|-------|
| IA | Internal Auditor |
| SIA | Senior Internal Auditor |
| PIA | Principal Internal Auditor |
| CIA | Chief Internal Auditor |
| CEO | Read-only overview of the organization (section 9) |
| ICT Admin | Organization administrator: manages users and roles |

Which of these roles and dashboards an organization actually gets is decided by the System Administrator (section 5).

---

## 2. Summary of Additions

| # | Feature | Area |
|---|---------|------|
| 1 | SQLite database foundation | Platform / Data |
| 2 | Overall System Administration (manage institutions) | Platform |
| 3 | Per-organization feature selection (dashboards, registered numbers, system stats) | Platform |
| 4 | Organization sign-up | Platform |
| 5 | Strict data isolation between organizations | Platform / Security |
| 6 | Audit report structure (Queries and Criteria) | Reporting |
| 7 | Expanded query fields | Queries |
| 8 | CEO read-only overview | Roles |
| 9 | Download original uploaded file | Files |
| 10 | Query status pie chart with key | Dashboard |
| 11 | Assignee name shown on assigned queries | Queries |
| 12 | Import (Word) and export (PDF) formats | Import / Export |

---

## 3. Database: SQLite

SQLite is the database for the whole system, including the new multi-organization model. It is **embedded within the platform's codebase**: the application talks to it in-process through its SQLite driver, so there is no separate database server to install, run or secure.

### 3.1 Configuration

- Use **one embedded SQLite database file** for all organizations. The schema and migrations live in the codebase and ship with it, while the database file itself sits in a dedicated data directory that is never served publicly and is excluded from version control (add it to `.gitignore`).
- The application is the only process that opens the file. No other service or tool writes to it while the app is running.
- Enable on every connection:
  - `PRAGMA journal_mode = WAL;` for concurrent readers alongside one writer
  - `PRAGMA foreign_keys = ON;` so relationships are enforced
  - `PRAGMA busy_timeout = 5000;` so brief write contention retries instead of failing
  - `PRAGMA synchronous = NORMAL;` (safe with WAL)
- Keep write transactions short, and funnel writes through one connection pool or queue.
- Use versioned, forward-only **migrations** for every schema change, run automatically on deploy and tested on a copy of production data first.
- Store timestamps as UTC ISO-8601 text. Use integer primary keys, or UUID text for public-facing IDs.

### 3.2 Multi-organization model

Every table that holds organization data carries an `organization_id` column (`NOT NULL`, foreign key to `organizations`), indexed, and included in composite indexes where queries filter by it.

Core tables:

| Table | Key columns |
|-------|-------------|
| `organizations` | id, name, country, contact_person, email, phone, status (pending / active / suspended / deactivated), created_at |
| `organization_features` | organization_id, feature_key, enabled, config (JSON), updated_by, updated_at |
| `users` | id, organization_id (NULL for System Administrators), name, email, role, status |
| `criteria` | id, organization_id, report_id, title, description |
| `queries` | id, organization_id, criterion_id, all fields from section 8, status, assignee_id |
| `query_assignments` | id, organization_id, query_id, assignee_id, assigned_by, assigned_at (history) |
| `imports` | id, organization_id, original_filename, stored_path, checksum, imported_by, imported_at |
| `reports` | id, organization_id, title, audit_period, prepared_by, created_at |
| `comments`, `activity_log` | id, organization_id, actor_id, action, target, created_at |

### 3.3 Isolation in SQLite

SQLite has no row-level security, so isolation must be enforced in application code:

- All database access goes through one **data-access layer** that requires an organization context and appends `organization_id = ?` to every query. Raw queries elsewhere in the code are not permitted.
- The organization ID comes from the authenticated session or token, never from request parameters.
- Add `UNIQUE` and foreign-key constraints that include `organization_id` where practical (for example, a query's criterion must belong to the same organization).
- Detail in section 6.

### 3.4 Files and backups

- Do not store uploaded files as database BLOBs. Store them on disk under `/<organization_id>/…`, with the path and a checksum in the database.
- Back up with SQLite's online backup (`.backup` or `VACUUM INTO`) or continuous replication, never by copying the live file mid-write. Back up the uploads folder alongside it.
- Schedule backups daily, keep several generations, and test a restore regularly.

### 3.5 Scaling note

An embedded SQLite file suits this system at the expected scale (many organizations, moderate write volume) and keeps deployment simple: deploying the code deploys the database engine. Because the app runs as a single instance against one file, running several app servers against the same database is not supported. If that, or sustained heavy concurrent writes, ever becomes a requirement, the data-access layer allows a later move to PostgreSQL without rewriting features.

---

## 4. Overall System Administration (Manage Institutions)

The **System Administrator** sits above all organizations and manages institutions, not audit content.

**Capabilities**
- View all registered organizations with status (pending, active, suspended, deactivated).
- Approve or reject new organization sign-ups.
- Create, edit, suspend, reactivate and deactivate organizations.
- Create the first administrator account for an organization, or reset it.
- **Choose each organization's features** (section 5).
- See platform statistics (number of organizations, users and queries per organization) without opening any organization's audit records.
- Separate login and dashboard from organization users.

---

## 5. Per-Organization Feature Selection

The System Administrator decides, organization by organization, **which features that organization gets**. Anything not selected is hidden in the interface and blocked on the server.

### 5.1 What can be selected

**A. Dashboards** (one per role)

| Dashboard | Selectable |
|-----------|-----------|
| IA | Yes |
| SIA | Yes |
| PIA | Yes |
| CIA | Yes |
| CEO | Yes |
| ICT Admin | Always on (an organization must be able to manage itself) |

Example: an organization may be given only the **IA, PIA, CIA and CEO** dashboards, leaving out SIA.

**B. Dashboard components**

| Component | Description |
|-----------|-------------|
| Registered numbers | Registered-count widgets, such as registered users and records (see open question 8) |
| System stats | Organization-level system statistics widget |
| Query status pie chart | Section 10 |

### 5.2 Behavior

- Selections are made on the organization's page in the System Administrator dashboard, as simple toggles, and saved in `organization_features`.
- **Presets** can speed this up (for example "Full", "Core: IA, PIA, CIA, CEO"), with individual toggles adjustable afterwards.
- **Disabled dashboard means disabled role:** an organization cannot assign a role whose dashboard is off. Users already holding that role are flagged and must be reassigned before the change is saved, or the save is blocked with a clear message.
- **Navigation, widgets and API endpoints** for a disabled feature are not shown and return forbidden if called directly. Enforcement is on the server, never only in the UI.
- **Defaults:** new organizations receive a default package on approval, which the System Administrator can change at approval time or later.
- **Safeguards:** ICT Admin cannot be switched off, and at least one working-level dashboard (IA) must stay enabled.
- **Effect on data:** switching a feature off only hides it. Data is kept, and switching it back on restores it.
- **Audit trail:** every change records who, when, which organization, and the old and new values.
- Changes apply at the next page load or login, with no redeploy needed.

---

## 6. Organization Sign-Up

Companies and institutions sign up as **organizations** so access and data are organized per institution.

**Requirements**
- Public sign-up form: organization name, country, contact person, email, phone, and password for the first admin.
- The person who signs up becomes that organization's first administrator (ICT Admin).
- New organizations start as **Pending** until approved by the System Administrator (recommended, to prevent abuse). Features are assigned at approval (section 5).
- The organization admin creates and manages their own users and assigns roles, limited to the roles enabled for that organization.
- Email verification and approval notifications. SMTP must be connected, since staging currently has none.

---

## 7. Strict Data Isolation Between Organizations

Each organization can access **only its own information**. No user, from any role, can see or reach another organization's data.

**Requirements**
- Every record (users, queries, imports, files, comments, assignments, reports, activity logs) is linked to exactly one organization.
- Every database query and API endpoint is automatically scoped to the logged-in user's organization through the data-access layer (section 3.3), enforced on the server.
- Direct-URL and ID-guessing attempts on another organization's records return **not found or forbidden**.
- Uploaded files are stored and served per organization, with access checks on every download.
- Exports, pie charts, dashboards and notifications only count and include the user's own organization's data.
- Email addresses and logins resolve to a single organization, and sessions and tokens carry the organization.
- Automated tests prove cross-organization access is blocked for every endpoint, including with feature toggles on and off.
- The System Administrator manages institutions but does not browse audit content (see open question 1).

---

## 8. Audit Report Structure and Query Record

### 8.1 Report structure

1. **Report header:** organization, report title, audit period, date, prepared by
2. **Criteria:** the standard, policy, law or benchmark the audit is measured against
3. **Queries:** the queries raised against each criterion, each with the fields in 8.2
4. **Summary:** counts of queries by status and risk rating, plus the pie chart (section 10)

**Requirements**
- A report contains one or more criteria, and each criterion has one or more queries.
- Each query is attached to a criterion.
- Reports are generated from system data and exported to PDF (section 12).
- Layout is consistent for every organization and carries the organization's name.

### 8.2 Expanded query record

Each query carries these fields, in this order:

| # | Field | Notes |
|---|-------|-------|
| 1 | **Query** | Core query text |
| 2 | **Management Response** | Management's reply to the query |
| 3 | **Risk Rating** | High / Medium / Low (a fixed dropdown is recommended) |
| 4 | **Recommendation** | Auditor's recommendation |
| 5 | **Audit Observation** | Observation that gave rise to the query |
| 6 | **Policy Reference** | Policy title, then the policy content or reference (see open question 3) |
| 7 | **Action Party & Time** | Who must act, and by when |
| 8 | **Notable Numbers** | Key figures tied to the query (amounts, counts, percentages) |

**Requirements**
- Add the missing fields to the data model and to the create, edit and detail views.
- The Word import template and parser map these fields.
- PDF exports include these fields.

---

## 9. CEO Read-Only Overview

> "CEO gets overview of all of this that happens, but can't change."

- Available only to organizations that have the **CEO dashboard** enabled (section 5).
- The CEO sees all fields in 8.2 for every query in their organization.
- Access is **strictly read-only**: no edit, delete, reassign or approve controls, and the server rejects write requests from this role.
- The CEO sees the responsible personnel on each query.
- Comments remain available if agreed in the client meeting (see open question 6).

---

## 10. Query Status Pie Chart With Key

> "All parties in the system: being able to see total of all queries imported via the system, how many have been worked on and not worked on as a pie chart, and how many allocated, with a key explaining the pie chart information."

**Visible to:** all roles within an organization, each seeing only their own organization's data, when the component is enabled (section 5).

**Shows**
- **Total** queries imported
- **Worked on** vs **Not worked on**
- **Allocated** (assigned to a person)

**Requirements**
- Pie chart on the dashboard with a **legend/key** explaining each slice, with count and percentage.
- Total count displayed beside the chart.
- Optional: clicking a slice filters the query list.
- Define categories clearly so the numbers add up (see open question 4).

---

## 11. Assigned Person's Name on the Query

> "After being assigned a query, person's name appears."

- Once assigned, the assignee's **name** shows on the query card, list view and detail page.
- On reassignment the name updates and the history is kept (who, when, by whom) in `query_assignments`.
- The CEO uses this to see responsible personnel.

---

## 12. Download Original Uploaded File

> "Being able to download what was uploaded."

- Store the **original imported Word file** against the import batch or query (on disk, with checksum recorded, per section 3.4).
- Add a **Download original** button for permitted roles within the same organization.
- The stored original is **immutable** after upload.
- Log each download (who and when) in the activity trail.

---

## 13. Import and Export Formats

| Format | Import | Export |
|--------|--------|--------|
| **Word (.docx)** | Yes | No |
| **PDF** | No | Yes |

**Requirements**
- **Import is Word only:** the parser maps the query fields in 8.2 from a Word template.
- **Export is PDF only:** queries and audit reports (8.1) export to PDF.
- Exports respect the existing export-approval flow.
- Exports include the pie chart summary where relevant and are scoped to the user's organization.

---

## 14. Suggested Build Order

1. **SQLite foundation:** configuration, migrations, data-access layer (section 3).
2. **Multi-organization foundation:** organization model, link all records to an organization, server-side scoping (sections 6 and 7). Do this early, because retrofitting isolation later is risky and costly.
3. System Administrator role and institution management (section 4).
4. **Feature selection:** `organization_features`, toggle UI, and server-side enforcement (section 5).
5. Organization sign-up and approval flow (section 6).
6. Query data model: missing fields and assignee name (sections 8.2 and 11).
7. Audit report structure with criteria (section 8.1).
8. Original file storage and download (section 12).
9. Pie chart dashboard (section 10).
10. CEO read-only overview (section 9).
11. Word import and PDF export updates (section 13).
12. Cross-organization isolation and feature-gating tests across all of the above.

---

## 15. Acceptance Checklist

- [ ] Database is SQLite, embedded in the codebase, with WAL, foreign keys and migrations in place
- [ ] Every record belongs to one organization, and cross-organization access is blocked on every endpoint
- [ ] System Administrator can approve, suspend and reactivate organizations
- [ ] System Administrator can choose dashboards, registered numbers and system stats per organization
- [ ] A disabled dashboard or component is hidden in the UI and rejected by the API
- [ ] A role cannot be assigned if its dashboard is disabled for the organization
- [ ] All eight query fields exist in create, edit, detail, import and PDF export
- [ ] CEO cannot change anything
- [ ] Pie chart shows total, worked on, not worked on and allocated, with a key
- [ ] Assignee name and history display correctly
- [ ] Original file can be downloaded and is unchanged
- [ ] Import is Word only and export is PDF only

---

## 16. Open Questions to Confirm

1. **System Administrator access:** Should the System Administrator manage institutions only (recommended), or also view an organization's audit data for support?
2. **Criteria:** Is a criterion a standard or policy the audit is measured against, with queries grouped under it? Or something else?
3. **Policy Reference:** The note was partly crossed out and reads as "title of the policy, then the policy of title". Is this a policy title plus text or clause, or a title and reference number?
4. **Pie chart categories:** Does "worked on / not worked on" mean status-based (for example, has a management response or action) or assignment-based? Is "allocated" a separate pie or an overlap with the other two?
5. **Notable Numbers and Risk Rating:** Is Notable Numbers free text or structured (label and value, with currency)? Does Risk Rating use fixed levels or a client-defined scale?
6. **CEO comments:** Can the CEO still comment while all other data stays read-only?
7. **Sign-up approval:** Must the System Administrator approve each new organization, or is sign-up instant?
8. **"Registered numbers":** Does this mean counts of registered users and records on the dashboard, or something else (for example, registered phone numbers or reference numbers)?
9. **Feature selection scope:** Beyond dashboards, registered numbers and system stats, should the System Administrator also be able to switch off other features (such as exports, comments or file download) per organization?
