import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Empty, PageHeader, Panel, Ref, RiskTag, Stat, StatusBadge, Table, cx } from "../components";
import { daysOverdue, dueWithin, fmtDate, fmtDateTime } from "../lib/rules";
import { useMe, useStore } from "../store";
import type { Query } from "../types";

// CEO sees the summary fields only (design.md 6): no evidence or response text.
export function OverviewPage() {
  const me = useMe();
  const { visibleQueries: all } = useStore();
  const open = all.filter((q) => q.status !== "Closed");
  const overdue = open.filter((q) => daysOverdue(q) > 0);
  const dueSoon = open.filter((q) => dueWithin(q, 7));
  const closed = all.length - open.length;

  const byDept = useMemo(() => group(all, (q) => q.department), [all]);
  const byOfficer = useMemo(() => group(all, (q) => q.responsibleOfficer), [all]);
  const attention = [...overdue.sort((a, b) => daysOverdue(b) - daysOverdue(a)), ...dueSoon];

  return (
    <>
      <PageHeader
        title={me.role === "CEO" ? "Overview" : "Progress"}
        lede={`${open.length} of ${all.length} queries are still open. ${overdue.length ? `${overdue.length} are past their deadline.` : "None are past their deadline."}`}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open" value={open.length} />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : undefined} />
        <Stat label="Due in the next 7 days" value={dueSoon.length} tone={dueSoon.length ? "warn" : undefined} />
        <Stat label="Closed" value={closed} />
      </div>

      <Panel title="Needs attention" className="mb-5" aside={<span className="text-sm text-muted">Overdue first, then due this week</span>}>
        <Table
          head={["Query", "Risk", "Status", "Responsible", "Deadline", "Overdue"]}
          empty={!attention.length && <div className="px-5 sm:px-6"><Empty title="Nothing overdue or due this week" /></div>}
        >
          {attention.map((q) => (
            <tr key={q.id} className="align-top">
              <td className="min-w-[16rem]">
                {me.role === "PIA" ? (
                  <Link to={`/queries/${q.id}`} className="hover:text-lake"><Ref>{q.reference}</Ref><span className="block font-medium">{q.title}</span></Link>
                ) : (
                  <><Ref>{q.reference}</Ref><span className="block font-medium">{q.title}</span></>
                )}
              </td>
              <td><RiskTag risk={q.riskRatingCurrent} /></td>
              <td><StatusBadge status={q.status} /></td>
              <td>{q.responsibleOfficer}</td>
              <td className="whitespace-nowrap">{fmtDate(q.deadline)}</td>
              <td className={cx("whitespace-nowrap", daysOverdue(q) > 0 ? "font-medium text-danger" : "text-faint")}>
                {daysOverdue(q) > 0 ? `${daysOverdue(q)} days` : "Due soon"}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown title="By department" rows={byDept} />
        <Breakdown title="By responsible officer" rows={byOfficer} />
      </div>
    </>
  );
}

type GroupRow = { name: string; total: number; open: number; overdue: number };

function group(qs: Query[], key: (q: Query) => string): GroupRow[] {
  const m = new Map<string, GroupRow>();
  for (const q of qs) {
    const k = key(q);
    const r = m.get(k) ?? { name: k, total: 0, open: 0, overdue: 0 };
    r.total++;
    if (q.status !== "Closed") r.open++;
    if (daysOverdue(q) > 0) r.overdue++;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
}

function Breakdown({ title, rows }: { title: string; rows: GroupRow[] }) {
  return (
    <Panel title={title}>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.name}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{r.name}</span>
              <span className="text-muted">
                {r.open} open{r.overdue > 0 && <span className="text-danger">, {r.overdue} overdue</span>}
              </span>
            </div>
            {/* Closed, open and overdue as one bar so the share of each is visible at a glance. */}
            <div className="mt-1.5 flex h-1.5 gap-px overflow-hidden rounded-full bg-ink/6" aria-hidden>
              <span className="bg-good" style={{ width: `${((r.total - r.open) / r.total) * 100}%` }} />
              <span className="bg-ink/22" style={{ width: `${((r.open - r.overdue) / r.total) * 100}%` }} />
              <span className="bg-danger" style={{ width: `${(r.overdue / r.total) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-good" />Closed</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-ink/22" />Open</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-danger" />Overdue</span>
      </p>
    </Panel>
  );
}

const CIA_ACTIONS: Record<string, string> = {
  "status.direct": "Changed status without a proposal",
  "query.edit": "Edited a query",
  "query.reassign": "Reassigned",
  "status.approve": "Closed a query",
};

// The control on the person who both edits and approves (design.md 11).
export function CiaActivityPage() {
  const { state, userName } = useStore();
  const [kind, setKind] = useState<string | null>(null);
  const all = state.audit.filter((e) => e.actorRole === "CIA" && e.action in CIA_ACTIONS).reverse();
  const rows = kind ? all.filter((e) => e.action === kind) : all;
  const ref = (id: string) => state.queries.find((q) => q.id === id)?.reference ?? "";

  const change = (o: unknown, n: unknown) => {
    const pick = (v: unknown) => (v && typeof v === "object" ? Object.values(v as Record<string, unknown>).map((x) => (typeof x === "string" && state.users.some((u) => u.id === x) ? userName(x) : String(x ?? "none"))).join(", ") : "");
    const a = pick(o);
    const b = pick(n);
    return a ? `${a} to ${b}` : b;
  };

  return (
    <>
      <PageHeader
        title="CIA activity"
        lede="Every change the Chief Internal Auditor made directly: edits, reassignments, closures and status changes made without an auditor's proposal. Read-only."
      />

      {/* One cell per kind of change. Each cell filters the register below. */}
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line lg:grid-cols-4" role="group" aria-label="Filter by kind of change">
        {Object.entries(CIA_ACTIONS).map(([action, label]) => {
          const n = all.filter((e) => e.action === action).length;
          const on = kind === action;
          return (
            <button
              key={action}
              type="button"
              aria-pressed={on}
              onClick={() => setKind(on ? null : action)}
              className={cx(
                "px-5 py-4 text-left transition-colors",
                on ? "bg-spine text-sheet" : "bg-sheet hover:bg-white",
              )}
            >
              <span className={cx("block text-[2rem] font-semibold leading-none tracking-[-0.03em]", !on && action === "status.direct" && n > 0 && "text-warn")}>{n}</span>
              <span className={cx("mt-2 block text-sm", on ? "text-spine-ink" : "text-muted")}>{label}</span>
            </button>
          );
        })}
      </div>

      <Panel
        title={kind ? CIA_ACTIONS[kind] : "All direct changes"}
        aside={kind && <Button kind="quiet" onClick={() => setKind(null)}>Show all changes</Button>}
      >
        <Table head={["When", "What", "Query", "Change", "Reason"]} empty={!rows.length && <div className="px-5 sm:px-6"><Empty title="No direct CIA changes">Changes the CIA makes without a proposal appear here as they happen.</Empty></div>}>
          {rows.map((e) => {
            const direct = e.action === "status.direct";
            return (
              <tr key={e.seq} className={cx("align-top", direct && "bg-warn-wash/50")}>
                <td className="whitespace-nowrap">{fmtDateTime(e.timestamp)}<span className="block text-[0.8125rem] text-muted">{userName(e.actor)}</span></td>
                <td className="min-w-[11rem]">
                  <span className={cx(direct && "font-medium text-warn")}>{CIA_ACTIONS[e.action]}</span>
                </td>
                <td><Ref>{ref(e.objectId)}</Ref></td>
                <td className="min-w-[10rem] text-muted">{change(e.oldValue, e.newValue)}</td>
                <td className="min-w-[14rem] max-w-[26rem]">
                  {/* A reason is optional when approving a closure; for every other direct change it is required. */}
                  {e.reason || (e.action === "status.approve" ? <span className="text-faint">None given</span> : <span className="font-medium text-danger">No reason given</span>)}
                </td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </>
  );
}
