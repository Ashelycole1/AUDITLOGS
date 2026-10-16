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

### Not done
- Nothing is committed yet. The repo has no commits on `main`.
- No backend, Docker Compose, CI, or tests.
- The prototype doesn't use TanStack Query or an API client yet. It will need these when the backend exists.
- `DECISIONS.md` hasn't been created.

### In flight
- 2026-10-16: the prototype was started locally (`npm run dev` at http://localhost:5173) for the owner to review. Claude Code then stopped the server because the machine ran low on memory, so it needs restarting before the review. **Waiting for the owner's feedback before going further.**

### Next (proposed, awaiting owner go-ahead)
1. Make the first commit of the specs and the prototype.
2. Phase 1 setup: `backend/` Django skeleton (config with base/dev/prod settings, `apps/` stubs), `docker-compose.dev.yml` (db, api), `.env.example`, ruff/black, pytest, and dummy fixtures.
3. Phase 2.1: users, roles, Argon2, MFA, lockout, session timeout, with permission tests per role.

### Open questions (system.md section 9, still unanswered)
- Is the organisation a public body?
- What are the retention periods per record type?
- What is the PDPO registration status, and who is the DPO?
- What is the final production host?
- Can we get sample import files and formats?
- What is the final scope of the CEO's visible details?
