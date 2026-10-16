# agent_workflow.md: How AI Agents Build and Review AuditLogs

Rules for AI coding agents (such as Claude Code) and the humans supervising them. Always read `system.md`, `design.md` and `architecture.md` before starting any task.

## 1. Operating principles

1. **Specs are the source of truth.** If code and the specs disagree, stop and ask. Do not silently change the spec.
2. **Small steps.** One task, one branch, one pull request. Each ends in a green test run.
3. **Test the permissions first.** Write the role-by-endpoint tests before or with the endpoint.
4. **Never guess an open item.** The open items in `system.md` section 9 need a human answer.
5. **Security over speed.** If a shortcut weakens a rule in `system.md` section 4, do not take it.
6. **Dummy data only.** Never ask for, paste, or use real audit data in prompts, fixtures, logs or tests.

## 2. Agent roles

Use one agent session per role, each with a clear scope. One agent may play several roles in small projects, but never review its own work in the same session.

| Agent | Responsibility | Output |
|---|---|---|
| Planner | Breaks a phase into small tasks with acceptance criteria | Task list in `tasks/` |
| Builder | Implements one task with tests | Branch and pull request |
| Tester | Writes extra tests and edge cases, tries to break permissions | Failing-test report or added tests |
| Reviewer | Reviews the diff against specs and rules | Approve or list of required changes |
| Security reviewer | Checks auth, scoping, logging, data residency, dependencies | Security checklist result |
| Docs | Keeps specs, runbook and README current | Doc updates |

A human owner approves every merge to main and every production deployment.

## 3. The task loop

For every task:

1. **Read:** the task, the relevant spec sections, existing code.
2. **Plan:** write a short plan (files to change, tests to add). Share it before large changes.
3. **Test first:** add failing tests, including a permission test per role where relevant.
4. **Implement:** the smallest change that passes.
5. **Check:** run lint, type checks, full tests.
6. **Self-check:** walk the Definition of Done below.
7. **Open a pull request:** describe what changed, what was tested, any spec questions.
8. **Review:** a separate Reviewer session checks it. Fix findings, repeat.
9. **Merge:** only after human approval.

## 4. Definition of done

A task is done only when all are true:

- [ ] Behaviour matches `design.md`; no unrequested features.
- [ ] Authorisation enforced on the server; IA scoping uses `for_user`.
- [ ] Permission tests cover every role (allowed and denied).
- [ ] Every state change writes an audit entry with a reason where required.
- [ ] No hard delete, no direct status assignment outside the workflow service.
- [ ] No new dependency without approval; no foreign service calls.
- [ ] Input validated; errors do not leak data.
- [ ] Lint, type check and all tests pass.
- [ ] Docs and `.env.example` updated if behaviour or config changed.
- [ ] Migrations are reversible or backward compatible.

## 5. Build plan for agents (maps to the 14-week plan)

### Phase 1: Requirements and setup (weeks 1-2)
- Confirm open items with the human owner; record answers in `system.md`.
- Create repo, Docker Compose (dev), CI, lint, pre-commit hooks.
- Generate dummy data fixtures (fake names, fake queries).
- Done when: dev environment starts with one command and CI is green.

### Phase 2: Foundation (weeks 3-5)
1. Users, roles, Argon2, MFA, lockout, session timeout.
2. Permission framework: role classes, `for_user` scoping, default deny, permission test matrix harness.
3. Audit log: model, DB trigger and role grants, hash chain writer, verifier command, tamper test.
4. Import: upload, parsing, validation, preview, confirm, cancel.
- Done when: login with MFA works, an import can be confirmed, the chain verifies, and tamper test fails verification as expected.

### Phase 3: Core workflow (weeks 6-9)
1. Query list and detail, revisions, preserved original.
2. Assignment and reassignment.
3. Follow-up activities and encrypted evidence upload and download.
4. Workflow service and status change requests; approve and reject; no self-approval.
5. Direct CIA changes with reasons.
- Done when: an end-to-end test goes from import to Closed, and IA isolation tests pass.

### Phase 4: Oversight and compliance (weeks 10-11)
1. Dashboard and overdue views; CEO details per `design.md`.
2. CIA Activity view.
3. Email notifications.
4. Retention rules, disposal approval, breach register and alerts, subject search and export, break-glass access.
- Done when: CEO account cannot change anything and all exports are logged.

### Phase 5: Hardening and launch (weeks 12-14)
1. Full permission matrix review and fixes.
2. Security review: headers, CSP, dependency audit, secrets, production start-up checks.
3. Backup and restore scripts, tested restore, runbook.
4. Deploy to the Uganda server, smoke test, user acceptance, training material.
- Done when: legal sign-off, PDPO registration and DPIA confirmed by humans; ICT confirms data and backups are in Uganda.

## 6. Prompt templates

### Builder
```
Read system.md, design.md, architecture.md.
Task: <one task with acceptance criteria>.
Rules: follow the Definition of Done in agent_workflow.md.
First write a short plan and the failing tests (including a test per role).
Then implement. Do not add dependencies or change specs without asking.
```

### Reviewer
```
You are a reviewer, not the author. Read system.md section 4 and the diff.
Check: server-side authorisation, IA scoping, audit entries, reasons,
no self-approval, no foreign services, tests per role, spec match.
List blocking issues, then non-blocking suggestions. Do not edit code.
```

### Tester (adversarial)
```
Try to break the permission rules. For each role, attempt every endpoint
with another user's IDs, missing fields, replayed requests and state changes
out of order. Add failing tests for anything that succeeds wrongly.
```

### Security reviewer
```
Review the change for: broken access control, injection, unsafe file
handling, secrets in code, logging of personal data, calls to external hosts,
weak session or MFA handling, and audit log bypass paths.
```

## 7. Guardrails for agents

**Always:**
- Use the workflow service for status changes.
- Write audit entries in the same transaction as the change.
- Run the permission test matrix before opening a pull request.
- Ask when a requirement is ambiguous.

**Never:**
- Disable, weaken or skip a test to make it pass.
- Add `UPDATE`, `DELETE` or `TRUNCATE` paths for the audit log.
- Return other users' data, even in error messages.
- Call external APIs, CDNs, analytics, error trackers or AI services with real data.
- Commit secrets, real data, or production hostnames.
- Merge or deploy without human approval.
- Expand scope ("while I'm here" features).

## 8. Escalation: stop and ask a human when

- A spec conflicts with another spec or with the law as understood.
- A change would alter roles, permissions, statuses or the audit log design.
- An open item in `system.md` section 9 blocks the work.
- A security finding cannot be fixed within the current design.
- Tests fail for reasons you cannot explain.

## 9. Review gates

| Gate | Who | When |
|---|---|---|
| Pull request review | Reviewer agent + human | Every PR |
| Permission matrix check | Tester agent | End of each phase |
| Security review | Security reviewer + human | End of phases 2, 3, 5 |
| Legal and compliance sign-off | Human (counsel, DPO) | Before go-live |
| User acceptance | CIA, PIA, IA sample, ICT | Phase 5 |
| Production deployment | Human owner and ICT | Launch and each release |

## 10. Session hygiene

- Start each session by reading the four spec files and the current task.
- Keep a `PROGRESS.md` with what is done, what is next, and open questions. Update it at the end of every session.
- Record decisions in a `DECISIONS.md` (date, decision, reason). Do not bury decisions in chat.
- Keep tasks small enough to finish in one session; split larger ones.

## 11. Definition of ready for launch

- All success criteria in `system.md` section 8 pass.
- Permission matrix tests green; tamper test green; restore test done.
- PDPO registration, DPO, DPIA and retention rules confirmed by humans.
- Production in Uganda confirmed by ICT; no external services configured.
- Users trained; runbook handed to ICT.
