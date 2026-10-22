// The real store: every read and change goes to the Django API, which enforces every rule.
// It keeps the same State shape as the demo so the screens stay the same. After each change it
// reloads what changed, so the screen always shows what the server holds.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, getAll } from "./api";
import type { State } from "./data/seed";
import { fail, ok, StoreCtx, type Result, type ServerPreview, type Store } from "./storeTypes";
import type {
  AuditEntry,
  Comment,
  EditableField,
  Evidence,
  ExportFilters,
  ExportRequest,
  FollowUpActivity,
  ImportBatch,
  ImportRow,
  Query,
  QueryRevision,
  ReassignmentRequest,
  Role,
  Status,
  StatusChangeRequest,
  User,
} from "./types";

/* Server shapes (snake_case) */
type Raw = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v));

const EMPTY: State = { users: [], batches: [], queries: [], revisions: [], activities: [], evidence: [], requests: [], reassignments: [], exports: [], comments: [], accessRequests: [], audit: [] };

const toQuery = (q: Raw): Query => ({
  id: str(q.id),
  reference: str(q.reference),
  batchId: str(q.batch),
  title: str(q.title),
  descriptionOriginal: str(q.description_original),
  descriptionCurrent: str(q.description_current),
  riskRatingOriginal: (q.risk_rating_original ?? q.risk_rating_current) as Query["riskRatingOriginal"],
  riskRatingCurrent: q.risk_rating_current as Query["riskRatingCurrent"],
  status: q.status as Status,
  deadline: str(q.deadline),
  responsibleOfficer: str(q.responsible_officer),
  department: str(q.department),
  currentAssignee: strOrNull(q.current_assignee),
  assigneeRole: (q.assignee_role ?? null) as Role | null,
  closedAt: strOrNull(q.closed_at),
  importedAt: strOrNull(q.imported_at),
  batchFilename: q.batch_filename ? str(q.batch_filename) : undefined,
});

const toRequest = (r: Raw, queryId?: string): StatusChangeRequest => ({
  id: str(r.id),
  queryId: queryId ?? str(r.query),
  fromStatus: (r.from_status ?? "In Progress") as Status,
  toStatus: (r.to_status ?? "Proposed for Closure") as Status,
  proposedBy: str(r.proposed_by),
  proposedReason: str(r.proposed_reason),
  decision: r.decision as StatusChangeRequest["decision"],
  decidedBy: strOrNull(r.decided_by),
  decisionReason: strOrNull(r.decision_reason),
  decidedAt: strOrNull(r.decided_at),
  decidedStatus: (r.decided_status ?? null) as Status | null,
  createdAt: str(r.created_at),
  responses: typeof r.responses === "number" ? r.responses : undefined,
  evidenceFiles: typeof r.evidence_files === "number" ? r.evidence_files : undefined,
});

const toReassignment = (r: Raw, queryId?: string): ReassignmentRequest => ({
  id: str(r.id),
  queryId: queryId ?? str(r.query),
  fromAssignee: str(r.from_assignee),
  toAssignee: str(r.to_assignee),
  fromStatus: r.from_status as Status,
  requestedBy: str(r.requested_by),
  reason: str(r.reason),
  decision: (r.decision ?? "Pending") as ReassignmentRequest["decision"],
  decidedBy: strOrNull(r.decided_by),
  decisionReason: strOrNull(r.decision_reason),
  decidedAt: strOrNull(r.decided_at),
  createdAt: str(r.created_at),
});

const toExport = (r: Raw): ExportRequest => ({
  id: str(r.id),
  requestedBy: str(r.requested_by),
  filters: (r.filters ?? {}) as ExportFilters,
  reason: str(r.reason),
  decision: r.decision as ExportRequest["decision"],
  decidedBy: strOrNull(r.decided_by),
  decisionReason: strOrNull(r.decision_reason),
  decidedAt: strOrNull(r.decided_at),
  downloads: Number(r.downloads ?? 0),
  createdAt: str(r.created_at),
});

const toComment = (c: Raw, queryId: string): Comment => ({
  id: str(c.id),
  queryId,
  author: str(c.author),
  authorRole: c.author_role as Role,
  body: str(c.body),
  createdAt: str(c.created_at),
});

const csvName = () => `queries-${new Date().toISOString().slice(0, 10)}.csv`;

const toAudit = (e: Raw, fallbackObject?: { type: string; id: string }): AuditEntry => ({
  seq: Number(e.seq),
  timestamp: str(e.timestamp),
  actor: strOrNull(e.actor),
  actorRole: (e.actor_role ?? null) as Role | null,
  action: str(e.action),
  objectType: str(e.object_type ?? fallbackObject?.type),
  objectId: str(e.object_id ?? fallbackObject?.id),
  oldValue: e.old_value ?? null,
  newValue: e.new_value ?? null,
  reason: str(e.reason),
  prevHash: str(e.prev_hash),
  entryHash: str(e.entry_hash),
});

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const toImportRow = (r: Raw): ImportRow => {
  const d = (r.data ?? {}) as Raw;
  return {
    line: Number(r.line),
    reference: str(d.reference),
    title: str(d.title),
    description: str(d.description),
    riskRating: str(d.risk_rating),
    deadline: str(d.deadline),
    responsibleOfficer: str(d.responsible_officer),
    department: str(d.department),
    errors: (r.errors as string[]) ?? [],
    warnings: (r.warnings as string[]) ?? [],
  };
};

const toUser = (u: Raw): User => ({
  id: str(u.id),
  email: str(u.email),
  fullName: str(u.full_name),
  role: (u.effective_role ?? u.role) as Role,
  isActive: u.is_active !== false,
});

function bySeq(a: AuditEntry[], b: AuditEntry[]): AuditEntry[] {
  const m = new Map<number, AuditEntry>();
  for (const e of [...a, ...b]) m.set(e.seq, e);
  return [...m.values()].sort((x, y) => x.seq - y.seq);
}

function byId<T extends { id: string }>(keep: T[], incoming: T[]): T[] {
  const m = new Map(keep.map((x) => [x.id, x]));
  for (const x of incoming) m.set(x.id, x);
  return [...m.values()];
}

async function attempt(run: () => Promise<unknown>): Promise<Result> {
  try {
    await run();
    return ok;
  } catch (e) {
    return fail(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
  }
}

export function ApiStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(EMPTY);
  const [me, setMe] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  // Names seen in any payload, so userName works for people outside the lists this role may load.
  const names = useRef(new Map<string, string>());
  const remember = (id: unknown, name: unknown) => {
    if (id && name) names.current.set(String(id), String(name));
  };

  const load = useCallback(async (who: User) => {
    const role = who.role;
    const next: State = { ...EMPTY, users: [who] };
    const jobs: Promise<void>[] = [];

    if (role === "PIA" || role === "CIA" || role === "IA" || role === "SIA") {
      jobs.push(
        getAll<Raw>("/queries").then((rows) => {
          rows.forEach((q) => remember(q.current_assignee, q.assignee_name));
          next.queries = rows.map(toQuery);
        }),
      );
    }
    if (role === "PIA" || role === "CIA") {
      // Closure proposals to review, reassignment and export requests, and the auditors to assign.
      jobs.push(
        getAll<Raw>("/status-requests").then((rows) => {
          rows.forEach((r) => {
            remember(r.proposed_by, r.proposed_by_name);
            remember(r.decided_by, r.decided_by_name);
          });
          next.requests = rows.map((r) => toRequest(r));
        }),
        getAll<Raw>("/reassignment-requests").then((rows) => {
          rows.forEach((r) => {
            remember(r.from_assignee, r.from_assignee_name);
            remember(r.to_assignee, r.to_assignee_name);
            remember(r.requested_by, r.requested_by_name);
            remember(r.decided_by, r.decided_by_name);
          });
          next.reassignments = rows.map((r) => toReassignment(r));
        }),
        getAll<Raw>("/export-requests").then((rows) => {
          rows.forEach((r) => {
            remember(r.requested_by, r.requested_by_name);
            remember(r.decided_by, r.decided_by_name);
          });
          next.exports = rows.map(toExport);
        }),
        api.get<Raw[]>("/auditors").then((rows) => {
          rows.forEach((u) => remember(u.id, u.full_name));
          next.users = [who, ...rows.map<User>((u) => ({ id: str(u.id), email: "", fullName: str(u.full_name), role: (u.role ?? "IA") as Role, isActive: true }))];
        }),
      );
    }
    if (role === "CIA") {
      jobs.push(
        api.get<Raw[]>("/imports").then((rows) => {
          rows.forEach((b) => remember(b.imported_by, b.imported_by_name));
          next.batches = rows.map<ImportBatch>((b) => ({
            id: str(b.id),
            importedBy: str(b.imported_by),
            sourceFilename: str(b.source_filename),
            sourceSha256: str(b.source_sha256),
            status: b.status as ImportBatch["status"],
            rowCount: Number(b.row_count),
            createdAt: str(b.created_at),
            confirmedAt: strOrNull(b.confirmed_at),
          }));
        }),
      );
    }
    if (role === "CIA") {
      jobs.push(
        getAll<Raw>("/audit-log").then((rows) => {
          rows.forEach((e) => remember(e.actor, e.actor_name));
          next.audit = rows.map((e) => toAudit(e)).sort((a, b) => a.seq - b.seq);
        }),
      );
    }
    if (role === "CEO") {
      jobs.push(
        api.get<Raw[]>("/dashboard/queries").then((rows) => {
          rows.forEach((q) => remember(q.current_assignee, q.assignee_name));
          next.queries = rows.map(toQuery);
        }),
        api.get<Raw[]>("/dashboard/cia-activity").then((rows) => {
          rows.forEach((e) => remember(e.actor, e.actor_name));
          next.audit = rows.map((e) => toAudit({ ...e, actor_role: "CIA" }, { type: "Query", id: str(e.object_id) })).sort((a, b) => a.seq - b.seq);
        }),
      );
    }
    if (role === "ICT") {
      jobs.push(
        api.get<Raw[]>("/users").then((rows) => {
          next.users = rows.map(toUser);
        }),
      );
    }
    await Promise.all(jobs);
    for (const u of next.users) remember(u.id, u.fullName);
    const listsRequests = role === "PIA" || role === "CIA";
    setState((s) => ({
      ...next,
      revisions: s.revisions,
      activities: s.activities,
      evidence: s.evidence,
      comments: s.comments,
      audit: bySeq(role === "CIA" || role === "CEO" ? [] : s.audit, next.audit),
      requests: byId(listsRequests ? [] : s.requests, next.requests),
      reassignments: byId(listsRequests ? [] : s.reassignments, next.reassignments),
    }));
  }, []);

  const loadQuery = useCallback(async (queryId: string) => {
    const base = `/queries/${queryId}`;
    const [detail, activities, evidence, revisions, history, comments] = await Promise.all([
      api.get<Raw>(base),
      api.get<Raw[]>(`${base}/activities`),
      api.get<Raw[]>(`${base}/evidence`),
      api.get<Raw[]>(`${base}/revisions`),
      api.get<Raw[]>(`${base}/history`),
      api.get<Raw[]>(`${base}/comments`),
    ]);
    comments.forEach((c) => remember(c.author, c.author_name));
    const pendingMove = detail.pending_reassignment as Raw | null;
    if (pendingMove) {
      remember(pendingMove.requested_by, pendingMove.requested_by_name);
      remember(pendingMove.to_assignee, pendingMove.to_assignee_name);
    }
    remember(detail.current_assignee, detail.assignee_name);
    activities.forEach((a) => remember(a.author, a.author_name));
    evidence.forEach((e) => remember(e.uploaded_by, e.uploaded_by_name));
    revisions.forEach((r) => remember(r.edited_by, r.edited_by_name));
    history.forEach((h) => remember(h.actor, h.actor_name));
    const requests = [detail.pending_request, detail.last_decision]
      .filter(Boolean)
      .map((r) => {
        remember((r as Raw).proposed_by, (r as Raw).proposed_by_name);
        remember((r as Raw).decided_by, (r as Raw).decided_by_name);
        return toRequest(r as Raw, queryId);
      });
    setState((s) => ({
      ...s,
      queries: byId(s.queries, [toQuery(detail)]),
      activities: [
        ...s.activities.filter((a) => a.queryId !== queryId),
        ...activities.map<FollowUpActivity>((a) => ({ id: str(a.id), queryId, author: str(a.author), kind: a.kind as FollowUpActivity["kind"], body: str(a.body), createdAt: str(a.created_at) })),
      ],
      evidence: [
        ...s.evidence.filter((e) => e.queryId !== queryId),
        ...evidence.map<Evidence>((e) => ({ id: str(e.id), queryId, uploadedBy: str(e.uploaded_by), originalFilename: str(e.original_filename), sha256: str(e.sha256), sizeBytes: Number(e.size_bytes), createdAt: str(e.created_at) })),
      ],
      revisions: [
        ...s.revisions.filter((r) => r.queryId !== queryId),
        ...revisions.map<QueryRevision>((r) => ({ id: str(r.id), queryId, field: camel(str(r.field)) as EditableField, oldValue: str(r.old_value), newValue: str(r.new_value), editedBy: str(r.edited_by), reason: str(r.reason), createdAt: str(r.created_at) })),
      ],
      requests: byId(s.requests, requests),
      reassignments: pendingMove
        ? byId(s.reassignments, [toReassignment({ ...pendingMove, from_assignee: detail.current_assignee, decision: "Pending" }, queryId)])
        : s.reassignments,
      comments: [...s.comments.filter((c) => c.queryId !== queryId), ...comments.map((c) => toComment(c, queryId))],
      audit: bySeq(s.audit, history.map((h) => toAudit(h, { type: "Query", id: queryId }))),
    }));
  }, []);

  const loadComments = useCallback(async (queryId: string) => {
    const rows = await api.get<Raw[]>(`/queries/${queryId}/comments`);
    rows.forEach((c) => remember(c.author, c.author_name));
    setState((s) => ({ ...s, comments: [...s.comments.filter((c) => c.queryId !== queryId), ...rows.map((c) => toComment(c, queryId))] }));
  }, []);

  // Restore an existing session on page load.
  useEffect(() => {
    api
      .get<Raw>("/auth/me")
      .then(async (raw) => {
        const who = toUser(raw);
        setMe(who);
        await load(who);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [load]);

  const refresh = useCallback(async (queryId?: string) => {
    if (!me) return;
    await Promise.all([load(me), queryId ? loadQuery(queryId) : Promise.resolve()]);
  }, [me, load, loadQuery]);

  const change = (run: () => Promise<unknown>, queryId?: string) =>
    attempt(async () => {
      await run();
      await refresh(queryId);
    });

  const notYet = (what: string) => Promise.resolve(fail(`${what} is not connected to the server yet. It arrives with Phase 4.`));

  const store: Store = {
    mode: "api",
    ready,
    state,
    me,
    userName: (id) => (id ? names.current.get(id) ?? state.users.find((u) => u.id === id)?.fullName ?? "Unknown user" : "System"),
    // The server has already scoped these to the person signed in.
    visibleQueries: state.queries,

    async checkPassword(email, password) {
      try {
        const r = await api.post<{ mfa?: string; sent_to?: string } & Raw>("/auth/login", { email, password });
        if (!r.mfa) {
          // MFA paused on the server (staging only): the password step has already signed in.
          const who = toUser(r);
          setMe(who);
          await load(who);
          return { ok: true, signedIn: true };
        }
        return { ok: true, userId: "pending", sentTo: r.sent_to };
      } catch (e) {
        return fail(e instanceof ApiError ? e.message : "Sign-in failed.");
      }
    },
    async completeMfa(_userId, code) {
      try {
        const who = toUser(await api.post<Raw>("/auth/mfa", { code }));
        setMe(who);
        await load(who);
        return ok;
      } catch (e) {
        return fail(e instanceof ApiError ? e.message : "Sign-in failed.");
      }
    },
    async resendPin() {
      try {
        const r = await api.post<{ sent_to: string }>("/auth/mfa/resend");
        return { ok: true, sentTo: r.sent_to };
      } catch (e) {
        return fail(e instanceof ApiError ? e.message : "Could not send a new code.");
      }
    },
    logout() {
      api.post("/auth/logout").catch(() => undefined);
      setMe(null);
      setState(EMPTY);
      names.current.clear();
    },

    loadQuery: (id) => loadQuery(id).catch(() => undefined),
    loadComments: (id) => loadComments(id).catch(() => undefined),
    evidenceUrl: (id) => api.url(`/evidence/${id}/download`),

    confirmImport: () => notYet("Browser-side import"),
    cancelImport: () => undefined,
    async uploadImport(file) {
      try {
        const r = await api.upload<Raw>("/imports", file);
        const preview: ServerPreview = {
          batchId: str(r.id),
          filename: str(r.source_filename),
          hash: str(r.source_sha256),
          rows: ((r.rows as Raw[]) ?? []).map(toImportRow),
        };
        return { ok: true, preview };
      } catch (e) {
        return fail(e instanceof ApiError ? e.message : "The file could not be uploaded.");
      }
    },
    confirmBatch: (id) => change(() => api.post(`/imports/${id}/confirm`)),
    cancelBatch: (id) => change(() => api.post(`/imports/${id}/cancel`)),

    editQuery: (id, field, value, reason) => change(() => api.patch(`/queries/${id}`, { [snake(field)]: value.trim(), reason }), id),
    assign: (id, assigneeId, reason) => change(() => api.post(`/queries/${id}/assign`, { assignee: assigneeId, reason }), id),
    decide: (requestId, outcome, reason) => {
      const queryId = state.requests.find((r) => r.id === requestId)?.queryId;
      const verb = outcome === "Closed" ? "approve" : outcome === "Kept in View" ? "keep-in-view" : "reject";
      return change(() => api.post(`/status-requests/${requestId}/${verb}`, { reason }), queryId);
    },
    decideReassignment: (requestId, approve, reason) => {
      const queryId = state.reassignments.find((r) => r.id === requestId)?.queryId;
      return change(() => api.post(`/reassignment-requests/${requestId}/${approve ? "approve" : "reject"}`, { reason }), queryId);
    },
    requestExport: (filters, reason) => change(() => api.post("/export-requests", { filters, reason })),
    decideExport: (id, approve, reason) => change(() => api.post(`/export-requests/${id}/${approve ? "approve" : "reject"}`, { reason })),
    downloadExport: (id) => change(() => api.download(`/export-requests/${id}/download`, csvName())),
    addComment: (id, body) =>
      attempt(async () => {
        await api.post(`/queries/${id}/comments`, { body: body.trim() });
        await loadComments(id);
      }),
    setStatusDirect: (id, to, reason) => change(() => api.post(`/queries/${id}/status`, { to_status: to, reason }), id),
    // Exports are produced and logged by the server (system.md 4.9).
    exportQueries: (_rows, filters) => {
      const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
      return change(() => api.download(`/queries/export${params ? `?${params}` : ""}`, csvName()));
    },
    decideAccess: () => notYet("ICT access approval"),
    verifyLogged: () => undefined,
    async verifyOnServer() {
      try {
        const r = await api.post<{ ok: boolean; checked: number; broken_at: number | null }>("/audit-log/verify");
        await refresh();
        return { ok: r.ok, checked: r.checked, brokenAt: r.broken_at };
      } catch {
        return null;
      }
    },

    addActivity: (id, kind, body) => change(() => api.post(`/queries/${id}/activities`, { kind, body: body.trim() }), id),
    addEvidence: (id, f) => (f.file ? change(() => api.upload(`/queries/${id}/evidence`, f.file!), id) : Promise.resolve(fail("Choose a file."))),
    proposeClosure: (id, reason) => change(() => api.post(`/queries/${id}/propose-status`, { reason }), id),

    createUser: (u) => change(() => api.post("/users", { email: u.email.trim(), full_name: u.fullName.trim(), role: u.role })),
    setUserActive: (userId, active, reason) => change(() => api.post(`/users/${userId}/${active ? "enable" : "disable"}`, { reason })),
    requestAccess: () => notYet("ICT access requests"),
  };

  const value = useMemo(() => store, [state, me, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
