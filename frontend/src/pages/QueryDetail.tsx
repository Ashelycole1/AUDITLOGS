import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Empty, Label, Notice, Panel, ReasonDialog, RiskTag, StatusBadge, StatusMark, StatusRail, cx } from "../components";
import { EVIDENCE_MAX_BYTES, EVIDENCE_TYPES, STATUSES, daysOverdue, fmtBytes, fmtDate, fmtDateTime, isAllowedTransition } from "../lib/rules";
import { useMe, useStore } from "../store";
import type { EditableField, FollowUpActivity, Query, Status } from "../types";

const FIELD_LABEL: Record<EditableField, string> = {
  title: "Title",
  descriptionCurrent: "Finding wording",
  riskRatingCurrent: "Risk rating",
  deadline: "Deadline",
};

export default function QueryDetail() {
  const { id } = useParams();
  const { visibleQueries } = useStore();
  const q = visibleQueries.find((x) => x.id === id);

  // Same answer for "does not exist" and "not yours" so nothing leaks (architecture.md 5.1).
  if (!q) {
    return (
      <div className="mx-auto max-w-lg pt-16">
        <Empty title="Query not found">
          It may not exist, or it is not assigned to you. <Link className="text-lake underline" to="/queries">Back to queries</Link>
        </Empty>
      </div>
    );
  }
  return <Workspace q={q} />;
}

function Workspace({ q }: { q: Query }) {
  const me = useMe();
  const { state, userName } = useStore();
  const late = daysOverdue(q);
  const isCia = me.role === "CIA";
  const isIa = me.role === "IA";
  const batch = state.batches.find((b) => b.id === q.batchId);
  const pending = state.requests.find((r) => r.queryId === q.id && r.decision === "Pending");
  const lastRejected = [...state.requests].reverse().find((r) => r.queryId === q.id && r.decision === "Rejected");

  return (
    <>
      <Link to="/queries" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-lake hover:underline">
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {isIa ? "My queries" : "Queries"}
      </Link>
      <header className="mb-6 mt-2">
        <p className="font-mono text-sm text-lake-deep">{q.reference}</p>
        <h1 className="mt-1 max-w-[40ch] text-balance text-2xl font-semibold leading-tight tracking-[-0.02em] sm:text-[1.75rem]">{q.title}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <StatusBadge status={q.status} />
          <RiskTag risk={q.riskRatingCurrent} />
          {late > 0 && <span className="text-[0.8125rem] font-semibold text-danger">{late} {late === 1 ? "day" : "days"} overdue</span>}
        </div>
      </header>

      <StatusRail status={q.status} />

      {q.status === "Returned" && lastRejected && (
        <div className="mt-4">
          <Notice tone="error">
            <span className="font-medium">Returned by {userName(lastRejected.decidedBy)}:</span> {lastRejected.decisionReason}
          </Notice>
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <Finding q={q} />
          <FollowUp q={q} />
          <EvidencePanel q={q} />
        </div>

        <div className="space-y-5">
          <Panel title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
              <dt className="text-muted">Department</dt>
              <dd>{q.department}</dd>
              <dt className="text-muted">Responsible</dt>
              <dd>{q.responsibleOfficer}</dd>
              <dt className="text-muted">Deadline</dt>
              <dd>
                {fmtDate(q.deadline)}
                {late > 0 && <span className="block font-medium text-danger">{late} days overdue</span>}
              </dd>
              <dt className="text-muted">Auditor</dt>
              <dd className={cx(!q.currentAssignee && "text-faint")}>{q.currentAssignee ? userName(q.currentAssignee) : "Not assigned"}</dd>
              <dt className="text-muted">Risk</dt>
              <dd>
                {q.riskRatingCurrent}
                {q.riskRatingCurrent !== q.riskRatingOriginal && <span className="block text-muted">Imported as {q.riskRatingOriginal}</span>}
              </dd>
              <dt className="text-muted">Source</dt>
              <dd className="break-all">{batch?.sourceFilename}</dd>
            </dl>
          </Panel>

          {pending && <PendingRequest requestId={pending.id} />}
          {isCia && <CiaActions q={q} />}
          {isIa && <Propose q={q} hasPending={!!pending} />}
          <Revisions q={q} />
        </div>
      </div>
    </>
  );
}

function Finding({ q }: { q: Query }) {
  const changed = q.descriptionCurrent !== q.descriptionOriginal;
  return (
    <Panel title="Finding">
      <p className="max-w-[70ch] leading-relaxed">{q.descriptionCurrent}</p>
      {changed ? (
        <div className="glass-inset mt-4 rounded-md p-4">
          <p className="text-sm font-medium text-muted">Original wording, as imported</p>
          <p className="mt-1 max-w-[70ch] text-[0.9375rem] leading-relaxed text-muted">{q.descriptionOriginal}</p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-faint">Unchanged since import.</p>
      )}
    </Panel>
  );
}

type TimelineItem = { at: string; kind: "note" | "response" | "evidence" | "status"; who: string | null; title: string; body?: string; status?: Status };

const ACTION_TITLE: Record<string, string> = {
  "query.assign": "Assigned",
  "query.reassign": "Reassigned",
  "status.change": "Status changed",
  "status.propose": "Proposed for closure",
  "status.approve": "Closure approved",
  "status.reject": "Returned",
  "status.direct": "Status changed directly by the CIA",
};

function FollowUp({ q }: { q: Query }) {
  const me = useMe();
  const { state, userName, addActivity } = useStore();
  const [kind, setKind] = useState<FollowUpActivity["kind"]>("Note");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const items: TimelineItem[] = [
    ...state.activities
      .filter((a) => a.queryId === q.id)
      .map<TimelineItem>((a) => ({ at: a.createdAt, kind: a.kind === "Note" ? "note" : "response", who: a.author, title: a.kind === "Note" ? "Note" : "Management response", body: a.body })),
    ...state.audit
      .filter((e) => e.objectType === "Query" && e.objectId === q.id && e.action in ACTION_TITLE)
      .map<TimelineItem>((e) => {
        const nv = e.newValue as { status?: Status; assignee?: string };
        // Proposals and decisions already name their outcome; plain and direct changes name the status reached.
        const named = e.action === "status.change" ? `Moved to ${nv.status}` : e.action === "status.direct" ? `${ACTION_TITLE[e.action]}: ${nv.status}` : ACTION_TITLE[e.action];
        const title = nv.assignee ? `${ACTION_TITLE[e.action]} to ${userName(nv.assignee)}` : named;
        return { at: e.timestamp, kind: "status", who: e.actor, title, body: e.reason || undefined, status: nv.status ?? (nv.assignee ? "Assigned" : undefined) };
      }),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const canWrite = (me.role === "CIA" || me.role === "IA") && q.status !== "Closed";

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const r = addActivity(q.id, kind, body);
    if (!r.ok) return setError(r.error);
    setBody("");
    setError(null);
  };

  return (
    <Panel title="Follow-up">
      {canWrite && (
        <form onSubmit={save} className="glass-inset mb-5 rounded-md p-4">
          <div role="radiogroup" aria-label="Entry type" className="mb-3 inline-flex rounded-md border border-rule bg-sheet p-0.5 text-sm">
            {(["Note", "ManagementResponse"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cx("min-h-9 rounded px-3 transition-colors", kind === k ? "bg-lake font-medium text-white" : "text-muted hover:text-ink")}
              >
                {k === "Note" ? "Note" : "Management response"}
              </button>
            ))}
          </div>
          <textarea
            className="field min-h-24"
            aria-label={kind === "Note" ? "Note" : "Management response"}
            placeholder={kind === "Note" ? "What did you do or find?" : "What did management say or commit to?"}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[0.8125rem] text-faint">
              {me.role === "IA" && (q.status === "Assigned" || q.status === "Returned") ? "Saving moves this query to In Progress." : "Saved entries cannot be edited."}
            </p>
            <Button kind="primary" type="submit">Save {kind === "Note" ? "note" : "response"}</Button>
          </div>
        </form>
      )}

      {items.length ? (
        <ol className="relative space-y-5 pl-8 before:absolute before:bottom-2 before:left-[7.5px] before:top-2 before:w-px before:bg-rule">
          {items.map((it, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-8 top-0.5 grid size-4 place-items-center bg-sheet" aria-hidden>
                {it.kind === "status" && it.status ? (
                  <StatusMark status={it.status} />
                ) : it.kind === "response" ? (
                  <span className="size-2.5 rounded-sm bg-lake" />
                ) : it.kind === "evidence" ? (
                  <span className="size-2.5 rotate-45 border-[1.5px] border-lake" />
                ) : (
                  <span className="size-2.5 border-[1.5px] border-muted" />
                )}
              </span>
              <p className="text-sm">
                <span className="font-medium">{it.title}</span>
                <span className="text-muted">, {userName(it.who)}, {fmtDateTime(it.at)}</span>
              </p>
              {it.body && (
                <p className={cx("mt-1 max-w-[68ch] leading-relaxed", it.kind === "status" ? "text-sm text-muted" : "text-[0.9375rem]")}>{it.body}</p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <Empty title="No follow-up yet" />
      )}
    </Panel>
  );
}

function EvidencePanel({ q }: { q: Query }) {
  const me = useMe();
  const { state, userName, addEvidence } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const files = state.evidence.filter((e) => e.queryId === q.id);
  const canUpload = (me.role === "CIA" || me.role === "IA") && q.status !== "Closed";

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!EVIDENCE_TYPES.includes(ext)) return setError(`${f.name} is not an allowed type. Use ${EVIDENCE_TYPES.join(", ")}.`);
    if (f.size > EVIDENCE_MAX_BYTES) return setError(`${f.name} is ${fmtBytes(f.size)}. The limit is 20 MB.`);
    setBusy(true);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const r = addEvidence(q.id, { name: f.name, size: f.size, bytes });
    setBusy(false);
    if (!r.ok) setError(r.error);
    if (input.current) input.current.value = "";
  };

  return (
    <Panel
      title="Evidence"
      aside={canUpload && (
        <>
          <input ref={input} type="file" className="sr-only" id="evidence-file" accept={EVIDENCE_TYPES.map((t) => "." + t).join(",")} onChange={(e) => onFile(e.target.files?.[0])} />
          <Button kind="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Hashing file" : "Upload evidence"}</Button>
        </>
      )}
    >
      {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}
      {files.length ? (
        <ul className="divide-y divide-line">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate font-medium">{f.originalFilename}</p>
                <p className="text-[0.8125rem] text-muted">
                  {fmtBytes(f.sizeBytes)}, uploaded by {userName(f.uploadedBy)} on {fmtDate(f.createdAt)}
                </p>
              </div>
              <span className="font-mono text-xs text-faint" title={`SHA-256 ${f.sha256}`}>sha256 {f.sha256.slice(0, 12)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No evidence yet">{canUpload ? "PDF, Word, Excel, images, CSV or text, up to 20 MB each. Files are encrypted when stored." : undefined}</Empty>
      )}
    </Panel>
  );
}

function PendingRequest({ requestId }: { requestId: string }) {
  const me = useMe();
  const { state, userName, decide } = useStore();
  const r = state.requests.find((x) => x.id === requestId)!;
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const own = r.proposedBy === me.id;

  return (
    <Panel title="Waiting for the CIA" className="!border-[#fedf89] !bg-warn-wash/40">
      <p className="text-sm text-muted">
        {userName(r.proposedBy)} proposed closure on {fmtDateTime(r.createdAt)}.
      </p>
      <p className="mt-2 leading-relaxed">{r.proposedReason}</p>
      {me.role === "CIA" && (
        own ? (
          <p className="mt-3 text-sm text-muted">You proposed this, so another CIA must decide it.</p>
        ) : (
          <div className="mt-4 flex gap-2">
            <Button kind="primary" onClick={() => setDialog("approve")}>Approve closure</Button>
            <Button kind="danger" onClick={() => setDialog("reject")}>Return</Button>
          </div>
        )
      )}
      <ReasonDialog
        open={dialog === "approve"}
        title="Approve closure"
        description="The query moves to Closed. The auditor can no longer add follow-up."
        confirmLabel="Approve closure"
        optional
        onConfirm={(reason) => { const res = decide(r.id, true, reason); return res.ok ? null : res.error; }}
        onClose={() => setDialog(null)}
      />
      <ReasonDialog
        open={dialog === "reject"}
        title="Return to the auditor"
        description="Say what is still missing. The auditor sees this reason on the query and by email."
        confirmLabel="Return query"
        danger
        onConfirm={(reason) => { const res = decide(r.id, false, reason); return res.ok ? null : res.error; }}
        onClose={() => setDialog(null)}
      />
    </Panel>
  );
}

function CiaActions({ q }: { q: Query }) {
  const { state, assign, editQuery, setStatusDirect, userName } = useStore();
  const [dialog, setDialog] = useState<"assign" | "edit" | "status" | null>(null);
  const [assignee, setAssignee] = useState("");
  const [field, setField] = useState<EditableField>("riskRatingCurrent");
  const [value, setValue] = useState("");
  const [to, setTo] = useState<Status>("In Progress");
  const auditors = state.users.filter((u) => u.role === "IA" && u.isActive && u.id !== q.currentAssignee);
  const reassign = !!q.currentAssignee;

  const openEdit = (f: EditableField) => {
    setField(f);
    setValue(String(q[f]));
    setDialog("edit");
  };

  return (
    <Panel title="CIA actions">
      <div className="grid gap-2">
        <Button kind={reassign ? "secondary" : "primary"} onClick={() => { setAssignee(""); setDialog("assign"); }}>
          {reassign ? "Reassign" : "Assign auditor"}
        </Button>
        <Button kind="secondary" onClick={() => openEdit("riskRatingCurrent")}>Edit query</Button>
        <Button kind="secondary" onClick={() => { setTo(q.status === "Closed" ? "In Progress" : "Closed"); setDialog("status"); }}>
          {q.status === "Closed" ? "Reopen" : "Change status"}
        </Button>
      </div>
      <p className="mt-3 text-[0.8125rem] leading-snug text-faint">Edits, reassignments and direct status changes appear on the CIA activity view seen by the CEO.</p>

      <ReasonDialog
        open={dialog === "assign"}
        title={reassign ? `Reassign from ${userName(q.currentAssignee)}` : "Assign an auditor"}
        description={reassign ? "The new auditor sees the full history. The current auditor loses access straight away." : "The auditor gets an email with the reference and a link."}
        confirmLabel={reassign ? "Reassign" : "Assign"}
        optional={!reassign}
        onConfirm={(reason) => { if (!assignee) return "Choose an auditor."; const r = assign(q.id, assignee, reason); return r.ok ? null : r.error; }}
        onClose={() => setDialog(null)}
      >
        <div>
          <Label htmlFor="assignee">Auditor</Label>
          <select id="assignee" className="field" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Choose an auditor</option>
            {auditors.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        </div>
      </ReasonDialog>

      <ReasonDialog
        open={dialog === "edit"}
        title="Edit query"
        description="The original imported wording is kept. This edit is saved as a revision."
        confirmLabel="Save edit"
        onConfirm={(reason) => { const r = editQuery(q.id, field, value, reason); return r.ok ? null : r.error; }}
        onClose={() => setDialog(null)}
      >
        <div>
          <Label htmlFor="edit-field">Field</Label>
          <select id="edit-field" className="field" value={field} onChange={(e) => { const f = e.target.value as EditableField; setField(f); setValue(String(q[f])); }}>
            {(Object.keys(FIELD_LABEL) as EditableField[]).map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="edit-value">New value</Label>
          {field === "riskRatingCurrent" ? (
            <select id="edit-value" className="field" value={value} onChange={(e) => setValue(e.target.value)}>
              <option>High</option><option>Medium</option><option>Low</option>
            </select>
          ) : field === "deadline" ? (
            <input id="edit-value" type="date" className="field" value={value} onChange={(e) => setValue(e.target.value)} />
          ) : field === "descriptionCurrent" ? (
            <textarea id="edit-value" className="field min-h-28" value={value} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input id="edit-value" className="field" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </div>
      </ReasonDialog>

      <ReasonDialog
        open={dialog === "status"}
        title={q.status === "Closed" ? "Reopen query" : "Change status directly"}
        description="Use this to correct a mistake. It bypasses the auditor's proposal, so it is shown to the CEO."
        confirmLabel={q.status === "Closed" ? "Reopen" : "Change status"}
        onConfirm={(reason) => { const r = setStatusDirect(q.id, to, reason); return r.ok ? null : r.error; }}
        onClose={() => setDialog(null)}
      >
        <div>
          <Label htmlFor="to-status">New status</Label>
          <select id="to-status" className="field" value={to} onChange={(e) => setTo(e.target.value as Status)}>
            {STATUSES.filter((s) => s !== q.status).map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </ReasonDialog>
    </Panel>
  );
}

function Propose({ q, hasPending }: { q: Query; hasPending: boolean }) {
  const { proposeClosure } = useStore();
  const [open, setOpen] = useState(false);
  const allowed = isAllowedTransition(q.status, "Proposed for Closure", "IA");
  if (hasPending || q.status === "Closed") return null;

  return (
    <Panel title="Ready to close?">
      <p className="text-sm leading-relaxed text-muted">
        {allowed
          ? "When the finding is resolved, propose closure. The CIA reviews your evidence and decides."
          : q.status === "Returned"
            ? "Add a note or response to resume work before proposing again."
            : "Record your first follow-up to start work on this query."}
      </p>
      <Button kind="primary" className="mt-4 w-full" disabled={!allowed} onClick={() => setOpen(true)}>Propose closure</Button>
      <ReasonDialog
        open={open}
        title="Propose closure"
        description="Needs at least one management response or evidence file. You cannot approve your own proposal."
        confirmLabel="Send to the CIA"
        onConfirm={(reason) => { const r = proposeClosure(q.id, reason); return r.ok ? null : r.error; }}
        onClose={() => setOpen(false)}
      />
    </Panel>
  );
}

function Revisions({ q }: { q: Query }) {
  const { state, userName } = useStore();
  const revs = state.revisions.filter((r) => r.queryId === q.id).reverse();
  if (!revs.length) return null;
  return (
    <Panel title="Revisions">
      <ul className="space-y-4">
        {revs.map((r) => (
          <li key={r.id} className="text-sm">
            <p className="font-medium">{FIELD_LABEL[r.field]}</p>
            <p className="mt-1">
              <span className="text-muted line-through decoration-ink/30">{r.oldValue.length > 60 ? r.oldValue.slice(0, 60) + "…" : r.oldValue}</span>
              <span className="mx-1.5 text-faint" aria-label="changed to">to</span>
              <span>{r.newValue.length > 60 ? r.newValue.slice(0, 60) + "…" : r.newValue}</span>
            </p>
            <p className="mt-1 leading-snug text-muted">{r.reason}</p>
            <p className="mt-1 text-[0.8125rem] text-faint">{userName(r.editedBy)}, {fmtDateTime(r.createdAt)}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
