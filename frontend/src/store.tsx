// In-browser stand-in for the Django API so the screens can be reviewed before the backend exists.
// Every rule here is also enforced server-side; the UI checks only shape what people are shown.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { appendAudit, type NewAuditEntry } from "./lib/auditChain";
import { REASSIGNABLE, canAssign, isAllowedTransition, isAuditor, isOpen, matchesFilters, queriesFor, reasonError } from "./lib/rules";
import { sha256 } from "./lib/sha256";
import { seed, type State } from "./data/seed";
import type { Query, Role, Status, User } from "./types";
import { ApiStoreProvider } from "./apiStore";
import { fail, ok, StoreCtx, type Result, type Store } from "./storeTypes";

const csvCell = (v: string) => {
  // A leading =, +, - or @ would run as a formula in a spreadsheet, as on the server.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
};

function saveCsv(rows: Query[], userName: (id: string | null) => string) {
  const head = ["reference", "title", "risk", "status", "department", "responsible_officer", "deadline", "assignee"];
  const csv = [head.join(","), ...rows.map((q) => [q.reference, q.title, q.riskRatingCurrent, q.status, q.department, q.responsibleOfficer, q.deadline, q.currentAssignee ? userName(q.currentAssignee) : ""].map(csvCell).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `queries-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export { useMe, useStore } from "./storeTypes";

const LOCK_LIMIT = 5;
const LOCK_MINUTES = 15;

function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(seed);
  const [meId, setMeId] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, { count: number; lockedUntil: number }>>({});

  const me = state.users.find((u) => u.id === meId) ?? null;

  const userName = useCallback(
    (id: string | null) => (id ? state.users.find((u) => u.id === id)?.fullName ?? "Unknown user" : "System"),
    [state.users],
  );

  const entry = (actor: User | null, e: Omit<NewAuditEntry, "actor" | "actorRole">): NewAuditEntry => ({
    actor: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    ...e,
  });

  // Run a change and its audit entries as one unit, mirroring a single DB transaction.
  const commit = (mutate: (s: State) => { next: State; log: NewAuditEntry[] }) =>
    setState((s) => {
      const { next, log } = mutate(s);
      return { ...next, audit: log.reduce(appendAudit, next.audit) };
    });

  const requireRole = (...roles: Role[]): Result => {
    if (!me) return fail("Your session has ended. Sign in again.");
    if (!roles.includes(me.role)) return fail("Your role does not allow this action.");
    return ok;
  };

  // In-app notifications (owner, 2026-10-22): one per person, never to the person who acted.
  const notes = (ids: (string | null | undefined)[], headline: string, queryId: string | null, link?: string) =>
    [...new Set(ids.filter((x): x is string => !!x && x !== me?.id))].map((recipient) => ({
      id: crypto.randomUUID(), recipient, headline, body: "", queryId, link: link ?? (queryId ? `/queries/${queryId}` : ""), readAt: null, createdAt: new Date().toISOString(),
    }));
  const ciaIds = () => state.users.filter((u) => u.role === "CIA" && u.isActive).map((u) => u.id);

  const scopedQuery = (queryId: string): Query | undefined =>
    me ? queriesFor(me, state.queries).find((q) => q.id === queryId) : undefined;

  const store: Store = {
    mode: "demo",
    ready: true,
    state,
    me,
    userName,
    // ICT reads every query while a break-glass grant is open, and none otherwise.
    visibleQueries: !me ? [] : me.role === "ICT" ? (state.accessRequests.some((a) => a.requestedBy === me.id && isOpen(a)) ? state.queries : []) : queriesFor(me, state.queries),
    // The demo organization has every dashboard and widget switched on.
    has: () => true,
    orgRoles: ["IA", "SIA", "PIA", "CIA", "CEO", "ICT"],

    async checkPassword(email, password) {
      const user = state.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      const key = email.trim().toLowerCase();
      const f = failures[key];
      if (f && f.lockedUntil > Date.now()) {
        const mins = Math.ceil((f.lockedUntil - Date.now()) / 60_000);
        return fail(`This account is locked after ${LOCK_LIMIT} failed attempts. Try again in ${mins} minutes or contact ICT.`);
      }
      // Prototype only: any password is accepted for the dummy accounts. The real check is on the server.
      if (!user || !user.isActive || password.length === 0) {
        const count = (f?.count ?? 0) + 1;
        setFailures({ ...failures, [key]: { count, lockedUntil: count >= LOCK_LIMIT ? Date.now() + LOCK_MINUTES * 60_000 : 0 } });
        commit((s) => ({ next: s, log: [entry(null, { action: "auth.login_failed", objectType: "User", objectId: user?.id ?? "unknown", oldValue: null, newValue: { attempt: count }, reason: "" })] }));
        const left = LOCK_LIMIT - count;
        return fail(left > 0 ? `Email or password is incorrect. ${left} attempts left before the account locks.` : `This account is now locked for ${LOCK_MINUTES} minutes.`);
      }
      // Stands in for the one-time PIN the server emails. Random, never stored in the code.
      const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      return { ok: true, userId: user.id, pin };
    },

    async completeMfa(userId, code) {
      if (!/^\d{6}$/.test(code)) return fail("Enter the 6-digit code from the email.");
      const user = state.users.find((u) => u.id === userId)!;
      setFailures({ ...failures, [user.email]: { count: 0, lockedUntil: 0 } });
      setMeId(userId);
      commit((s) => ({ next: s, log: [entry(user, { action: "auth.login", objectType: "User", objectId: user.id, oldValue: null, newValue: { mfa: "email_pin" }, reason: "" })] }));
      return ok;
    },

    async resendPin() {
      // Stands in for a fresh emailed PIN.
      const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      return { ok: true, pin };
    },

    async loadQuery() {},
    async loadComments() {},
    async markRead(id) {
      setState((s) => ({ ...s, notifications: s.notifications.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)) }));
    },
    async markAllRead() {
      const now = new Date().toISOString();
      setState((s) => ({ ...s, notifications: s.notifications.map((n) => (n.recipient === me?.id && !n.readAt ? { ...n, readAt: now } : n)) }));
    },
    evidenceUrl: () => null,
    async uploadImport() {
      return fail("The demo reads files in the browser.");
    },
    async downloadOriginal() {
      return fail("The demo keeps no uploaded files. Connect to the server to download originals.");
    },
    async confirmBatch() {
      return fail("The demo confirms in the browser.");
    },
    async cancelBatch() {
      return fail("The demo cancels in the browser.");
    },
    async verifyOnServer() {
      return null;
    },

    logout(reason = "") {
      if (me) commit((s) => ({ next: s, log: [entry(me, { action: "auth.logout", objectType: "User", objectId: me.id, oldValue: null, newValue: null, reason })] }));
      setMeId(null);
    },

    async confirmImport(filename, fileHash, rows) {
      const r = requireRole("CIA");
      if (!r.ok) return r;
      if (rows.some((x) => x.errors.length)) return fail("Fix the highlighted rows before confirming.");
      const existing = new Set(state.queries.map((q) => q.reference));
      const dup = rows.find((x) => existing.has(x.reference));
      if (dup) return fail(`Reference ${dup.reference} already exists in an earlier batch.`);
      const batchId = crypto.randomUUID();
      const now = new Date().toISOString();
      commit((s) => ({
        next: {
          ...s,
          batches: [{ id: batchId, importedBy: me!.id, sourceFilename: filename, sourceSha256: fileHash, status: "Confirmed", rowCount: rows.length, createdAt: now, confirmedAt: now }, ...s.batches],
          queries: [
            ...s.queries,
            ...rows.map<Query>((x) => ({
              id: crypto.randomUUID(), reference: x.reference, batchId, title: x.title,
              descriptionOriginal: x.description, descriptionCurrent: x.description,
              riskRatingOriginal: x.riskRating as Query["riskRatingOriginal"], riskRatingCurrent: x.riskRating as Query["riskRatingCurrent"],
              status: "Imported", deadline: x.deadline, responsibleOfficer: x.responsibleOfficer, department: x.department,
              currentAssignee: null, closedAt: null,
            })),
          ],
        },
        log: [
          entry(me, { action: "import.upload", objectType: "ImportBatch", objectId: batchId, oldValue: null, newValue: { filename, sha256: fileHash, rows: rows.length }, reason: "" }),
          entry(me, { action: "import.confirm", objectType: "ImportBatch", objectId: batchId, oldValue: { status: "Previewed" }, newValue: { status: "Confirmed", queries: rows.length }, reason: "" }),
        ],
      }));
      return ok;
    },

    cancelImport(filename, fileHash, rowCount) {
      if (!me || me.role !== "CIA") return;
      const batchId = crypto.randomUUID();
      const now = new Date().toISOString();
      commit((s) => ({
        next: { ...s, batches: [{ id: batchId, importedBy: me.id, sourceFilename: filename, sourceSha256: fileHash, status: "Cancelled", rowCount, createdAt: now, confirmedAt: null }, ...s.batches] },
        log: [entry(me, { action: "import.cancel", objectType: "ImportBatch", objectId: batchId, oldValue: { status: "Previewed" }, newValue: { status: "Cancelled" }, reason: "" })],
      }));
    },

    async editQuery(queryId, field, value, reason) {
      const r = requireRole("CIA");
      if (!r.ok) return r;
      if (field === "criterion") return fail("Audit reports and criteria need the server.");
      const err = reasonError(reason);
      if (err) return fail(err);
      const q = scopedQuery(queryId);
      if (!q) return fail("Query not found.");
      const old = String(q[field] ?? "");
      if (old === value.trim()) return fail("The new value is the same as the current one.");
      const now = new Date().toISOString();
      commit((s) => ({
        next: {
          ...s,
          queries: s.queries.map((x) => (x.id === queryId ? { ...x, [field]: value.trim() } : x)),
          revisions: [...s.revisions, { id: crypto.randomUUID(), queryId, field, oldValue: old, newValue: value.trim(), editedBy: me!.id, reason, createdAt: now }],
        },
        log: [entry(me, { action: "query.edit", objectType: "Query", objectId: queryId, oldValue: { [field]: old }, newValue: { [field]: value.trim() }, reason })],
      }));
      return ok;
    },

    async assign(queryId, assigneeId, reason) {
      const r = requireRole("PIA", "CIA");
      if (!r.ok) return r;
      const q = scopedQuery(queryId);
      if (!q) return fail("Query not found.");
      const ia = state.users.find((u) => u.id === assigneeId);
      if (!ia || !canAssign(me!, ia)) return fail("Choose an active Internal Auditor or Senior Internal Auditor.");
      if (q.currentAssignee === assigneeId) return fail(`${ia.fullName} is already assigned.`);
      if (q.status === "Closed") return fail("This query is closed. Reopen it before changing the auditor.");
      if (q.status === "Pending Approval") return fail("A reassignment of this query is waiting for the CIA. Decide it first.");
      const reassign = q.currentAssignee !== null;
      if (reassign) {
        const err = reasonError(reason);
        if (err) return fail(err);
      }
      if (reassign && me!.role === "PIA") {
        // A PIA's reassignment waits for the CIA (owner, 2026-10-22). The current auditor keeps it meanwhile.
        if (q.status === "Proposed for Closure") return fail("This query is proposed for closure. Review the proposal first.");
        if (!REASSIGNABLE.includes(q.status)) return fail(`A query that is ${q.status} cannot be reassigned.`);
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        commit((s) => ({
          next: {
            ...s,
            reassignments: [...s.reassignments, { id, queryId, fromAssignee: q.currentAssignee!, toAssignee: assigneeId, fromStatus: q.status, requestedBy: me!.id, reason, decision: "Pending", decidedBy: null, decisionReason: null, decidedAt: null, createdAt: now }],
            queries: s.queries.map((x) => (x.id === queryId ? { ...x, status: "Pending Approval" } : x)),
            notifications: [...notes(ciaIds(), `${q.reference} reassignment waiting for your approval`, queryId), ...s.notifications],
          },
          log: [
            entry(me, { action: "reassign.request", objectType: "Query", objectId: queryId, oldValue: { assignee: q.currentAssignee }, newValue: { assignee: assigneeId, request: id }, reason }),
            entry(me, { action: "status.change", objectType: "Query", objectId: queryId, oldValue: { status: q.status }, newValue: { status: "Pending Approval" }, reason }),
          ],
        }));
        return ok;
      }
      const log: NewAuditEntry[] = [
        entry(me, { action: reassign ? "query.reassign" : "query.assign", objectType: "Query", objectId: queryId, oldValue: { assignee: q.currentAssignee }, newValue: { assignee: assigneeId }, reason }),
      ];
      let status = q.status;
      if (q.status === "Imported") {
        log.push(entry(me, { action: "status.change", objectType: "Query", objectId: queryId, oldValue: { status: q.status }, newValue: { status: "Assigned" }, reason: "" }));
        status = "Assigned";
      }
      const headline = `${q.reference} ${reassign ? "reassigned" : "assigned"} to you`;
      commit((s) => ({ next: { ...s, queries: s.queries.map((x) => (x.id === queryId ? { ...x, currentAssignee: assigneeId, status } : x)), notifications: [...notes([assigneeId], headline, queryId), ...s.notifications] }, log }));
      return ok;
    },

    async decide(requestId, to, reason) {
      const r = requireRole("PIA", "CIA");
      if (!r.ok) return r;
      const req = state.requests.find((x) => x.id === requestId);
      if (!req || req.decision !== "Pending") return fail("This request has already been decided.");
      if (req.proposedBy === me!.id) return fail("You proposed this change, so someone else must decide it.");
      const approve = to === "Closed";
      if (!approve) {
        const err = reasonError(reason);
        if (err) return fail(err);
      }
      const q = state.queries.find((x) => x.id === req.queryId)!;
      if (!isAllowedTransition(q.status, to, me!.role)) return fail(`Your role cannot move a query from ${q.status} to ${to}.`);
      const now = new Date().toISOString();
      const action = approve ? "status.approve" : to === "Kept in View" ? "status.keep" : "status.reject";
      commit((s) => ({
        next: {
          ...s,
          requests: s.requests.map((x) => (x.id === requestId ? { ...x, decision: approve ? "Approved" : "Rejected", decidedBy: me!.id, decisionReason: reason || null, decidedAt: now, decidedStatus: to } : x)),
          queries: s.queries.map((x) => (x.id === q.id ? { ...x, status: to, closedAt: approve ? now : null } : x)),
          notifications: approve ? s.notifications : [...notes([q.currentAssignee], `${q.reference} ${to === "Returned" ? "returned to you" : "kept in view"}`, q.id), ...s.notifications],
        },
        log: [entry(me, { action, objectType: "Query", objectId: q.id, oldValue: { status: q.status }, newValue: { status: to }, reason })],
      }));
      return ok;
    },

    async decideReassignment(requestId, approve, reason) {
      const r = requireRole("CIA");
      if (!r.ok) return r;
      const req = state.reassignments.find((x) => x.id === requestId);
      if (!req || req.decision !== "Pending") return fail("This request has already been decided.");
      if (req.requestedBy === me!.id) return fail("You asked for this, so someone else must decide it.");
      if (!approve) {
        const err = reasonError(reason);
        if (err) return fail(err);
      }
      const q = state.queries.find((x) => x.id === req.queryId)!;
      const to: Status = approve ? "Assigned" : req.fromStatus;
      const now = new Date().toISOString();
      const log: NewAuditEntry[] = [];
      if (approve) log.push(entry(me, { action: "reassign.approve", objectType: "Query", objectId: q.id, oldValue: { assignee: q.currentAssignee }, newValue: { assignee: req.toAssignee, request: req.id }, reason }));
      log.push(entry(me, { action: approve ? "status.change" : "reassign.reject", objectType: "Query", objectId: q.id, oldValue: { status: q.status }, newValue: { status: to }, reason }));
      commit((s) => ({
        next: {
          ...s,
          reassignments: s.reassignments.map((x) => (x.id === requestId ? { ...x, decision: approve ? "Approved" : "Rejected", decidedBy: me!.id, decisionReason: reason || null, decidedAt: now } : x)),
          queries: s.queries.map((x) => (x.id === q.id ? { ...x, status: to, currentAssignee: approve ? req.toAssignee : x.currentAssignee } : x)),
          notifications: [
            ...notes([req.requestedBy], `${q.reference} reassignment ${approve ? "approved" : "rejected"}`, q.id),
            ...(approve ? notes([req.toAssignee], `${q.reference} reassigned to you`, q.id) : []),
            ...s.notifications,
          ],
        },
        log,
      }));
      return ok;
    },

    async requestExport(filters, reason) {
      const r = requireRole("PIA");
      if (!r.ok) return r;
      const err = reasonError(reason);
      if (err) return fail(err);
      if (state.exports.some((x) => x.requestedBy === me!.id && x.decision === "Pending")) return fail("You already have an export waiting for the CIA.");
      const id = crypto.randomUUID();
      commit((s) => ({
        next: {
          ...s,
          exports: [...s.exports, { id, requestedBy: me!.id, filters, reason, decision: "Pending", decidedBy: null, decisionReason: null, decidedAt: null, downloads: 0, createdAt: new Date().toISOString() }],
          notifications: [...notes(ciaIds(), "Export waiting for your approval", null, "/approvals"), ...s.notifications],
        },
        log: [entry(me, { action: "export.request", objectType: "ExportRequest", objectId: id, oldValue: null, newValue: { filters }, reason })],
      }));
      return ok;
    },

    async decideExport(exportId, approve, reason) {
      const r = requireRole("CIA");
      if (!r.ok) return r;
      const item = state.exports.find((x) => x.id === exportId);
      if (!item || item.decision !== "Pending") return fail("This export has already been decided.");
      if (!approve) {
        const err = reasonError(reason);
        if (err) return fail(err);
      }
      const decision = approve ? "Approved" : "Rejected";
      commit((s) => ({
        next: {
          ...s,
          exports: s.exports.map((x) => (x.id === exportId ? { ...x, decision, decidedBy: me!.id, decisionReason: reason || null, decidedAt: new Date().toISOString() } : x)),
          notifications: [...notes([item.requestedBy], approve ? "Export approved" : "Export rejected", null, "/approvals"), ...s.notifications],
        },
        log: [entry(me, { action: approve ? "export.approve" : "export.reject", objectType: "ExportRequest", objectId: exportId, oldValue: { decision: "Pending" }, newValue: { decision }, reason })],
      }));
      return ok;
    },

    async downloadExport(exportId) {
      const r = requireRole("PIA");
      if (!r.ok) return r;
      const item = state.exports.find((x) => x.id === exportId && x.requestedBy === me!.id);
      if (!item) return fail("Export not found.");
      if (item.decision !== "Approved") return fail("This export has not been approved by the CIA.");
      const rows = state.queries.filter((q) => matchesFilters(q, item.filters));
      saveCsv(rows, userName);
      commit((s) => ({
        next: { ...s, exports: s.exports.map((x) => (x.id === exportId ? { ...x, downloads: x.downloads + 1 } : x)) },
        log: [entry(me, { action: "export.download", objectType: "ExportRequest", objectId: exportId, oldValue: null, newValue: { rows: rows.length, download: item.downloads + 1 }, reason: "" })],
      }));
      return ok;
    },

    async addComment(queryId, body) {
      const r = requireRole("PIA", "CIA", "IA", "SIA", "CEO");
      if (!r.ok) return r;
      // The CEO reaches every query through the summary; everyone else only the queries they can see.
      const q = me!.role === "CEO" ? state.queries.find((x) => x.id === queryId) : scopedQuery(queryId);
      if (!q) return fail("Query not found.");
      if (body.trim().length < 3) return fail("Write the comment before saving.");
      const id = crypto.randomUUID();
      commit((s) => ({
        next: {
          ...s,
          comments: [...s.comments, { id, queryId, author: me!.id, authorRole: me!.role, body: body.trim(), createdAt: new Date().toISOString() }],
          notifications: [...notes([q.currentAssignee], `${q.reference} new comment from the ${me!.role}`, queryId), ...s.notifications],
        },
        log: [entry(me, { action: "comment.add", objectType: "Query", objectId: queryId, oldValue: null, newValue: { comment: id }, reason: "" })],
      }));
      return ok;
    },

    async setStatusDirect(queryId, to, reason) {
      const r = requireRole("CIA");
      if (!r.ok) return r;
      const err = reasonError(reason);
      if (err) return fail(err);
      const q = scopedQuery(queryId);
      if (!q) return fail("Query not found.");
      if (q.status === to) return fail(`The query is already ${to}.`);
      if (q.status === "Pending Approval" || to === "Pending Approval") return fail("Pending Approval belongs to a reassignment request. Decide the request instead.");
      if (to !== "Imported" && to !== "Closed" && !q.currentAssignee) return fail("Assign an auditor first.");
      const now = new Date().toISOString();
      commit((s) => ({
        next: {
          ...s,
          queries: s.queries.map((x) => (x.id === queryId ? { ...x, status: to, closedAt: to === "Closed" ? now : null } : x)),
          // A direct change supersedes any open proposal on this query.
          requests: s.requests.map((x) =>
            x.queryId === queryId && x.decision === "Pending" ? { ...x, decision: "Rejected", decidedBy: me!.id, decisionReason: `Superseded by direct change: ${reason}`, decidedAt: now } : x,
          ),
        },
        log: [entry(me, { action: "status.direct", objectType: "Query", objectId: queryId, oldValue: { status: q.status }, newValue: { status: to }, reason })],
      }));
      return ok;
    },

    async exportQueries(rows, filters, format = "xlsx") {
      if (!me || me.role !== "CIA") return fail("Only the CIA can export without approval. Ask the CIA to approve an export.");
      if (format === "pdf") return fail("PDF reports are made by the server. Connect to it to export PDF.");
      saveCsv(rows, userName);
      commit((s) => ({ next: s, log: [entry(me, { action: "export.queries", objectType: "Query", objectId: "list", oldValue: null, newValue: { rows: rows.length, filters }, reason: "" })] }));
      return ok;
    },

    async decideAccess(requestId, approve, reason) {
      const r = requireRole("CIA");
      if (!r.ok) return r;
      if (!approve) {
        const err = reasonError(reason);
        if (err) return fail(err);
      }
      const req = state.accessRequests.find((x) => x.id === requestId);
      if (!req || req.status !== "Pending") return fail("This request has already been decided.");
      const expiresAt = approve ? new Date(Date.now() + (req.hours ?? 2) * 3_600_000).toISOString() : null;
      commit((s) => ({
        next: { ...s, accessRequests: s.accessRequests.map((x) => (x.id === requestId ? { ...x, status: approve ? "Approved" : "Rejected", decidedBy: me!.id, expiresAt, decisionReason: reason } : x)) },
        log: [entry(me, { action: approve ? "breakglass.approve" : "breakglass.reject", objectType: "AccessRequest", objectId: requestId, oldValue: { status: "Pending" }, newValue: { status: approve ? "Approved" : "Rejected", expiresAt }, reason })],
      }));
      return ok;
    },

    verifyLogged(result) {
      if (!me) return;
      commit((s) => ({ next: s, log: [entry(me, { action: "auditlog.verify", objectType: "AuditLog", objectId: "chain", oldValue: null, newValue: { result }, reason: "" })] }));
    },

    async addActivity(queryId, kind, body) {
      const r = requireRole("PIA", "CIA", "IA", "SIA");
      if (!r.ok) return r;
      const q = scopedQuery(queryId);
      if (!q) return fail("Query not found.");
      if (q.status === "Closed") return fail("This query is closed. Ask the CIA to reopen it.");
      if (body.trim().length < 3) return fail("Write the note before saving.");
      const id = crypto.randomUUID();
      const log: NewAuditEntry[] = [entry(me, { action: kind === "Note" ? "activity.note" : "activity.response", objectType: "FollowUpActivity", objectId: id, oldValue: null, newValue: { queryId }, reason: "" })];
      let status = q.status;
      if (isAuditor(me!.role) && isAllowedTransition(q.status, "In Progress", me!.role)) {
        log.push(entry(me, { action: "status.change", objectType: "Query", objectId: queryId, oldValue: { status: q.status }, newValue: { status: "In Progress" }, reason: "" }));
        status = "In Progress";
      }
      commit((s) => ({
        next: {
          ...s,
          activities: [...s.activities, { id, queryId, author: me!.id, kind, body: body.trim(), createdAt: new Date().toISOString() }],
          queries: s.queries.map((x) => (x.id === queryId ? { ...x, status } : x)),
        },
        log,
      }));
      return ok;
    },

    async addEvidence(queryId, file) {
      const r = requireRole("PIA", "CIA", "IA", "SIA");
      if (!r.ok) return r;
      const q = scopedQuery(queryId);
      if (!q) return fail("Query not found.");
      if (q.status === "Closed") return fail("This query is closed. Ask the CIA to reopen it.");
      const id = crypto.randomUUID();
      const hash = sha256(file.bytes);
      commit((s) => ({
        next: { ...s, evidence: [...s.evidence, { id, queryId, uploadedBy: me!.id, originalFilename: file.name, sha256: hash, sizeBytes: file.size, createdAt: new Date().toISOString() }] },
        log: [entry(me, { action: "evidence.upload", objectType: "Evidence", objectId: id, oldValue: null, newValue: { queryId, filename: file.name, sha256: hash }, reason: "" })],
      }));
      return ok;
    },

    async proposeClosure(queryId, reason) {
      const r = requireRole("IA", "SIA");
      if (!r.ok) return r;
      const err = reasonError(reason);
      if (err) return fail(err);
      const q = scopedQuery(queryId);
      if (!q) return fail("Query not found.");
      if (!isAllowedTransition(q.status, "Proposed for Closure", me!.role)) return fail(`A query that is ${q.status} cannot be proposed for closure.`);
      const hasSupport =
        state.activities.some((a) => a.queryId === queryId && a.kind === "ManagementResponse") || state.evidence.some((e) => e.queryId === queryId);
      if (!hasSupport) return fail("Add a management response or upload evidence before proposing closure.");
      const id = crypto.randomUUID();
      commit((s) => ({
        next: {
          ...s,
          requests: [...s.requests, { id, queryId, fromStatus: q.status, toStatus: "Proposed for Closure", proposedBy: me!.id, proposedReason: reason, decision: "Pending", decidedBy: null, decisionReason: null, decidedAt: null, createdAt: new Date().toISOString() }],
          queries: s.queries.map((x) => (x.id === queryId ? { ...x, status: "Proposed for Closure" } : x)),
        },
        log: [entry(me, { action: "status.propose", objectType: "Query", objectId: queryId, oldValue: { status: q.status }, newValue: { status: "Proposed for Closure" }, reason })],
      }));
      return ok;
    },

    async createUser(u) {
      const r = requireRole("ICT");
      if (!r.ok) return r;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email)) return fail("Enter a valid email address.");
      if (state.users.some((x) => x.email.toLowerCase() === u.email.toLowerCase())) return fail("An account with this email already exists.");
      if (u.fullName.trim().length < 3) return fail("Enter the person's full name.");
      const id = crypto.randomUUID();
      commit((s) => ({
        next: { ...s, users: [...s.users, { id, email: u.email.trim(), fullName: u.fullName.trim(), role: u.role, isActive: true }] },
        log: [entry(me, { action: "user.create", objectType: "User", objectId: id, oldValue: null, newValue: { email: u.email, role: u.role }, reason: "" })],
      }));
      // The demo sends no email; the server mails a one-time link.
      return { ok: true, sentTo: u.email.trim() };
    },

    async sendEnrolment(userId, reason) {
      const r = requireRole("ICT");
      if (!r.ok) return r;
      const err = reasonError(reason);
      if (err) return fail(err);
      const user = state.users.find((x) => x.id === userId);
      if (!user) return fail("User not found.");
      if (userId === me!.id) return fail("You cannot send a link for your own account.");
      commit((s) => ({ next: s, log: [entry(me, { action: "user.enrolment_sent", objectType: "User", objectId: userId, oldValue: null, newValue: null, reason })] }));
      return { ok: true, sentTo: user.email };
    },

    async setActingCia(userId, until, reason) {
      const r = requireRole("ICT");
      if (!r.ok) return r;
      const err = reasonError(reason);
      if (err) return fail(err);
      const user = state.users.find((x) => x.id === userId);
      if (!user || (user.baseRole ?? user.role) !== "PIA") return fail("Only a Principal Internal Auditor can act as CIA.");
      if (until) {
        const end = new Date(until).getTime();
        if (!(end > Date.now())) return fail("Choose an end date in the future.");
        if (end > Date.now() + 90 * 86_400_000) return fail("Acting CIA rights can last up to 90 days.");
      }
      const actingCiaUntil = until ? new Date(until).toISOString() : null;
      commit((s) => ({
        next: { ...s, users: s.users.map((x) => (x.id === userId ? { ...x, baseRole: "PIA", role: until ? "CIA" : "PIA", actingCiaUntil } : x)) },
        log: [entry(me, { action: until ? "user.acting_cia_grant" : "user.acting_cia_end", objectType: "User", objectId: userId, oldValue: { actingCiaUntil: user.actingCiaUntil ?? null }, newValue: { actingCiaUntil }, reason })],
      }));
      return ok;
    },

    async setUserActive(userId, active, reason) {
      const r = requireRole("ICT");
      if (!r.ok) return r;
      const err = reasonError(reason);
      if (err) return fail(err);
      if (userId === me!.id) return fail("You cannot disable your own account.");
      commit((s) => ({
        next: { ...s, users: s.users.map((x) => (x.id === userId ? { ...x, isActive: active } : x)) },
        log: [entry(me, { action: active ? "user.enable" : "user.disable", objectType: "User", objectId: userId, oldValue: { isActive: !active }, newValue: { isActive: active }, reason })],
      }));
      return ok;
    },


    async requestAccess(reason, hours = 2) {
      const r = requireRole("ICT");
      if (!r.ok) return r;
      const err = reasonError(reason);
      if (err) return fail(err);
      if (state.accessRequests.some((x) => x.requestedBy === me!.id && (x.status === "Pending" || (x.status === "Approved" && x.expiresAt && Date.parse(x.expiresAt) > Date.now()))))
        return fail("You already have a request waiting or access in use.");
      const id = crypto.randomUUID();
      commit((s) => ({
        next: {
          ...s,
          accessRequests: [{ id, requestedBy: me!.id, reason, status: "Pending", decidedBy: null, expiresAt: null, createdAt: new Date().toISOString(), hours, reads: 0 }, ...s.accessRequests],
          notifications: [...notes(ciaIds(), "Break-glass access waiting for your decision", null, "/approvals"), ...s.notifications],
        },
        log: [entry(me, { action: "breakglass.request", objectType: "AccessRequest", objectId: id, oldValue: null, newValue: { status: "Pending", hours }, reason })],
      }));
      return ok;
    },

    async endAccess(requestId) {
      const r = requireRole("ICT", "CIA");
      if (!r.ok) return r;
      const req = state.accessRequests.find((x) => x.id === requestId);
      if (!req || req.status !== "Approved") return fail("This access is not in use.");
      const now = new Date().toISOString();
      commit((s) => ({
        next: { ...s, accessRequests: s.accessRequests.map((x) => (x.id === requestId ? { ...x, status: "Ended", endedAt: now, expiresAt: now } : x)) },
        log: [entry(me, { action: "breakglass.end", objectType: "AccessRequest", objectId: requestId, oldValue: { status: "Approved" }, newValue: { status: "Ended" }, reason: "" })],
      }));
      return ok;
    },

    async refresh() {},
  };

  const value = useMemo(() => store, [state, meId, failures]); // eslint-disable-line react-hooks/exhaustive-deps
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

// VITE_DATA_SOURCE=api talks to the Django API; otherwise the in-browser demo runs.
export const DATA_SOURCE = import.meta.env.VITE_DATA_SOURCE === "api" ? "api" : "demo";

export function StoreProvider({ children }: { children: ReactNode }) {
  return DATA_SOURCE === "api" ? <ApiStoreProvider>{children}</ApiStoreProvider> : <DemoStoreProvider>{children}</DemoStoreProvider>;
}
