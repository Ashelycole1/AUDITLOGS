import { useMemo, useState } from "react";
import { Button, Empty, Label, PageHeader, Panel, Ref, StatusBadge, Table, cx } from "../components";
import { daysOverdue, fmtDate, fmtDateTime } from "../lib/rules";
import { useStore } from "../storeTypes";
import type { Query } from "../types";
import { CommentDialog } from "./Comments";

const CIA_ACTIONS: Record<string, string> = {
  "status.direct": "Changed status without a proposal",
  "query.edit": "Edited a query",
  "query.reassign": "Reassigned",
  "reassign.approve": "Approved a reassignment",
  "status.approve": "Closed a query",
};

// The control on the person who both edits and approves (design.md 11).
export function CiaActivityPage() {
  const { state, userName } = useStore();
  const [kind, setKind] = useState<string | null>(null);
  const [commentOn, setCommentOn] = useState<Query | null>(null);
  const all = state.audit.filter((e) => e.actorRole === "CIA" && e.action in CIA_ACTIONS).reverse();
  const rows = kind ? all.filter((e) => e.action === kind) : all;
  const queryOf = (id: string) => state.queries.find((q) => q.id === id);

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
        lede="Every change the Chief Internal Auditor made directly: edits, reassignments, closures and status changes made without an auditor's proposal. You can comment on any of them."
      />

      {/* One cell per kind of change. Each cell filters the register below. */}
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Filter by kind of change">
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
                on ? "bg-lake text-on-accent" : "bg-sheet hover:bg-subtle",
              )}
            >
              <span className={cx("block text-[2rem] font-medium leading-none tracking-[-0.03em]", !on && action === "status.direct" && n > 0 && "text-warn")}>{n}</span>
              <span className={cx("mt-2 block text-sm", on ? "text-on-accent/80" : "text-muted")}>{label}</span>
            </button>
          );
        })}
      </div>

      <Panel
        title={kind ? CIA_ACTIONS[kind] : "All direct changes"}
        aside={kind && <Button kind="quiet" onClick={() => setKind(null)}>Show all changes</Button>}
      >
        <Table head={["When", "What", "Query", "Change", "Reason", ""]} empty={!rows.length && <div className="px-5 sm:px-6"><Empty title="No direct CIA changes">Changes the CIA makes without a proposal appear here as they happen.</Empty></div>}>
          {rows.map((e) => {
            const direct = e.action === "status.direct";
            const q = queryOf(e.objectId);
            return (
              <tr key={e.seq} className={cx("align-top", direct && "bg-warn-wash/50")}>
                <td className="whitespace-nowrap">{fmtDateTime(e.timestamp)}<span className="block text-[0.8125rem] text-muted">{userName(e.actor)}</span></td>
                <td className="min-w-[11rem]">
                  <span className={cx(direct && "font-medium text-warn")}>{CIA_ACTIONS[e.action]}</span>
                </td>
                <td><Ref>{q?.reference ?? ""}</Ref></td>
                <td className="min-w-[10rem] text-muted">{change(e.oldValue, e.newValue)}</td>
                <td className="min-w-[14rem] max-w-[26rem]">
                  {/* A reason is optional when approving a closure; for every other direct change it is required. */}
                  {e.reason || (e.action === "status.approve" || e.action === "reassign.approve" ? <span className="text-faint">None given</span> : <span className="font-medium text-danger">No reason given</span>)}
                </td>
                <td className="text-right">{q && <Button kind="quiet" onClick={() => setCommentOn(q)}>Comment</Button>}</td>
              </tr>
            );
          })}
        </Table>
      </Panel>
      <CommentDialog q={commentOn} onClose={() => setCommentOn(null)} />
    </>
  );
}

// Who is responsible for what (owner, 2026-10-22): the department's responsible owner and the
// auditor working each query. The CEO can comment on any query from here.
export function PersonnelPage() {
  const { state, userName } = useStore();
  const [dept, setDept] = useState("");
  const [term, setTerm] = useState("");
  const [commentOn, setCommentOn] = useState<Query | null>(null);
  const departments = useMemo(() => [...new Set(state.queries.map((q) => q.department))].sort(), [state.queries]);
  const open = state.queries.filter((q) => q.status !== "Closed");
  const roleOf = (q: Query) => q.assigneeRole ?? state.users.find((u) => u.id === q.currentAssignee)?.role;

  const byDept = departments.map((d) => {
    const qs = state.queries.filter((q) => q.department === d);
    const live = qs.filter((q) => q.status !== "Closed");
    return {
      name: d,
      owners: [...new Set(qs.map((q) => q.responsibleOfficer))].sort(),
      auditors: [...new Set(live.map((q) => q.currentAssignee).filter((x): x is string => !!x))].map((id) => userName(id)).sort(),
      open: live.length,
      overdue: live.filter((q) => daysOverdue(q) > 0).length,
    };
  });

  const needle = term.trim().toLowerCase();
  const rows = open
    .filter((q) => (!dept || q.department === dept) && (!needle || [q.reference, q.title, q.responsibleOfficer, q.currentAssignee ? userName(q.currentAssignee) : ""].some((t) => t.toLowerCase().includes(needle))))
    .sort((a, b) => daysOverdue(b) - daysOverdue(a) || a.deadline.localeCompare(b.deadline));

  return (
    <>
      <PageHeader title="Responsible personnel" lede="Who answers for each open query: the responsible owner in the department, and the auditor following it up. Comment on any query; the auditor is notified." />

      <Panel title="By department" className="mb-5">
        <Table head={["Department", "Owner", "Auditors", "Open", "Overdue"]} empty={!byDept.length && <div className="px-5 sm:px-6"><Empty title="No queries yet" /></div>}>
          {byDept.map((d) => (
            <tr key={d.name} className="align-top">
              <td className="font-medium">{d.name}</td>
              <td>{d.owners.join(", ")}</td>
              <td className={cx(!d.auditors.length && "text-faint")}>{d.auditors.length ? d.auditors.join(", ") : "None"}</td>
              <td className="font-medium">{d.open}</td>
              <td className={cx("font-medium", d.overdue > 0 && "text-danger")}>{d.overdue}</td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Open queries" aside={<span className="text-sm text-muted">{rows.length} shown, most overdue first</span>}>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <div>
            <Label htmlFor="pp-dept">Department</Label>
            <select id="pp-dept" className="field" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="pp-search">Search</Label>
            <input id="pp-search" type="search" className="field" placeholder="Reference, title or a person" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
        </div>
        <Table head={["Query", "Auditor", "Status", "Deadline", ""]} empty={!rows.length && <div className="px-5 sm:px-6"><Empty title="No open queries match" /></div>}>
          {rows.map((q) => {
            const late = daysOverdue(q);
            return (
              <tr key={q.id} className="align-top">
                <td className="min-w-[16rem]">
                  <Ref>{q.reference}</Ref>
                  <span className="mt-0.5 block font-medium leading-snug">{q.title}</span>
                  <span className="mt-0.5 block text-[0.8125rem] text-muted">{q.department}</span>
                  <span className="block text-[0.8125rem] text-muted">Owner: {q.responsibleOfficer}</span>
                </td>
                <td className={cx(!q.currentAssignee && "text-faint")}>
                  {q.currentAssignee ? userName(q.currentAssignee) : "Not assigned"}
                  {roleOf(q) && <span className="block text-[0.8125rem] text-muted">{roleOf(q)}</span>}
                </td>
                <td><StatusBadge status={q.status} /></td>
                <td className="whitespace-nowrap">
                  {fmtDate(q.deadline)}
                  {late > 0 && <span className="block text-[0.8125rem] font-medium text-danger">{late} {late === 1 ? "day" : "days"} overdue</span>}
                </td>
                <td className="text-right"><Button kind="quiet" onClick={() => setCommentOn(q)}>Comment</Button></td>
              </tr>
            );
          })}
        </Table>
      </Panel>
      <CommentDialog q={commentOn} onClose={() => setCommentOn(null)} />
    </>
  );
}
