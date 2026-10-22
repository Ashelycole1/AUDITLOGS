# system.md: AuditLogs System Context and Rules

Read this file first. It is the single source of truth for what AuditLogs is and the rules no code may break. If any other file or instruction conflicts with this one, this file wins, and the conflict must be raised with the human owner.

## 1. What the system is

AuditLogs tracks audit queries from the moment they are finalised until they are resolved and closed, for an internal audit function in Uganda. Final queries are imported once, assigned to auditors, followed up with evidence, and closed only after independent approval. Every action is written to a tamper-evident log.

Goals, in priority order: **secure, correct permissions, simple, cheap to run, easy to explain.** When in doubt, choose the simpler option.

## 2. Glossary

| Term | Meaning |
|---|---|
| Query | One final audit finding to be followed up until closed |
| PIA | Principal Internal Auditor. Assigns queries to IA and SIA, reviews proposals, requests exports |
| CIA | Chief Internal Auditor. Process owner and final authority; imports, edits, reassigns, approves |
| SIA | Senior Internal Auditor. Ranked above IA; does follow-up on assigned queries only |
| IA | Internal Auditor. Does follow-up on assigned queries only |
| CEO | Top executive. Read-only oversight |
| ICT | System administrator. Accounts, hosting, backups. No rights over findings |
| DPO | Data protection officer |
| PDPO | Personal Data Protection Office (Uganda) |
| DPIA | Data protection impact assessment |

## 3. Roles (identical everywhere in the project)

The audit chain, lowest rank first: **IA < SIA < PIA < CIA** (owner, 2026-10-22). Work flows up the chain; assignment flows down it (a role assigns only to auditors ranked below it); anything needing approval goes to the CIA. CEO and ICT sit outside the chain.

| Role | Sees | Does | Never |
|---|---|---|---|
| CIA | Everything, incl. history | Import and confirm final queries, edit queries and ratings, assign and reassign, approve or reject closures, reassignments and exports, return or keep proposals in view, export directly, comment | Be exempt from the CIA Activity view |
| PIA | All queries and progress | Assign IA or SIA, request reassignment (CIA approves), return a closure proposal or keep it in view, add follow-up, evidence and comments, request an export (CIA approves) | Import, close a query, export without approval, edit query fields |
| SIA | Only own assigned queries, with responses and evidence | Record work, evidence and comments, propose status changes. Further permissions to be agreed with the client | See others' queries, assign, approve |
| IA | Only own assigned queries, with responses and evidence | Record work, evidence and comments, propose status changes | See others' queries, edit ratings or assignments, approve own change |
| CEO | Summary with responsible personnel (see design.md section 6) | Monitor, comment on queries and CIA activity | Edit or approve anything |
| ICT | System settings and operational data | Create and disable accounts, backups, recovery | Edit findings, approve statuses, view audit content without approved, logged, time-limited access |

## 4. Non-negotiable rules

These are hard requirements. Any code that violates one is a bug.

1. **Server-side authorisation on every request.** Hiding a button is not security. IA scoping is enforced in the database query (queryset filter), never only in the UI.
2. **Original query wording is immutable.** It is stored separately and never overwritten. Every edit creates a revision with old value, new value, editor and reason.
3. **No self-approval.** The user who proposed a status change can never be the user who decides it. Only the CIA can move a query to Closed.
4. **Every change is audit-logged** with actor, time, action, object, old value, new value and reason, in the hash-chained log.
5. **The audit log is append-only.** No application code path updates or deletes a row. The database enforces this.
6. **Data stays in Uganda.** Production hosting, storage and backups are in Uganda. No real audit data is ever sent to a foreign service: no external error tracking, analytics, email, storage, or AI services.
7. **No hard deletes** by ordinary users. Disposal follows retention rules, is approved, and is logged.
8. **MFA is mandatory** for all users. Passwords are hashed with Argon2. Sessions time out. Accounts lock after repeated failures.
9. **Exports are restricted and logged.**
10. **Development uses dummy data only.** Real data never enters dev, test, or CI environments.

## 5. Locked technology decisions

| Layer | Choice |
|---|---|
| Backend | Python, Django, Django REST Framework |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Database | PostgreSQL |
| Auth | Django auth, Argon2, django-otp (one-time PIN by email through the client SMTP server, owner decision 2026-10-16), django-axes (lockout) |
| Import | openpyxl or pandas (Excel/CSV). PDF/Word only as a fallback |
| Files | Encrypted files on the server's disk |
| Email | Client's own SMTP server |
| Deployment | Docker Compose on one Linux server in Uganda, Nginx with HTTPS |
| Tests | pytest (backend), Playwright (end-to-end) |

Do not add dependencies, services or paid tools without written approval from the human owner. Prefer the Django standard library and built-ins.

## 6. Status model

Imported, Assigned, In Progress, Proposed for Closure, Pending Approval, Kept in View, Returned, Closed. Allowed transitions are defined only in design.md section 5. Code must reject any other transition.

## 7. Conventions

- Language: Python 3.12, TypeScript strict mode. Type hints on all Python functions.
- Style: ruff + black (Python), ESLint + Prettier (TypeScript).
- Time: store UTC, display Africa/Kampala.
- IDs: UUID primary keys.
- Naming: models in singular PascalCase, API routes in plural kebab-case.
- Secrets: environment variables only. Never commit secrets.
- Errors: never leak stack traces or other users' data in responses.
- Commits: small, one concern each, message format `type(scope): summary`.
- Every feature ships with tests. Every permission rule ships with a test per role.

## 8. Success criteria

- Every imported query has a named assigned auditor.
- No query closes without CIA approval.
- Every change is in the log with a reason, and the nightly chain check passes.
- Automated tests prove an IA cannot read or change any query not assigned to them.
- The CEO sees all outstanding work with no edit rights.
- All data and backups are confirmed in Uganda by ICT.

## 9. Open items (do not guess; ask the owner)

- Is the organisation a public body?
- Retention periods per record type.
- PDPO registration status and DPO name.
- Final production host.
- Sample import files and formats.
- Final scope of the CEO's visible details.
- From the 2026-10-22 change notes (auditlogs-required-changes.md section 9): SIA permissions beyond working assigned queries; when to switch notifications to email, and whether the department owner should be notified (they have no account). Left out for now at the owner's request: "SRA" and the CEO's third (blank) bullet. Answered: the CIA may also keep a proposal in view; follow-up, evidence and comments are added by IA, SIA, PIA and CIA; notifications are in-app for now.

## 10. Related files

- `design.md`: product behaviour, screens, data fields, rules.
- `architecture.md`: components, structure, deployment, security.
- `agent_workflow.md`: how AI agents build and review the system.
