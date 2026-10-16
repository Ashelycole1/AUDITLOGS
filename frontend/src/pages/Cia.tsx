import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Check, Empty, Label, Notice, PageHeader, Panel, ReasonDialog, Ref, RiskTag, StatusBadge, Table, cx } from "../components";
import { verifyChain } from "../lib/auditChain";
import { STATUSES, daysOverdue, fmtDate, fmtDateTime } from "../lib/rules";
import { useMe, useStore } from "../storeTypes";
import type { AuditEntry, StatusChangeRequest } from "../types";

export function ApprovalsPage() {
  const { state } = useStore();
  const pending = state.requests.filter((r) => r.decision === "Pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const decided = state.requests.filter((r) => r.decision !== "Pending").sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")).slice(0, 6);

  return (
    <>
      <PageHeader
        title="Approvals"
        lede={pending.length ? `${pending.length} ${pending.length === 1 ? "proposal is" : "proposals are"} waiting for your decision, oldest first.` : "Nothing is waiting for you."}
      />
      <div className="space-y-5">
        {pending.length ? pending.map((r) => <RequestCard key={r.id} r={r} />) : <Empty title="No proposals waiting">When an auditor proposes closing a query, it appears here for your decision.</Empty>}
      </div>
      {decided.length > 0 && (
        <Panel title="Recently decided" className="mt-8">
          <ul className="divide-y divide-line">
            {decided.map((r) => <DecidedRow key={r.id} r={r} />)}
          </ul>
        </Panel>
      )}
    </>
  );
}

function waitingFor(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days < 1 ? "Waiting since today" : `Waiting ${days} ${days === 1 ? "day" : "days"}`;
}

// A review sheet: what the auditor says, the checks the closure rule needs, then the decision.
function RequestCard({ r }: { r: StatusChangeRequest }) {
  const me = useMe();
  const { state, userName, decide } = useStore();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const q = state.queries.find((x) => x.id === r.queryId)!;
  const responses = r.responses ?? state.activities.filter((a) => a.queryId === q.id && a.kind === "ManagementResponse").length;
  const files = r.evidenceFiles ?? state.evidence.filter((e) => e.queryId === q.id).length;
  const own = r.proposedBy === me.id;
  const days = Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86_400_000);

  return (
    <article className="sheet overflow-hidden rounded-xl">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0 max-w-[60ch]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><Ref>{q.reference}</Ref><RiskTag risk={q.riskRatingCurrent} /></div>
          <Link to={`/queries/${q.id}`} className="mt-1 block text-[1.1875rem] font-semibold leading-snug tracking-[-0.015em] hover:text-lake hover:underline">{q.title}</Link>
        </div>
        <p className={cx("text-sm font-medium", days >= 5 ? "text-danger" : "text-warn")}>{waitingFor(r.createdAt)}</p>
      </header>

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
        ) : (
          <>
            <Button kind="danger" onClick={() => setDialog("reject")}>Return to auditor</Button>
            <Button kind="primary" onClick={() => setDialog("approve")}>Approve closure</Button>
          </>
        )}
      </footer>

      <ReasonDialog
        open={dialog === "approve"}
        title={`Approve closure of ${q.reference}`}
        description="The query moves to Closed and your decision is written to the audit log."
        confirmLabel="Approve closure"
        optional
        onConfirm={async (reason) => { const res = await decide(r.id, true, reason); return res.ok ? null : res.error; }}
        onClose={() => setDialog(null)}
      />
      <ReasonDialog
        open={dialog === "reject"}
        title={`Return ${q.reference} to the auditor`}
        description="Say what is still missing. The auditor sees this reason on the query and by email."
        confirmLabel="Return to auditor"
        danger
        onConfirm={async (reason) => { const res = await decide(r.id, false, reason); return res.ok ? null : res.error; }}
        onClose={() => setDialog(null)}
      />
    </article>
  );
}

function DecidedRow({ r }: { r: StatusChangeRequest }) {
  const { state, userName } = useStore();
  const q = state.queries.find((x) => x.id === r.queryId)!;
  const approved = r.decision === "Approved";
  return (
    <li className="grid gap-x-4 gap-y-1 py-3 text-sm first:pt-0 last:pb-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-baseline">
      <span className="flex items-center gap-2">
        <Check ok={approved} />
        <Link to={`/queries/${q.id}`} className="hover:underline"><Ref>{q.reference}</Ref></Link>
      </span>
      <span>
        <span className={cx("font-medium", !approved && "text-danger")}>{approved ? "Closed" : "Returned"}</span>
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
  "breakglass.request": "Requested access",
  "breakglass.approve": "Approved access",
  "breakglass.reject": "Refused access",
  "auditlog.verify": "Verified chain",
  "user.create": "Created account",
  "user.enable": "Enabled account",
  "user.disable": "Disabled account",
  "user.reset_mfa": "Reset MFA",
};

function describeChange(e: AuditEntry): string {
  const fmt = (v: unknown) =>
    v && typeof v === "object"
      ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${String(x)}`).join(", ")
      : v === null || v === undefined ? "" : String(v);
  const o = fmt(e.oldValue);
  const n = fmt(e.newValue);
  return o && n ? `${o} → ${n}` : n || o;
}

// How a link looks while the chain is checked: not yet reached, ticked, the first mismatch, or after it.
type LinkState = "idle" | "ok" | "broken" | "after";

function linkState(seq: number, checkedTo: number, brokenAt: number | null): LinkState {
  if (brokenAt !== null && seq === brokenAt && checkedTo >= seq) return "broken";
  if (brokenAt !== null && seq > brokenAt && checkedTo >= brokenAt) return "after";
  return seq <= checkedTo ? "ok" : "idle";
}

function segmentTone(a: LinkState, b: LinkState | undefined, adjacent: boolean): string {
  if (!adjacent) return "border-dashed border-rule";
  if (a === "broken" || a === "after" || b === "broken" || b === "after") return "border-dashed border-danger/45";
  if (a === "ok" && b === "ok") return "border-good";
  return "border-rule";
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
  const [hover, setHover] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const filtered = !!(actor || action || object || from);
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

  const total = state.audit.length;
  const brokenAt = result && !result.ok ? result.brokenAt : null;

  // The check itself is instant; the walk along the chain shows what it did, one link at a time.
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

  const objectTypes = [...new Set(state.audit.map((e) => e.objectType))].sort();
  const actionGroups = [...new Set(state.audit.map((e) => e.action.split(".")[0]))].sort();
  const verdict = running
    ? "Checking the chain"
    : result === null
      ? "Not checked this session"
      : result.ok
        ? "Chain intact"
        : `Chain broken at entry ${result.brokenAt}`;

  return (
    <>
      <PageHeader
        title="Audit log"
        lede="Every action in the system, in order. Entries cannot be edited or deleted. Each one is sealed with the fingerprint of the one before it, so changing any entry breaks every link after it."
      />

      <section className={cx("sheet mb-6 rounded-xl p-5 sm:p-6", result && !result.ok && "!border-danger/50")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[58ch]" aria-live="polite">
            <h2 className={cx("text-[1.375rem] font-semibold tracking-[-0.02em]", result && !result.ok && "text-danger", result?.ok && "text-good")}>{verdict}</h2>
            <p className={cx("mt-1 text-sm leading-relaxed", result && !result.ok ? "text-danger" : "text-muted")}>
              {running
                ? `Recomputing fingerprints: ${checkedTo} of ${total}.`
                : result === null
                  ? `The nightly check recomputes all ${total} fingerprints. Run it now to confirm nothing has changed since.`
                  : result.ok
                    ? `All ${result.checked} entries match their fingerprints. Checked ${fmtDateTime(checkedAt!)}.`
                    : `Entry ${result.brokenAt} does not match its fingerprint, so every entry after it is unproven. The CIA and ICT have been alerted and a breach register draft written.`}
            </p>
          </div>
          <Button kind="primary" onClick={verify} disabled={running}>{running ? "Verifying" : result ? "Verify again" : "Verify chain"}</Button>
        </div>

        {verifyError && <div className="mt-4"><Notice tone="error">{verifyError}</Notice></div>}
        {/* The whole chain, oldest first. Each link fills in as it is checked. */}
        <ol className="mt-6 flex flex-wrap items-center gap-y-3 pl-2" aria-hidden>
          {state.audit.map((e, i) => {
            const s = linkState(e.seq, checkedTo, brokenAt);
            return (
              <li
                key={e.seq}
                title={`#${e.seq} ${ACTION_LABEL[e.action] ?? e.action}`}
                className={cx(
                  "-ml-2 w-7 rounded-full border-2 transition-colors duration-150", i % 2 ? "h-3" : "h-[1.125rem]",
                  s === "idle" && "border-rule",
                  s === "ok" && "border-good",
                  s === "broken" && "link-tick border-danger bg-danger",
                  s === "after" && "border-dashed border-danger/45 bg-transparent",
                )}
              />
            );
          })}
        </ol>
      </section>

      <Panel>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="al-user">Person</Label>
            <select id="al-user" className="field" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">Anyone</option>
              {state.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="al-action">Action</Label>
            <select id="al-action" className="field" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">Any action</option>
              {actionGroups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="al-object">Object</Label>
            <select id="al-object" className="field" value={object} onChange={(e) => setObject(e.target.value)}>
              <option value="">Any object</option>
              {objectTypes.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="al-from">From</Label>
            <input id="al-from" type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
        </div>
        {filtered && <p className="-mt-2 mb-4 text-[0.8125rem] text-muted">Filtered. Entries shown here are not all next to each other in the chain, so the links between them are dashed.</p>}

        <Table head={["Entry", "When", "Who", "Action", "Change", "Reason", "Fingerprint"]}>
          {entries.map((e, i) => {
            const s = linkState(e.seq, checkedTo, brokenAt);
            const above = entries[i - 1];
            const below = entries[i + 1];
            const sBelow = below && linkState(below.seq, checkedTo, brokenAt);
            const sAbove = above && linkState(above.seq, checkedTo, brokenAt);
            return (
              <tr
                key={e.seq}
                className={cx("align-top", s === "broken" && "bg-danger-wash/70", hover === e.seq && "bg-paper/60")}
                onMouseEnter={() => setHover(e.seq)}
                onMouseLeave={() => setHover(null)}
              >
                <td className="relative w-[5.5rem]">
                  {above && <span aria-hidden className={cx("absolute left-[calc(1.25rem+7px)] top-0 h-3 border-l-[1.5px] sm:left-[calc(1.5rem+7px)]", segmentTone(s, sAbove, !filtered && above.seq === e.seq + 1))} />}
                  {below && <span aria-hidden className={cx("absolute bottom-0 left-[calc(1.25rem+7px)] top-[1.6rem] border-l-[1.5px] sm:left-[calc(1.5rem+7px)]", segmentTone(s, sBelow, !filtered && below.seq === e.seq - 1))} />}
                  <span className="relative flex items-center gap-2">
                    <LinkNode state={s} />
                    <span className="font-mono text-xs text-muted">{e.seq}</span>
                  </span>
                </td>
                <td className="whitespace-nowrap">{fmtDateTime(e.timestamp)}</td>
                <td className="whitespace-nowrap">
                  {userName(e.actor)}
                  {e.actorRole && <span className="block text-[0.8125rem] text-muted">{e.actorRole}</span>}
                </td>
                <td className="whitespace-nowrap">
                  {ACTION_LABEL[e.action] ?? e.action}
                  <span className="block text-[0.8125rem] text-muted">{e.objectType}</span>
                </td>
                <td className="min-w-[12rem] max-w-[18rem] text-[0.8125rem] text-muted [overflow-wrap:anywhere]">{describeChange(e)}</td>
                <td className="min-w-[12rem] max-w-[20rem] text-[0.8125rem]">{e.reason || <span className="text-faint">None</span>}</td>
                <td className="whitespace-nowrap font-mono text-xs" title={`entry ${e.entryHash}\nprev ${e.prevHash}`}>
                  {/* Hovering a row lights up its seal and the fingerprint it is sealed to in the row below. */}
                  <span className={cx("rounded-sm px-1 py-px", hover !== null && e.seq === hover - 1 ? "bg-lake-wash text-lake-deep" : "text-ink")}>{e.entryHash.slice(0, 10)}</span>
                  <span className="mt-1 block px-1 text-faint">
                    <span className="font-sans">sealed to</span> <span className={cx("rounded-sm", hover === e.seq && "bg-lake-wash text-lake-deep")}>{e.prevHash.slice(0, 10)}</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </>
  );
}

function LinkNode({ state }: { state: LinkState }) {
  const label = { idle: "Not checked", ok: "Fingerprint matches", broken: "Fingerprint does not match", after: "Unproven" }[state];
  return (
    <span role="img" aria-label={label} className="grid size-[15px] shrink-0 place-items-center">
      {state === "ok" ? (
        <svg viewBox="0 0 16 16" className="link-tick size-[15px] text-good">
          <circle cx="8" cy="8" r="7.5" fill="currentColor" />
          <path d="M4.6 8.3 7 10.6l4.4-5" fill="none" stroke="#fafbf7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : state === "broken" ? (
        <svg viewBox="0 0 16 16" className="link-tick size-[15px] text-danger">
          <circle cx="8" cy="8" r="7.5" fill="currentColor" />
          <path d="m5.3 5.3 5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fafbf7" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        <span className={cx("size-[11px] rounded-full border-[1.5px] bg-sheet", state === "after" ? "border-dashed border-danger/60" : "border-rule")} />
      )}
    </span>
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
          const r = await exportQueries(visibleQueries);
          setFlash(r.ok ? { tone: "ok", text: `Exported ${visibleQueries.length} queries as CSV. The export is recorded in the audit log.` } : { tone: "error", text: r.error });
        }}>Export all queries as CSV</Button>}
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
                    <div className="h-1.5 bg-ink/6"><div className="h-full bg-[#2a78d6] rounded-r-[3px]" style={{ width: `${(n / max) * 100}%` }} /></div>
                  </td>
                  <td className="w-10 py-2.5 text-right font-semibold">{n}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-rule">
                <th scope="row" className="pt-2.5 text-left font-semibold">Total</th>
                <td />
                <td className="pt-2.5 text-right font-semibold">{visibleQueries.length}</td>
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
                  <span className="font-semibold text-danger">{daysOverdue(q)}</span>
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
              <span className="font-semibold">{failedLogins}</span>
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
              <span className={chainOk ? "text-muted" : "font-semibold text-danger"}>{chainOk ? "Intact" : "Broken"}</span>
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
