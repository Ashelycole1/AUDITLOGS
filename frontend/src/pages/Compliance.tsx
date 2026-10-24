// Compliance (design.md 12, DECISIONS 36): break-glass access, the breach register, data subject
// requests, and retention with CIA-approved disposal. Everything but break-glass lives on the server only.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { Button, Check, Empty, Label, Notice, PageHeader, Panel, ReasonDialog, Ref, StatusBadge, cx } from "../components";
import { ROLE_NAME, fmtDate, fmtDateTime, isOpen } from "../lib/rules";
import { useMe, useStore } from "../storeTypes";
import type { AccessRequest, Role, Status } from "../types";

type Raw = Record<string, unknown>;
const message = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");
const str = (v: unknown) => (v == null ? "" : String(v));

export function timeLeft(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const mins = Math.ceil(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${m} min left` : `${m} min left`;
}

const hoursLabel = (h: number) => `${h} ${h === 1 ? "hour" : "hours"}`;

export function CompliancePage() {
  const { mode, state } = useStore();
  const waiting = state.accessRequests.filter((a) => a.status === "Pending").length;
  return (
    <>
      <PageHeader title="Compliance" lede="ICT access to audit content, breaches, data subject requests and retention, in line with the Data Protection and Privacy Act." />
      {mode === "demo" && <div className="mb-5"><Notice tone="info">The demo keeps break-glass requests only. Connect to the server for the breach register, subject requests and retention.</Notice></div>}
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="ICT access requests" aside={waiting > 0 && <span className="text-sm font-medium text-warn">{waiting} waiting for you</span>}>
          <AccessRequests />
        </Panel>
        {mode === "api" && <Disposals />}
        {mode === "api" && <BreachRegister />}
        {mode === "api" && <SubjectRequests />}
        {mode === "api" && <RetentionRules />}
      </div>
    </>
  );
}

// Break-glass ----------------------------------------------------------------------------------------

/** The CIA sees and decides every request; ICT sees its own. Either may end open access early. */
export function AccessRequests({ only }: { only?: "pending" }) {
  const me = useMe();
  const { state, userName, decideAccess, endAccess } = useStore();
  const [dialog, setDialog] = useState<{ a: AccessRequest; to: "approve" | "reject" | "end" } | null>(null);
  const isCia = me.role === "CIA";
  const rows = state.accessRequests
    .filter((a) => (isCia || a.requestedBy === me.id) && (only !== "pending" || a.status === "Pending"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (!rows.length)
    return <Empty title="No access requests">{isCia ? "If ICT needs to open audit content to fix a problem, their request appears here." : "Ask only when you must open audit content to fix a problem."}</Empty>;

  const hours = dialog ? hoursLabel(dialog.a.hours ?? 2) : "";
  return (
    <>
      <ul className="divide-y divide-line">
        {rows.map((a) => {
          const open = isOpen(a);
          const left = open ? timeLeft(a.expiresAt!) : null;
          return (
            <li key={a.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
              <span className="mt-1"><Check pending={a.status === "Pending"} ok={open} /></span>
              <div className="min-w-0 flex-1">
                <p className="leading-relaxed">{a.reason}</p>
                <p className="mt-1 text-sm text-muted">
                  {isCia ? `${userName(a.requestedBy)} asked` : "Asked"} on {fmtDateTime(a.createdAt)} for {hoursLabel(a.hours ?? 2)}.{" "}
                  {a.status === "Pending" && <span className="font-medium text-warn">{isCia ? "Waiting for your decision." : "Waiting for the CIA."}</span>}
                  {open && <span className="font-medium text-good">Open, approved by {userName(a.decidedBy)}, {left}.</span>}
                  {!open && (a.status === "Approved" || a.status === "Ended") && <span>Ended {fmtDateTime(a.endedAt ?? a.expiresAt!)}.</span>}
                  {a.status === "Rejected" && <span className="text-danger">Refused by {userName(a.decidedBy)}{a.decisionReason ? `: ${a.decisionReason}` : "."}</span>}
                </p>
                {a.status !== "Pending" && a.status !== "Rejected" && a.reads !== undefined && (
                  <p className="mt-0.5 text-sm text-muted">{a.reads} {a.reads === 1 ? "read" : "reads"} of audit content, each recorded in the audit log.</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2 empty:hidden">
                  {isCia && a.status === "Pending" && (
                    <>
                      <Button kind="primary" onClick={() => setDialog({ a, to: "approve" })}>Approve for {hoursLabel(a.hours ?? 2)}</Button>
                      <Button kind="danger" onClick={() => setDialog({ a, to: "reject" })}>Refuse</Button>
                    </>
                  )}
                  {open && <Button kind="secondary" onClick={() => setDialog({ a, to: "end" })}>End access now</Button>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <ReasonDialog
        open={!!dialog}
        title={dialog?.to === "approve" ? `Approve ICT access for ${hours}` : dialog?.to === "reject" ? "Refuse ICT access" : "End ICT access now"}
        description={
          dialog?.to === "approve"
            ? `ICT can read audit content, but change nothing, for ${hours}. Everything they open is logged.`
            : dialog?.to === "reject" ? "Tell ICT why the request is refused." : "Access stops at once. Nothing already logged is removed."
        }
        confirmLabel={dialog?.to === "approve" ? "Approve" : dialog?.to === "reject" ? "Refuse" : "End access"}
        danger={dialog?.to !== "approve"}
        optional={dialog?.to !== "reject"}
        onConfirm={async (reason) => {
          const r = dialog!.to === "end" ? await endAccess(dialog!.a.id) : await decideAccess(dialog!.a.id, dialog!.to === "approve", reason);
          return r.ok ? null : r.error;
        }}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

// Retention and disposal ------------------------------------------------------------------------------

type Rule = { recordType: string; label: string; months: number | null; approvedBy: string; approvedAt: string; reason: string };

function RetentionRules() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [months, setMonths] = useState("");

  const load = () =>
    api.get<Raw[]>("/retention-rules").then((rows) =>
      setRules(rows.map((r) => {
        const rule = r.rule as Raw | null;
        return { recordType: str(r.record_type), label: str(r.label), months: rule ? Number(rule.retention_months) : null, approvedBy: str(rule?.approved_by_name), approvedAt: str(rule?.approved_at), reason: str(rule?.reason) };
      })),
    ).catch((e) => setError(message(e)));
  useEffect(() => { load(); }, []);

  const unset = rules?.filter((r) => r.months === null).length ?? 0;
  return (
    <Panel title="Retention rules" subtitle="How long each record type is kept after it is finished">
      {error && <Notice tone="error">{error}</Notice>}
      {unset > 0 && <Notice tone="warn">{unset === rules!.length ? "No periods are set yet" : `${unset} ${unset === 1 ? "period is" : "periods are"} not set`}. Records of that type are never flagged for disposal.</Notice>}
      <ul className="mt-3 divide-y divide-line text-sm">
        {rules?.map((r) => (
          <li key={r.recordType} className="py-3 last:pb-0">
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 font-medium">
                {r.label}
                {r.months !== null && <span className="ml-2 font-mono font-normal">{r.months} months</span>}
              </p>
              <Button kind="quiet" className="-my-2" onClick={() => { setEditing(r); setMonths(r.months ? String(r.months) : ""); }}>{r.months !== null ? "Change" : "Set"}</Button>
            </div>
            {r.months !== null ? (
              <p className="text-muted">Set by {r.approvedBy} on {fmtDate(r.approvedAt)}: {r.reason}</p>
            ) : (
              <p className="text-warn">Not set</p>
            )}
          </li>
        ))}
      </ul>

      <ReasonDialog
        open={!!editing}
        title={`Keep ${editing?.label.toLowerCase()} for`}
        description="Counted from when a query closed or an import was finished. The weekly check then lists what is due, and nothing goes until you approve it."
        confirmLabel="Save rule"
        onConfirm={async (reason) => {
          try {
            await api.post("/retention-rules", { record_type: editing!.recordType, retention_months: Number(months), reason });
            await load();
            return null;
          } catch (e) {
            return message(e);
          }
        }}
        onClose={() => setEditing(null)}
      >
        <Label htmlFor="rr-months">Months</Label>
        <input id="rr-months" type="number" inputMode="numeric" min={1} className="field mb-3 w-32" value={months} onChange={(e) => setMonths(e.target.value)} />
      </ReasonDialog>
    </Panel>
  );
}

type Disposal = { id: string; typeLabel: string; label: string; since: string; months: number; status: "Pending" | "Disposed" | "Rejected"; approvedBy: string; reason: string; decidedAt: string; disposedAt: string };

function Disposals() {
  const [items, setItems] = useState<Disposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ d: Disposal; approve: boolean } | null>(null);

  const load = () =>
    api.get<Raw[]>("/disposals").then((rows) =>
      setItems(rows.map((d) => ({
        id: str(d.id), typeLabel: str(d.record_type_label), label: str(d.label), since: str(d.since), months: Number(d.retention_months),
        status: d.status as Disposal["status"], approvedBy: str(d.approved_by_name), reason: str(d.reason), decidedAt: str(d.decided_at), disposedAt: str(d.disposed_at),
      }))),
    ).catch((e) => setError(message(e)));
  useEffect(() => { load(); }, []);

  const check = async () => {
    try {
      const r = await api.post<{ flagged: number }>("/disposals/check");
      setFlash(r.flagged ? `${r.flagged} more ${r.flagged === 1 ? "record is" : "records are"} due for disposal.` : "Nothing new is due.");
      setError(null);
      await load();
    } catch (e) {
      setError(message(e));
    }
  };

  const pending = items?.filter((d) => d.status === "Pending") ?? [];
  const decided = items?.filter((d) => d.status !== "Pending").slice(0, 5) ?? [];
  return (
    <Panel title="Disposals" subtitle="Records past their retention period. Approving erases the content and keeps a stub." aside={<Button kind="secondary" onClick={check}>Check now</Button>}>
      {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}
      {flash && <div className="mb-3"><Notice tone="ok">{flash}</Notice></div>}
      {pending.length ? (
        <ul className="divide-y divide-line">
          {pending.map((d) => (
            <li key={d.id} className="py-3 first:pt-0">
              <p className="font-medium">{d.label}</p>
              <p className="text-sm text-muted">{d.typeLabel}, finished {fmtDate(d.since)}. Kept {d.months} months.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button kind="danger" onClick={() => setDialog({ d, approve: true })}>Dispose</Button>
                <Button kind="secondary" onClick={() => setDialog({ d, approve: false })}>Keep</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        items && <Empty title="Nothing due">The weekly check lists records here once their retention period has passed.</Empty>
      )}
      {decided.length > 0 && (
        <>
          <h3 className="mb-1 mt-5 text-sm font-medium text-muted">Recently decided</h3>
          <ul className="divide-y divide-line text-sm">
            {decided.map((d) => (
              <li key={d.id} className="flex items-start gap-2.5 py-2.5">
                <span className="mt-0.5"><Check ok={d.status === "Disposed"} /></span>
                <span className="min-w-0 flex-1">
                  {d.label}
                  <span className="block text-muted">{d.status === "Disposed" ? `Disposed ${fmtDate(d.disposedAt)}` : `Kept ${fmtDate(d.decidedAt)}`} by {d.approvedBy}: {d.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <ReasonDialog
        open={!!dialog}
        title={dialog?.approve ? `Dispose of ${dialog.d.label}` : `Keep ${dialog?.d.label}`}
        description={
          dialog?.approve
            ? "Its text, names, follow-up, comments and files are erased for good. A stub with the reference, dates and status stays, and the audit log is untouched."
            : "It stays, and is not listed again for a year."
        }
        confirmLabel={dialog?.approve ? "Dispose for good" : "Keep it"}
        danger={dialog?.approve}
        onConfirm={async (reason) => {
          try {
            await api.post(`/disposals/${dialog!.d.id}/${dialog!.approve ? "approve" : "reject"}`, { reason });
            await load();
            return null;
          } catch (e) {
            return message(e);
          }
        }}
        onClose={() => setDialog(null)}
      />
    </Panel>
  );
}

// Breach register -------------------------------------------------------------------------------------

type Breach = {
  id: string; kind: string; kindLabel: string; isDraft: boolean; detectedAt: string; description: string; dataAffected: string;
  peopleAffected: string; actionsTaken: string; pdpoNotifiedAt: string | null; closedAt: string | null; subjectName: string; recordedBy: string;
};
type BreachFields = Pick<Breach, "description" | "dataAffected" | "peopleAffected" | "actionsTaken"> & { detectedAt: string; pdpoNotifiedAt: string };

const toBreach = (b: Raw): Breach => ({
  id: str(b.id), kind: str(b.kind), kindLabel: str(b.kind_label), isDraft: b.is_draft === true, detectedAt: str(b.detected_at), description: str(b.description),
  dataAffected: str(b.data_affected), peopleAffected: str(b.people_affected), actionsTaken: str(b.actions_taken),
  pdpoNotifiedAt: b.pdpo_notified_at ? str(b.pdpo_notified_at) : null, closedAt: b.closed_at ? str(b.closed_at) : null,
  subjectName: str(b.subject_name), recordedBy: str(b.recorded_by_name),
});

// <input type="datetime-local"> works in local time without a zone.
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

const payload = (f: BreachFields) => ({
  description: f.description.trim(), data_affected: f.dataAffected.trim(), people_affected: f.peopleAffected.trim(), actions_taken: f.actionsTaken.trim(),
  pdpo_notified_at: fromLocal(f.pdpoNotifiedAt),
});

/** Kept by the CIA and ICT together (owner, 2026-10-24). Automatic checks open drafts for a person to complete. */
export function BreachRegister() {
  const [items, setItems] = useState<Breach[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ breach: Breach | null } | null>(null);
  const [closing, setClosing] = useState<Breach | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = () => api.get<Raw[]>("/breaches").then((rows) => setItems(rows.map(toBreach))).catch((e) => setError(message(e)));
  useEffect(() => { load(); }, []);

  const open = items?.filter((b) => !b.closedAt) ?? [];
  const closed = items?.filter((b) => b.closedAt) ?? [];
  const drafts = open.filter((b) => b.isDraft).length;
  return (
    <Panel
      title="Breach register"
      subtitle="What happened, who was affected, what was done and when the PDPO was told"
      aside={!form && <Button kind="secondary" onClick={() => setForm({ breach: null })}>Record a breach</Button>}
    >
      {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}
      {drafts > 0 && <div className="mb-3"><Notice tone="warn">{drafts} {drafts === 1 ? "entry was" : "entries were"} opened by an automatic check. Complete {drafts === 1 ? "it" : "them"}, or close {drafts === 1 ? "it" : "them"} with the reason if it was not a breach.</Notice></div>}
      {form && <BreachForm breach={form.breach} onDone={async () => { setForm(null); await load(); }} onCancel={() => setForm(null)} />}
      {!form && (open.length ? (
        <ul className="divide-y divide-line">
          {open.map((b) => <BreachItem key={b.id} b={b} onEdit={() => setForm({ breach: b })} onClose={() => setClosing(b)} />)}
        </ul>
      ) : (
        items && <Empty title="No open breaches">Failed chain checks, account lockouts and unusual download volume open a draft here automatically.</Empty>
      ))}
      {!form && closed.length > 0 && (
        <div className="mt-4">
          <button type="button" className="min-h-9 text-sm font-medium text-lake hover:underline" onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed}>
            {showClosed ? "Hide" : "Show"} {closed.length} closed
          </button>
          {showClosed && <ul className="divide-y divide-line">{closed.map((b) => <BreachItem key={b.id} b={b} />)}</ul>}
        </div>
      )}

      <ReasonDialog
        open={!!closing}
        title="Close this entry"
        description="Say what settled it, or why it was not a breach. The entry stays in the register."
        confirmLabel="Close entry"
        onConfirm={async (reason) => {
          try {
            await api.post(`/breaches/${closing!.id}/close`, { reason });
            await load();
            return null;
          } catch (e) {
            return message(e);
          }
        }}
        onClose={() => setClosing(null)}
      />
    </Panel>
  );
}

function BreachItem({ b, onEdit, onClose }: { b: Breach; onEdit?: () => void; onClose?: () => void }) {
  const field = (label: string, v: string) => (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className={cx("whitespace-pre-line", !v && "text-faint")}>{v || "Not recorded"}</dd>
    </>
  );
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{b.kindLabel}</span>
        {b.isDraft && <span className="rounded-full bg-warn-wash px-2 text-[0.75rem] font-medium leading-5 text-warn ring-1 ring-warn-ring">Draft</span>}
        {b.closedAt && <span className="text-[0.8125rem] text-muted">Closed {fmtDate(b.closedAt)}</span>}
      </div>
      <p className="mt-1 max-w-[70ch] whitespace-pre-line leading-relaxed">{b.description}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Detected</dt>
        <dd>{fmtDateTime(b.detectedAt)}{b.subjectName && <span className="text-muted">, account of {b.subjectName}</span>}</dd>
        {field("Data affected", b.dataAffected)}
        {field("People affected", b.peopleAffected)}
        {field("Actions taken", b.actionsTaken)}
        <dt className="text-muted">PDPO told</dt>
        <dd className={cx(!b.pdpoNotifiedAt && "text-faint")}>{b.pdpoNotifiedAt ? fmtDateTime(b.pdpoNotifiedAt) : "Not yet"}</dd>
      </dl>
      {b.recordedBy && <p className="mt-1 text-[0.8125rem] text-faint">Recorded by {b.recordedBy}</p>}
      {(onEdit || onClose) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onEdit && <Button kind="secondary" onClick={onEdit}>{b.isDraft ? "Complete" : "Update"}</Button>}
          {onClose && <Button kind="quiet" onClick={onClose}>Close</Button>}
        </div>
      )}
    </li>
  );
}

function BreachForm({ breach, onDone, onCancel }: { breach: Breach | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState<BreachFields>({
    description: breach?.description ?? "", dataAffected: breach?.dataAffected ?? "", peopleAffected: breach?.peopleAffected ?? "",
    actionsTaken: breach?.actionsTaken ?? "", detectedAt: toLocal(breach?.detectedAt ?? null), pdpoNotifiedAt: toLocal(breach?.pdpoNotifiedAt ?? null),
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof BreachFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (breach) await api.patch(`/breaches/${breach.id}`, { ...payload(f), reason });
      // When it was detected is fixed once recorded.
      else await api.post("/breaches", { ...payload(f), ...(f.detectedAt ? { detected_at: fromLocal(f.detectedAt) } : {}) });
      onDone();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const area = (k: keyof BreachFields, label: string, rows = 2) => (
    <div>
      <Label htmlFor={`br-${k}`}>{label}</Label>
      <textarea id={`br-${k}`} className="field" rows={rows} value={f[k]} onChange={set(k)} />
    </div>
  );
  return (
    <form onSubmit={save} className="space-y-3" noValidate>
      <h3 className="font-medium">{breach ? (breach.isDraft ? "Complete the draft" : "Update the entry") : "Record a breach"}</h3>
      {area("description", "What happened", 3)}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="br-detected">Detected</Label>
          <input id="br-detected" type="datetime-local" className="field" value={f.detectedAt} onChange={set("detectedAt")} disabled={!!breach} />
        </div>
        <div>
          <Label htmlFor="br-pdpo">PDPO told</Label>
          <input id="br-pdpo" type="datetime-local" className="field" value={f.pdpoNotifiedAt} onChange={set("pdpoNotifiedAt")} />
        </div>
      </div>
      {area("dataAffected", "Data affected")}
      {area("peopleAffected", "People affected")}
      {area("actionsTaken", "Actions taken")}
      {breach && (
        <div>
          <Label htmlFor="br-reason">Reason for the change</Label>
          <input id="br-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" disabled={busy}>{breach ? "Save changes" : "Record"}</Button>
        <Button kind="quiet" type="button" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// Data subject requests -------------------------------------------------------------------------------

type Found = {
  term: string;
  queries: { id: string; reference: string; title: string; status: Status; department: string; officer: string; disposedAt: string | null }[];
  people: { id: string; name: string; email: string; role: Role; active: boolean; entries: number }[];
};

function SubjectRequests() {
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Each search is logged with its term, so it runs on submit rather than on every keystroke.
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.get<Raw>(`/subject-search?q=${encodeURIComponent(term.trim())}`);
      setFound({
        term: str(r.term),
        queries: (r.queries as Raw[]).map((q) => ({ id: str(q.id), reference: str(q.reference), title: str(q.title), status: q.status as Status, department: str(q.department), officer: str(q.responsible_officer), disposedAt: q.disposed_at ? str(q.disposed_at) : null })),
        people: (r.people as Raw[]).map((p) => ({ id: str(p.id), name: str(p.full_name), email: str(p.email), role: p.role as Role, active: p.is_active !== false, entries: Number(p.log_entries ?? 0) })),
      });
      setError(null);
    } catch (err) {
      setFound(null);
      setError(message(err));
    }
  };

  const total = found ? found.queries.length + found.people.length : 0;
  return (
    <Panel title="Data subject requests" subtitle="Find what is held about a person, to answer an access or correction request">
      <form onSubmit={search} className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor="ds">Name, email or other detail</Label>
          <input id="ds" type="search" className="field" placeholder="At least 3 characters" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <Button kind="secondary" type="submit">Search</Button>
      </form>
      <p className="mt-2 text-[0.8125rem] text-faint">Each search is recorded in the audit log.</p>
      <div className="mt-4" aria-live="polite">
        {error && <Notice tone="error">{error}</Notice>}
        {found && (total ? (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">{total} {total === 1 ? "record mentions" : "records mention"} "{found.term}"</p>
              <Button kind="secondary" onClick={() => setExporting(true)}>Export to Excel</Button>
            </div>
            {found.people.length > 0 && (
              <ul className="mb-3 divide-y divide-line">
                {found.people.map((p) => (
                  <li key={p.id} className="py-2.5 text-sm">
                    <span className="font-medium">{p.name}</span> <span className="text-muted">{ROLE_NAME[p.role]}{!p.active && ", disabled"}</span>
                    <span className="block text-muted">{p.email}. {p.entries} audit log {p.entries === 1 ? "entry" : "entries"}.</span>
                  </li>
                ))}
              </ul>
            )}
            <ul className="divide-y divide-line">
              {found.queries.map((q) => (
                <li key={q.id} className="py-2.5">
                  <Link to={`/queries/${q.id}`} className="group block">
                    <Ref>{q.reference}</Ref> <span className="font-medium group-hover:underline">{q.title}</span>
                  </Link>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                    <StatusBadge status={q.status} />
                    {q.disposedAt ? `Disposed ${fmtDate(q.disposedAt)}` : `${q.department}, ${q.officer}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">Nothing held mentions "{found.term}".</p>
        ))}
      </div>

      <ReasonDialog
        open={exporting}
        title="Export what is held"
        description="An Excel workbook of the queries that mention the term. Say which request it answers."
        confirmLabel="Export"
        onConfirm={async (reason) => {
          try {
            await api.download("/subject-export", `subject-${new Date().toISOString().slice(0, 10)}.xlsx`, { q: found!.term, reason });
            return null;
          } catch (e) {
            return message(e);
          }
        }}
        onClose={() => setExporting(false)}
      />
    </Panel>
  );
}
