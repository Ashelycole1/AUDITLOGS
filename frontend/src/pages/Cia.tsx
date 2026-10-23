import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, Button, Check, Empty, Label, Notice, PageHeader, Panel, ReasonDialog, Ref, RiskTag, StatusBadge, Table, cx } from "../components";
import { Icon } from "../icons";
import { verifyChain } from "../lib/auditChain";
import { ROLE_NAME, STATUSES, daysOverdue, describeFilters, fmtDate, fmtDateTime, matchesFilters } from "../lib/rules";
import { useMe, useStore, type Outcome } from "../storeTypes";
import type { AuditEntry, Decision, ExportFilters, ExportRequest, Query, ReassignmentRequest, StatusChangeRequest } from "../types";

// CIA: the approvals inbox for closure proposals, reassignments and exports.
// PIA: reviews of closure proposals (return or keep in view), and their own requests (owner, 2026-10-22).
export function ApprovalsPage() {
  const me = useMe();
  const { state } = useStore();
  const isCia = me.role === "CIA";
  const oldest = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);
  const proposals = state.requests.filter((r) => r.decision === "Pending").sort(oldest);
  const moves = state.reassignments.filter((r) => r.decision === "Pending").sort(oldest);
  const exportsWaiting = state.exports.filter((r) => r.decision === "Pending").sort(oldest);
  const decided = state.requests.filter((r) => r.decision !== "Pending").sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")).slice(0, 6);
  const waiting = isCia ? proposals.length + moves.length + exportsWaiting.length : proposals.length;

  return (
    <>
      <PageHeader
        title={isCia ? "Approvals" : "Reviews"}
        lede={
          isCia
            ? waiting ? `${waiting} ${waiting === 1 ? "item is" : "items are"} waiting for your decision, oldest first.` : "Nothing is waiting for you."
            : "Review the auditors' closure proposals: return them for more work or keep them in view. Only the CIA can close a query. Your reassignment and export requests are below."
        }
      />

      <Section title="Closure proposals" count={proposals.length}>
        {proposals.length ? proposals.map((r) => <RequestCard key={r.id} r={r} />) : <Empty title="No proposals waiting">When an auditor proposes closing a query, it appears here{isCia ? " for your decision" : " for your review"}.</Empty>}
      </Section>

      {isCia ? (
        <>
          <Section title="Reassignments" count={moves.length}>
            {moves.length ? moves.map((r) => <ReassignmentCard key={r.id} r={r} />) : <Empty title="No reassignments waiting">When the PIA asks to move a query to another auditor, it appears here.</Empty>}
          </Section>
          <Section title="Exports" count={exportsWaiting.length}>
            {exportsWaiting.length ? exportsWaiting.map((x) => <ExportCard key={x.id} x={x} />) : <Empty title="No exports waiting">When the PIA asks to export queries, it appears here.</Empty>}
          </Section>
        </>
      ) : (
        <>
          <MyReassignments />
          <MyExports />
        </>
      )}

      {decided.length > 0 && (
        <Panel title="Recently decided proposals" className="mt-8">
          <ul className="divide-y divide-line">
            {decided.map((r) => <DecidedRow key={r.id} r={r} />)}
          </ul>
        </Panel>
      )}
    </>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-base font-medium tracking-[-0.01em]">
        {title}
        {count > 0 && <span className="min-w-5 rounded-full bg-lake px-1.5 text-center font-mono text-[0.6875rem] leading-5 text-on-accent">{count}</span>}
      </h2>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function waitingFor(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days < 1 ? "Waiting since today" : `Waiting ${days} ${days === 1 ? "day" : "days"}`;
}

function SheetHeader({ q, since }: { q: Query; since: string }) {
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-line px-5 py-4 sm:px-6">
      <div className="min-w-0 max-w-[60ch]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><Ref>{q.reference}</Ref><RiskTag risk={q.riskRatingCurrent} /></div>
        <Link to={`/queries/${q.id}`} className="mt-1 block text-[1.1875rem] font-medium leading-snug tracking-[-0.015em] hover:text-lake hover:underline">{q.title}</Link>
      </div>
      <p className={cx("text-sm font-medium", days >= 5 ? "text-danger" : "text-warn")}>{waitingFor(since)}</p>
    </header>
  );
}

// A review sheet: what the auditor says, the checks the closure rule needs, then the decision.
function RequestCard({ r }: { r: StatusChangeRequest }) {
  const me = useMe();
  const { state, userName, decide } = useStore();
  const [dialog, setDialog] = useState<Outcome | null>(null);
  const q = state.queries.find((x) => x.id === r.queryId)!;
  const responses = r.responses ?? state.activities.filter((a) => a.queryId === q.id && a.kind === "ManagementResponse").length;
  const files = r.evidenceFiles ?? state.evidence.filter((e) => e.queryId === q.id).length;
  const own = r.proposedBy === me.id;
  const isCia = me.role === "CIA";

  return (
    <article className="sheet overflow-hidden rounded-xl">
      <SheetHeader q={q} since={r.createdAt} />

      <div className="grid gap-6 px-5 py-5 sm:px-6 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div>
          <p className="text-[0.8125rem] text-muted">{userName(r.proposedBy)} proposed closure on {fmtDateTime(r.createdAt)}</p>
          <blockquote className="mt-2 border-l-[3px] border-rule pl-4 text-[1.0625rem] leading-relaxed">{r.proposedReason}</blockquote>
        </div>
        <ul className="space-y-2.5 text-sm md:border-l md:border-line md:pl-6" aria-label="Closure checks">
          <li className="flex items-start gap-2"><Check ok={responses > 0} /><span>{responses} management {responses === 1 ? "response" : "responses"}</span></li>
          <li className="flex items-start gap-2"><Check ok={files > 0} /><span>{files} evidence {files === 1 ? "file" : "files"}</span></li>
          <li className="flex items-start gap-2"><Check ok={!own} /><span>{own ? "You proposed this" : "Proposed by someone else"}</span></li>
        </ul>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-subtle px-5 py-3.5 sm:px-6">
        {own ? (
          <p className="mr-auto text-sm text-muted">You cannot decide your own proposal. Another CIA must decide it.</p>
        ) : isCia ? (
          <>
            <Button kind="danger" onClick={() => setDialog("Returned")}>Return to auditor</Button>
            <Button kind="secondary" onClick={() => setDialog("Kept in View")}>Keep in view</Button>
            <Button kind="primary" onClick={() => setDialog("Closed")}>Approve closure</Button>
          </>
        ) : (
          <>
            <p className="mr-auto text-sm text-muted">Leave it for the CIA to close, or:</p>
            <Button kind="secondary" onClick={() => setDialog("Kept in View")}>Keep in view</Button>
            <Button kind="danger" onClick={() => setDialog("Returned")}>Return to auditor</Button>
          </>
        )}
      </footer>

      <ReasonDialog
        open={dialog === "Closed"}
        title={`Approve closure of ${q.reference}`}
        description="The query moves to Closed and your decision is written to the audit log."
        confirmLabel="Approve closure"
        optional
        onConfirm={async (reason) => { const res = await decide(r.id, "Closed", reason); return res.ok ? null : res.error; }}
        onClose={() => setDialog(null)}
      />
      <ReasonDialog
        open={dialog === "Returned"}
        title={`Return ${q.reference} to the auditor`}
        description="Say what is still missing. The auditor sees this reason on the query and is notified."
        confirmLabel="Return to auditor"
        danger
        onConfirm={async (reason) => { const res = await decide(r.id, "Returned", reason); return res.ok ? null : res.error; }}
        onClose={() => setDialog(null)}
      />
      <ReasonDialog
        open={dialog === "Kept in View"}
        title={`Keep ${q.reference} in view`}
        description="The query is not closed. It stays under watch until the auditor resumes work. Say what you are waiting for; the auditor is notified."
        confirmLabel="Keep in view"
        onConfirm={async (reason) => { const res = await decide(r.id, "Kept in View", reason); return res.ok ? null : res.error; }}
        onClose={() => setDialog(null)}
      />
    </article>
  );
}

function ReassignmentCard({ r }: { r: ReassignmentRequest }) {
  const { state, userName, decideReassignment } = useStore();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const q = state.queries.find((x) => x.id === r.queryId)!;
  return (
    <article className="sheet overflow-hidden rounded-xl">
      <SheetHeader q={q} since={r.createdAt} />
      <div className="px-5 py-5 sm:px-6">
        <p className="text-[0.8125rem] text-muted">{userName(r.requestedBy)} asked on {fmtDateTime(r.createdAt)} to move this query</p>
        <p className="mt-2 text-[1.0625rem]">
          from <span className="font-medium">{userName(r.fromAssignee)}</span> to <span className="font-medium">{userName(r.toAssignee)}</span>
        </p>
        <blockquote className="mt-2 border-l-[3px] border-rule pl-4 leading-relaxed">{r.reason}</blockquote>
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-subtle px-5 py-3.5 sm:px-6">
        <Button kind="danger" onClick={() => setDialog("reject")}>Reject</Button>
        <Button kind="primary" onClick={() => setDialog("approve")}>Approve reassignment</Button>
      </footer>
      <ReasonDialog
        open={dialog === "approve"}
        title={`Move ${q.reference} to ${userName(r.toAssignee)}`}
        description="The new auditor sees the full history and is notified; the current auditor loses access straight away. The query becomes Assigned."
        confirmLabel="Approve reassignment"
        optional
        onConfirm={async (reason) => { const res = await decideReassignment(r.id, true, reason); return res.ok ? null : res.error; }}
        onClose={() => setDialog(null)}
      />
      <ReasonDialog
        open={dialog === "reject"}
        title="Reject the reassignment"
        description={`The query stays with ${userName(r.fromAssignee)} and goes back to ${r.fromStatus}. The PIA sees your reason in Reviews and is notified.`}
        confirmLabel="Reject"
        danger
        onConfirm={async (reason) => { const res = await decideReassignment(r.id, false, reason); return res.ok ? null : res.error; }}
        onClose={() => setDialog(null)}
      />
    </article>
  );
}

function ExportCard({ x }: { x: ExportRequest }) {
  const { state, userName, decideExport } = useStore();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const rows = state.queries.filter((q) => matchesFilters(q, x.filters)).length;
  return (
    <article className="sheet overflow-hidden rounded-xl">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <p className="text-[1.1875rem] font-medium tracking-[-0.015em]">Export of {describeFilters(x.filters, userName)}</p>
          <p className="mt-0.5 text-sm text-muted">About {rows} {rows === 1 ? "query" : "queries"} as they stand now, as an Excel workbook</p>
        </div>
        <p className="text-sm font-medium text-warn">{waitingFor(x.createdAt)}</p>
      </header>
      <div className="px-5 py-5 sm:px-6">
        <p className="text-[0.8125rem] text-muted">{userName(x.requestedBy)} asked on {fmtDateTime(x.createdAt)}</p>
        <blockquote className="mt-2 border-l-[3px] border-rule pl-4 leading-relaxed">{x.reason}</blockquote>
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-subtle px-5 py-3.5 sm:px-6">
        <Button kind="danger" onClick={() => setDialog("reject")}>Reject</Button>
        <Button kind="primary" onClick={() => setDialog("approve")}>Approve export</Button>
      </footer>
      <ReasonDialog
        open={dialog === "approve"}
        title="Approve the export"
        description={`${userName(x.requestedBy)} can then download it. Every download is written to the audit log.`}
        confirmLabel="Approve export"
        optional
        onConfirm={async (reason) => { const res = await decideExport(x.id, true, reason); return res.ok ? null : res.error; }}
        onClose={() => setDialog(null)}
      />
      <ReasonDialog
        open={dialog === "reject"}
        title="Reject the export"
        description="The PIA sees your reason in Reviews and is notified."
        confirmLabel="Reject"
        danger
        onConfirm={async (reason) => { const res = await decideExport(x.id, false, reason); return res.ok ? null : res.error; }}
        onClose={() => setDialog(null)}
      />
    </article>
  );
}

function DecisionMark({ decision }: { decision: Decision }) {
  return <Check pending={decision === "Pending"} ok={decision === "Approved"} />;
}

function MyReassignments() {
  const me = useMe();
  const { state, userName } = useStore();
  const mine = state.reassignments.filter((r) => r.requestedBy === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  return (
    <Panel title="Your reassignment requests" className="mb-8">
      {mine.length ? (
        <ul className="divide-y divide-line">
          {mine.map((r) => {
            const q = state.queries.find((x) => x.id === r.queryId);
            return (
              <li key={r.id} className="flex gap-3 py-3 text-sm first:pt-0 last:pb-0">
                <span className="mt-0.5"><DecisionMark decision={r.decision} /></span>
                <div className="min-w-0 flex-1">
                  <p>{q && <Link to={`/queries/${q.id}`} className="hover:underline"><Ref>{q.reference}</Ref></Link>} {userName(r.fromAssignee)} to {userName(r.toAssignee)}</p>
                  <p className="mt-0.5 text-muted">
                    {r.decision === "Pending" ? "Waiting for the CIA." : `${r.decision} by ${userName(r.decidedBy)}${r.decisionReason ? `: ${r.decisionReason}` : "."}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty title="No reassignment requests">To move a query to another auditor, open it and choose Request reassignment. The CIA approves it.</Empty>
      )}
    </Panel>
  );
}

function MyExports() {
  const me = useMe();
  const { state, userName, downloadExport } = useStore();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = state.exports.filter((x) => x.requestedBy === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  return (
    <Panel title="Your exports" aside={<Button kind="secondary" onClick={() => setOpen(true)}>Request an export</Button>} className="mb-8">
      {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}
      {mine.length ? (
        <ul className="divide-y divide-line">
          {mine.map((x) => (
            <li key={x.id} className="flex flex-wrap items-start gap-3 py-3 text-sm first:pt-0 last:pb-0">
              <span className="mt-0.5"><DecisionMark decision={x.decision} /></span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">Export of {describeFilters(x.filters, userName)}</p>
                <p className="mt-0.5 text-muted">
                  Asked {fmtDateTime(x.createdAt)}.{" "}
                  {x.decision === "Pending" ? "Waiting for the CIA." : `${x.decision} by ${userName(x.decidedBy)}${x.decisionReason ? `: ${x.decisionReason}` : "."}`}
                  {x.downloads > 0 && ` Downloaded ${x.downloads} ${x.downloads === 1 ? "time" : "times"}.`}
                </p>
              </div>
              {x.decision === "Approved" && (
                <Button kind="primary" onClick={async () => { const r = await downloadExport(x.id); setError(r.ok ? null : r.error); }}>Download Excel</Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No exports yet">Exports need the CIA's approval. Ask for one here or from the queries list, with its filters.</Empty>
      )}
      <ExportRequestDialog open={open} filters={{}} onClose={() => setOpen(false)} />
    </Panel>
  );
}

/** The PIA's "Seek approval" step before an export (owner, 2026-10-22). */
export function ExportRequestDialog({ open, filters, onClose, onDone }: { open: boolean; filters: ExportFilters; onClose: () => void; onDone?: () => void }) {
  const { userName, requestExport } = useStore();
  return (
    <ReasonDialog
      open={open}
      title="Seek approval to export"
      description={`Exports need the CIA's approval. This asks for ${describeFilters(filters, userName)}, as an Excel workbook. Once approved, download it from Reviews; every download is logged.`}
      confirmLabel="Send to the CIA"
      onConfirm={async (reason) => {
        const r = await requestExport(filters, reason);
        if (r.ok) onDone?.();
        return r.ok ? null : r.error;
      }}
      onClose={onClose}
    />
  );
}

const OUTCOME_TONE: Record<string, string> = { Closed: "", Returned: "text-danger", "Kept in View": "text-muted" };

function DecidedRow({ r }: { r: StatusChangeRequest }) {
  const { state, userName } = useStore();
  const q = state.queries.find((x) => x.id === r.queryId)!;
  const approved = r.decision === "Approved";
  const outcome = r.decidedStatus ?? (approved ? "Closed" : "Returned");
  return (
    <li className="grid gap-x-4 gap-y-1 py-3 text-sm first:pt-0 last:pb-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-baseline">
      <span className="flex items-center gap-2">
        <Check ok={approved} pending={outcome === "Kept in View"} />
        <Link to={`/queries/${q.id}`} className="hover:underline"><Ref>{q.reference}</Ref></Link>
      </span>
      <span>
        <span className={cx("font-medium", OUTCOME_TONE[outcome])}>{outcome}</span>
        {r.decisionReason && <span className="text-muted">: {r.decisionReason}</span>}
      </span>
      <span className="text-faint">{userName(r.decidedBy)}, {fmtDateTime(r.decidedAt!)}</span>
    </li>
  );
}

export const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.login_failed": "Failed sign-in",
  "import.upload": "Uploaded import",
  "import.confirm": "Confirmed import",
  "import.cancel": "Cancelled import",
  "query.assign": "Assigned",
  "query.reassign": "Reassigned",
  "reassign.request": "Asked to reassign",
  "reassign.approve": "Approved reassignment",
  "reassign.reject": "Rejected reassignment",
  "status.keep": "Kept in view",
  "comment.add": "Commented",
  "query.edit": "Edited query",
  "status.change": "Status changed",
  "status.propose": "Proposed closure",
  "status.approve": "Approved closure",
  "status.reject": "Returned query",
  "status.direct": "Direct status change",
  "activity.note": "Added note",
  "activity.response": "Added response",
  "evidence.upload": "Uploaded evidence",
  "export.queries": "Exported queries",
  "export.request": "Asked to export",
  "export.approve": "Approved export",
  "export.reject": "Rejected export",
  "export.download": "Downloaded export",
  "breakglass.request": "Requested access",
  "breakglass.approve": "Approved access",
  "breakglass.reject": "Refused access",
  "auditlog.verify": "Verified the log",
  "user.create": "Created account",
  "user.enable": "Enabled account",
  "user.disable": "Disabled account",
  "user.reset_mfa": "Reset MFA",
};

// Field names as a reader would say them; people and queries by name and reference, not by ID.
const FIELD: Record<string, string> = { queryId: "query", assignee: "auditor", riskRatingCurrent: "risk", descriptionCurrent: "wording", isActive: "active" };
const HIDDEN = new Set(["request", "comment", "activity", "evidence"]);

function describeChange(e: AuditEntry, name: (key: string, value: string) => string = (_, v) => v): string {
  const value = (k: string, x: unknown): string =>
    x === null || x === undefined
      ? "none"
      : typeof x === "object"
        ? Object.entries(x as Record<string, unknown>).map(([kk, xx]) => `${FIELD[kk] ?? kk} ${value(kk, xx)}`).join(", ") || "all"
        : name(k, String(x));
  const fmt = (v: unknown) =>
    v && typeof v === "object"
      ? Object.entries(v as Record<string, unknown>)
          .filter(([k]) => !HIDDEN.has(k))
          .map(([k, x]) => `${FIELD[k] ?? k}: ${value(k, x)}`)
          .join(", ")
      : v === null || v === undefined ? "" : String(v);
  const o = fmt(e.oldValue);
  const n = fmt(e.newValue);
  return o && n ? `${o} → ${n}` : n || o;
}

// How an entry stands while the log is checked: not yet reached, matched, the first mismatch, or after it.
type EntryState = "idle" | "ok" | "broken" | "after";

function entryState(seq: number, checkedTo: number, brokenAt: number | null): EntryState {
  if (brokenAt !== null && seq === brokenAt && checkedTo >= seq) return "broken";
  if (brokenAt !== null && seq > brokenAt && checkedTo >= brokenAt) return "after";
  return seq <= checkedTo ? "ok" : "idle";
}

// A small colour per kind of action, so a day's ledger can be scanned at a glance.
const KIND_TONE: Record<string, string> = {
  auth: "bg-mark-neutral",
  import: "bg-mark-imported",
  query: "bg-mark-assigned",
  reassign: "bg-mark-assigned",
  status: "bg-mark-warn",
  activity: "bg-lake",
  evidence: "bg-lake",
  comment: "bg-lake",
  export: "bg-mark-good",
  auditlog: "bg-mark-good",
  breakglass: "bg-mark-critical",
  user: "bg-mark-neutral",
};

const KAMPALA_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit" });
const DAY_TITLE = new Intl.DateTimeFormat("en-UG", { timeZone: "Africa/Kampala", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-UG", { timeZone: "Africa/Kampala", hour: "2-digit", minute: "2-digit", hour12: false });

function dayTitle(key: string): string {
  const today = KAMPALA_DAY.format(new Date());
  const yesterday = KAMPALA_DAY.format(new Date(Date.now() - 86_400_000));
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return DAY_TITLE.format(new Date(`${key}T12:00:00+03:00`));
}

// The seal: one ring that fills as each entry's fingerprint is recomputed. It is the page's only flourish.
function Seal({ total, checked, state }: { total: number; checked: number; state: "idle" | "running" | "ok" | "broken" }) {
  const r = 52;
  const length = 2 * Math.PI * r;
  const share = total ? Math.min(1, checked / total) : 0;
  const tone = state === "broken" ? "text-danger" : state === "ok" ? "text-good" : "text-lake";
  return (
    <div className="relative grid size-[8.5rem] shrink-0 place-items-center" role="img" aria-label={`${checked} of ${total} entries checked`}>
      <svg viewBox="0 0 128 128" className="absolute inset-0 -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" className="stroke-line" strokeWidth="6" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - share)}
          className={cx(tone, "transition-[stroke-dashoffset] duration-100 motion-reduce:transition-none", state === "idle" && "opacity-0")}
        />
        {/* Fine ticks around the rim, like the milled edge of a seal. */}
        {Array.from({ length: 48 }, (_, i) => (
          <line key={i} x1="64" y1="3" x2="64" y2={i % 4 ? "6" : "8"} className="stroke-rule" strokeWidth="1" transform={`rotate(${i * 7.5} 64 64)`} />
        ))}
      </svg>
      <div className="text-center">
        {state === "ok" || state === "broken" ? (
          <Icon name={state === "ok" ? "check" : "close"} className={cx("mx-auto size-7", tone)} />
        ) : (
          <span className="block text-[1.75rem] font-medium leading-none tracking-[-0.03em] tabular-nums">{state === "running" ? checked : total}</span>
        )}
        <span className="mt-1 block text-xs text-muted">{state === "running" ? `of ${total}` : state === "idle" ? "entries" : state === "ok" ? "intact" : "broken"}</span>
      </div>
    </div>
  );
}

export function AuditLogPage() {
  const { state, userName, verifyLogged, mode, verifyOnServer } = useStore();
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [object, setObject] = useState("");
  const [from, setFrom] = useState("");
  const [result, setResult] = useState<ReturnType<typeof verifyChain> | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [checkedTo, setCheckedTo] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const entries = useMemo(
    () =>
      state.audit
        .filter(
          (e) =>
            (!actor || e.actor === actor) &&
            (!action || e.action.startsWith(action)) &&
            (!object || e.objectType === object) &&
            (!from || e.timestamp.slice(0, 10) >= from),
        )
        .reverse(),
    [state.audit, actor, action, object, from],
  );
  const days = useMemo(() => {
    const groups: { key: string; rows: AuditEntry[] }[] = [];
    for (const e of entries) {
      const key = KAMPALA_DAY.format(new Date(e.timestamp));
      if (groups[groups.length - 1]?.key !== key) groups.push({ key, rows: [] });
      groups[groups.length - 1].rows.push(e);
    }
    return groups;
  }, [entries]);

  const total = state.audit.length;
  const brokenAt = result && !result.ok ? result.brokenAt : null;
  const filtered = !!(actor || action || object || from);

  // The check itself is instant; the seal fills as it goes so the reader sees what it did.
  const verify = async () => {
    let r: ReturnType<typeof verifyChain>;
    setVerifyError(null);
    if (mode === "api") {
      // The server recomputes every fingerprint from the database and logs the check itself.
      setRunning(true);
      const s = await verifyOnServer();
      if (!s) {
        setRunning(false);
        return setVerifyError("The check could not run. Try again, and tell ICT if it keeps failing.");
      }
      r = s.ok ? { ok: true, checked: s.checked } : { ok: false, brokenAt: s.brokenAt ?? 1 };
    } else {
      r = verifyChain(state.audit);
    }
    const stop = r.ok ? total : r.brokenAt;
    const finish = () => {
      setCheckedTo(stop);
      setRunning(false);
      setResult(r);
      setCheckedAt(new Date().toISOString());
      verifyLogged(r.ok ? `intact (${r.checked})` : `broken at ${r.brokenAt}`);
    };
    setResult(null);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return finish();
    setRunning(true);
    setCheckedTo(0);
    const step = Math.max(1, Math.ceil(stop / 45));
    let at = 0;
    timer.current = window.setInterval(() => {
      at = Math.min(stop, at + step);
      setCheckedTo(at);
      if (at >= stop) {
        window.clearInterval(timer.current!);
        timer.current = null;
        finish();
      }
    }, 28);
  };

  const sealState = running ? "running" : result === null ? "idle" : result.ok ? "ok" : "broken";
  const objectTypes = [...new Set(state.audit.map((e) => e.objectType))].sort();
  const actionGroups = [...new Set(state.audit.map((e) => e.action.split(".")[0]))].sort();
  const people = [...new Map(state.audit.filter((e) => e.actor).map((e) => [e.actor!, userName(e.actor)])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const first = state.audit[0];
  const last = state.audit[state.audit.length - 1];

  return (
    <>
      <PageHeader title="Audit log" lede="Every action in the system, in order. Entries cannot be edited or deleted, and each one carries a fingerprint of everything before it." />

      <section className={cx("card mb-8 flex flex-col gap-6 rounded-xl p-5 sm:flex-row sm:items-center sm:p-7", result && !result.ok && "!border-danger/50")}>
        <Seal total={total} checked={sealState === "idle" ? 0 : checkedTo} state={sealState} />
        <div className="min-w-0 flex-1" aria-live="polite">
          <h2 className={cx("text-[1.5rem] font-medium tracking-[-0.025em]", sealState === "ok" && "text-good", sealState === "broken" && "text-danger")}>
            {sealState === "running" ? "Checking every fingerprint" : sealState === "idle" ? "Not checked this session" : sealState === "ok" ? "The log is intact" : `Entry ${brokenAt} has been altered`}
          </h2>
          <p className={cx("mt-1.5 max-w-[60ch] text-sm leading-relaxed", sealState === "broken" ? "text-danger" : "text-muted")}>
            {sealState === "running"
              ? `Recomputed ${checkedTo} of ${total}.`
              : sealState === "idle"
                ? `A nightly check recomputes all ${total} fingerprints. Run it now to confirm nothing has changed since.`
                : sealState === "ok"
                  ? `All ${total} entries match their fingerprints. Checked ${fmtDateTime(checkedAt!)}.`
                  : `Its fingerprint no longer matches, so nothing recorded after it can be trusted until it is explained. The CIA and ICT have been alerted and a breach register draft written.`}
          </p>
          {first && last && (
            <p className="mt-3 text-[0.8125rem] text-faint">
              First entry {fmtDate(first.timestamp)}, latest {fmtDateTime(last.timestamp)}.
            </p>
          )}
          {verifyError && <div className="mt-3"><Notice tone="error">{verifyError}</Notice></div>}
        </div>
        <Button kind="primary" onClick={verify} disabled={running} className="self-start sm:self-center">
          {running ? "Verifying" : result ? "Verify again" : "Verify the log"}
        </Button>
      </section>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="al-user">Person</Label>
          <select id="al-user" className="field" value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">Anyone</option>
            {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="al-action">Kind of action</Label>
          <select id="al-action" className="field" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Any action</option>
            {actionGroups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="al-object">Applies to</Label>
          <select id="al-object" className="field" value={object} onChange={(e) => setObject(e.target.value)}>
            <option value="">Anything</option>
            {objectTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="al-from">From</Label>
          <input id="al-from" type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
      </div>
      {filtered && <p className="-mt-3 mb-5 text-[0.8125rem] text-muted">Showing {entries.length} of {total} entries.</p>}

      {days.length ? (
        <div className="space-y-8">
          {days.map((d) => (
            <section key={d.key} aria-label={dayTitle(d.key)}>
              <h3 className="sticky top-16 z-10 -mx-1 mb-2 flex items-baseline justify-between bg-paper/95 px-1 py-2 backdrop-blur">
                <span className="text-base font-medium tracking-[-0.01em]">{dayTitle(d.key)}</span>
                <span className="text-[0.8125rem] text-faint">{d.rows.length} {d.rows.length === 1 ? "entry" : "entries"}</span>
              </h3>
              <ol className="card divide-y divide-line overflow-hidden rounded-xl">
                {d.rows.map((e) => (
                  <LedgerRow key={e.seq} e={e} state={entryState(e.seq, checkedTo, brokenAt)} name={userName(e.actor)} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <Empty title="No entries match">Clear a filter to see more.</Empty>
      )}
    </>
  );
}

function LedgerRow({ e, state, name }: { e: AuditEntry; state: EntryState; name: string }) {
  const { state: store, userName } = useStore();
  const kind = e.action.split(".")[0];
  const change = describeChange(e, (key, v) => {
    if (key === "assignee") return userName(v);
    if (key === "queryId") return store.queries.find((q) => q.id === v)?.reference ?? v;
    return v;
  });
  return (
    <li
      className={cx(
        "grid gap-x-5 gap-y-1.5 px-4 py-3.5 sm:px-5 md:grid-cols-[3.5rem_minmax(10rem,13rem)_minmax(0,1fr)_7.5rem] md:items-start",
        state === "broken" && "bg-danger-wash/70",
        state === "after" && "opacity-60",
      )}
    >
      <time dateTime={e.timestamp} className="pt-0.5 text-sm tabular-nums text-muted">{TIME.format(new Date(e.timestamp))}</time>

      <div className="flex min-w-0 items-center gap-2.5">
        {e.actor ? <Avatar name={name} className="!size-7 !text-[0.6875rem]" /> : <span className="grid size-7 shrink-0 place-items-center rounded-full border border-dashed border-rule text-[0.6875rem] text-faint" aria-hidden>—</span>}
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm">{e.actor ? name : "Not signed in"}</span>
          {e.actorRole && <span className="block text-xs text-faint">{ROLE_NAME[e.actorRole]}</span>}
        </span>
      </div>

      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[0.9375rem]">
          <span className={cx("size-2 shrink-0 rounded-full", KIND_TONE[kind] ?? "bg-mark-neutral")} aria-hidden />
          <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
          <span className="text-sm text-faint">{e.objectType}</span>
        </p>
        {change && <p className="mt-0.5 pl-4 text-[0.8125rem] text-muted [overflow-wrap:anywhere]">{change}</p>}
        {e.reason && <p className="mt-1 pl-4 text-sm leading-relaxed">“{e.reason}”</p>}
      </div>

      <div className="flex items-center gap-1.5 md:justify-end md:pt-0.5" title={`Entry ${e.seq}\nFingerprint ${e.entryHash}\nBuilt on ${e.prevHash}`}>
        <span className={cx("font-mono text-xs", state === "broken" ? "text-danger" : "text-muted")}>{e.entryHash.slice(0, 8)}</span>
        {state === "ok" && <Icon name="check" className="size-3.5 text-good" />}
        {state === "broken" && <span className="text-xs font-medium text-danger">altered</span>}
        <span className="sr-only">{state === "ok" ? "fingerprint matches" : state === "broken" ? "fingerprint does not match" : state === "after" ? "not proven" : "not checked"}</span>
      </div>
    </li>
  );
}

export function ReportsPage() {
  const { visibleQueries, userName, exportQueries } = useStore();
  const [flash, setFlash] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const overdue = visibleQueries.filter((q) => daysOverdue(q) > 0).sort((a, b) => daysOverdue(b) - daysOverdue(a));
  const counts = STATUSES.map((s) => [s, visibleQueries.filter((q) => q.status === s).length] as const);
  const max = Math.max(...counts.map(([, n]) => n), 1);
  const worst = overdue.length ? daysOverdue(overdue[0]) : 1;

  return (
    <>
      <PageHeader
        title="Reports"
        lede="Where every query stands, and which are late. Only the CIA can export, and every export is written to the audit log."
        actions={<Button kind="primary" onClick={async () => {
          const r = await exportQueries(visibleQueries, {});
          setFlash(r.ok ? { tone: "ok", text: `Exported ${visibleQueries.length} queries to Excel. The export is recorded in the audit log.` } : { tone: "error", text: r.error });
        }}>Export all queries to Excel</Button>}
      />
      {flash && <div className="mb-4"><Notice tone={flash.tone}>{flash.text}</Notice></div>}
      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* A ledger with a total line under the accountant's double rule. */}
        <Panel title="By status">
          <table className="w-full text-sm">
            <caption className="sr-only">Queries by status</caption>
            <tbody>
              {counts.map(([s, n]) => (
                <tr key={s} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal"><StatusBadge status={s} /></th>
                  <td className="w-24 py-2.5" aria-hidden>
                    <div className="h-1.5 bg-ink/6"><div className="h-full bg-series rounded-r-[3px]" style={{ width: `${(n / max) * 100}%` }} /></div>
                  </td>
                  <td className="w-10 py-2.5 text-right font-medium">{n}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-rule">
                <th scope="row" className="pt-2.5 text-left font-medium">Total</th>
                <td />
                <td className="pt-2.5 text-right font-medium">{visibleQueries.length}</td>
              </tr>
            </tfoot>
          </table>
        </Panel>
        <Panel title="Overdue" aside={<span className="text-sm text-muted">{overdue.length} {overdue.length === 1 ? "query" : "queries"}, most overdue first</span>}>
          <Table head={["Query", "Auditor", "Deadline", "Days overdue"]} empty={!overdue.length && <div className="px-5 sm:px-6"><Empty title="Nothing is overdue">Every open query is within its deadline.</Empty></div>}>
            {overdue.map((q) => (
              <tr key={q.id} className="align-top">
                <td className="min-w-[15rem]"><Link to={`/queries/${q.id}`} className="group block"><Ref>{q.reference}</Ref><span className="block font-medium group-hover:text-lake group-hover:underline">{q.title}</span></Link></td>
                <td className={cx(!q.currentAssignee && "text-faint")}>{q.currentAssignee ? userName(q.currentAssignee) : "Not assigned"}</td>
                <td className="whitespace-nowrap">{fmtDate(q.deadline)}</td>
                <td className="w-40">
                  <span className="font-medium text-danger">{daysOverdue(q)}</span>
                  <div className="mt-1.5 h-1 bg-danger-wash" aria-hidden><div className="h-full bg-danger" style={{ width: `${(daysOverdue(q) / worst) * 100}%` }} /></div>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>
    </>
  );
}

function timeLeft(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.ceil((ms % 3_600_000) / 60_000);
  return h ? `${h} h ${m} min left` : `${m} min left`;
}

const RECORD_TYPES = ["Queries and follow-up", "Evidence files", "Audit log", "Import source files", "User accounts"];
const FAILED_LOGIN_ALERT = 5;

export function CompliancePage() {
  const { state, userName, decideAccess } = useStore();
  const [dialog, setDialog] = useState<{ id: string; approve: boolean } | null>(null);
  const [term, setTerm] = useState("");
  const failedLogins = state.audit.filter((e) => e.action === "auth.login_failed").length;
  const needle = term.trim().toLowerCase();
  const matches = needle.length >= 3
    ? state.queries.filter((q) => [q.responsibleOfficer, q.descriptionCurrent, q.title].some((t) => t.toLowerCase().includes(needle)))
    : [];
  const waiting = state.accessRequests.filter((a) => a.status === "Pending").length;
  const chainOk = useMemo(() => verifyChain(state.audit).ok, [state.audit]);

  return (
    <>
      <PageHeader title="Compliance" lede="ICT access to audit content, breaches, data subject requests and retention, in line with the Data Protection and Privacy Act." />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="ICT access requests" aside={waiting > 0 && <span className="text-sm font-medium text-warn">{waiting} waiting for you</span>}>
          {state.accessRequests.length ? (
            <ul className="divide-y divide-line">
              {state.accessRequests.map((a) => {
                const left = a.status === "Approved" && a.expiresAt ? timeLeft(a.expiresAt) : null;
                return (
                  <li key={a.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                    <span className="mt-1"><Check pending={a.status === "Pending"} ok={a.status === "Approved"} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="leading-relaxed">{a.reason}</p>
                      <p className="mt-1 text-sm text-muted">
                        {userName(a.requestedBy)} asked on {fmtDateTime(a.createdAt)}.{" "}
                        {a.status === "Pending" && <span className="font-medium text-warn">Waiting for your decision.</span>}
                        {a.status === "Approved" && (left ? <span className="font-medium text-good">Access open, {left}.</span> : <span>Access ended {fmtDateTime(a.expiresAt!)}.</span>)}
                        {a.status === "Rejected" && <span className="text-danger">Refused by {userName(a.decidedBy)}.</span>}
                      </p>
                      {a.status === "Pending" && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button kind="primary" onClick={() => setDialog({ id: a.id, approve: true })}>Approve for 2 hours</Button>
                          <Button kind="danger" onClick={() => setDialog({ id: a.id, approve: false })}>Refuse</Button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty title="No access requests">If ICT needs to open audit content to fix a problem, their request appears here.</Empty>
          )}
        </Panel>

        <Panel title="Breach register">
          <ul className="divide-y divide-line text-sm">
            <li className="flex items-start gap-3 pb-3">
              <span className="mt-0.5"><Check ok={failedLogins < FAILED_LOGIN_ALERT} pending={failedLogins > 0 && failedLogins < FAILED_LOGIN_ALERT} /></span>
              <span className="flex-1">Failed sign-ins<span className="block text-muted">An alert is raised at {FAILED_LOGIN_ALERT} or more.</span></span>
              <span className="font-medium">{failedLogins}</span>
            </li>
            <li className="flex items-start gap-3 py-3">
              <span className="mt-0.5"><Check ok /></span>
              <span className="flex-1">Unusual download volume<span className="block text-muted">Checked against each user's normal exports.</span></span>
              {/* Placeholder until the backend computes download volume. */}
              <span className="text-muted">No alert</span>
            </li>
            <li className="flex items-start gap-3 pt-3">
              <span className="mt-0.5"><Check ok={chainOk} /></span>
              <span className="flex-1">Audit chain verification<span className="block text-muted">A failure writes a draft entry here.</span></span>
              <span className={chainOk ? "text-muted" : "font-medium text-danger"}>{chainOk ? "Intact" : "Broken"}</span>
            </li>
          </ul>
          <div className="mt-5"><Empty title="No breaches recorded">If one is detected, record what happened, who was affected, what was done and when the PDPO was told.</Empty></div>
        </Panel>

        <Panel title="Data subject search">
          <Label htmlFor="ds">Name or other detail</Label>
          <input id="ds" type="search" className="field" placeholder="At least 3 characters" value={term} onChange={(e) => setTerm(e.target.value)} />
          <div className="mt-4" aria-live="polite">
            {needle.length < 3 ? (
              <p className="text-sm text-muted">Find every query that mentions a person, to answer an access or correction request.</p>
            ) : matches.length ? (
              <>
                <p className="mb-2 text-sm text-muted">{matches.length} {matches.length === 1 ? "query mentions" : "queries mention"} "{term.trim()}"</p>
                <ul className="divide-y divide-line">
                  {matches.map((q) => (
                    <li key={q.id} className="py-2.5"><Link to={`/queries/${q.id}`} className="group block"><Ref>{q.reference}</Ref> <span className="font-medium group-hover:underline">{q.title}</span></Link></li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted">No queries mention "{term.trim()}".</p>
            )}
          </div>
        </Panel>

        <Panel title="Retention rules">
          <Notice tone="warn">Retention periods are waiting for the owner's decision. Records cannot be disposed of until they are approved.</Notice>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b-[1.5px] border-ink/70 text-left text-[0.8125rem] text-muted"><th className="pb-2 font-medium">Record type</th><th className="pb-2 text-right font-medium">Keep for</th></tr>
            </thead>
            <tbody>
              {RECORD_TYPES.map((t) => (
                <tr key={t} className="border-b border-line last:border-0">
                  <td className="py-2.5">{t}</td>
                  <td className="py-2.5 text-right"><span className="inline-flex items-center gap-1.5 text-warn"><Check pending />Not set</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <ReasonDialog
        open={!!dialog}
        title={dialog?.approve ? "Approve ICT access for 2 hours" : "Refuse ICT access"}
        description={dialog?.approve ? "ICT can read audit content for 2 hours. Everything they open is logged." : "Tell ICT why the request is refused."}
        confirmLabel={dialog?.approve ? "Approve for 2 hours" : "Refuse"}
        danger={!dialog?.approve}
        optional={dialog?.approve}
        onConfirm={async (reason) => { const r = await decideAccess(dialog!.id, dialog!.approve, reason); return r.ok ? null : r.error; }}
        onClose={() => setDialog(null)}
      />
    </>
  );
}
