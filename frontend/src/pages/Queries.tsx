import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Empty, Label, Notice, PageHeader, Panel, ReasonDialog, Ref, RiskTag, StatusBadge, Table, cx } from "../components";
import { STATUSES, daysOverdue, fmtDate } from "../lib/rules";
import { useMe, useStore } from "../store";
import type { Query, Risk, Status } from "../types";

export default function QueriesPage() {
  const me = useMe();
  const { visibleQueries, state, userName, assign } = useStore();
  const [status, setStatus] = useState<Status | "">("");
  const [risk, setRisk] = useState<Risk | "">("");
  const [assignee, setAssignee] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTo, setBulkTo] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const isCia = me.role === "CIA";
  const isIa = me.role === "IA";
  const auditors = state.users.filter((u) => u.role === "IA" && u.isActive);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = visibleQueries.filter(
      (q) =>
        (!status || q.status === status) &&
        (!risk || q.riskRatingCurrent === risk) &&
        (!assignee || (assignee === "none" ? !q.currentAssignee : q.currentAssignee === assignee)) &&
        (!overdueOnly || daysOverdue(q) > 0) &&
        (!term || q.reference.toLowerCase().includes(term) || q.title.toLowerCase().includes(term) || q.descriptionCurrent.toLowerCase().includes(term)),
    );
    // Returned items come first for auditors (design.md 6), then the most overdue.
    return list.sort(
      (a, b) =>
        (isIa ? Number(b.status === "Returned") - Number(a.status === "Returned") : 0) ||
        Number(a.status === "Closed") - Number(b.status === "Closed") ||
        a.deadline.localeCompare(b.deadline),
    );
  }, [visibleQueries, status, risk, assignee, overdueOnly, search, isIa]);

  const unassigned = visibleQueries.filter((q) => !q.currentAssignee).length;
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const selectable = rows.filter((q) => !q.currentAssignee);

  const runBulk = (reason: string): string | null => {
    const errors: string[] = [];
    selected.forEach((id) => {
      const r = assign(id, bulkTo, reason);
      if (!r.ok) errors.push(r.error);
    });
    if (errors.length) return errors[0];
    setFlash(`Assigned ${selected.size} ${selected.size === 1 ? "query" : "queries"} to ${userName(bulkTo)}.`);
    setSelected(new Set());
    return null;
  };

  const title = isIa ? "My queries" : isCia ? "Queries" : "All queries";
  const lede = isIa
    ? "The queries assigned to you. Record follow-up work and propose closure when it is resolved."
    : isCia
      ? `${visibleQueries.length} queries in total. ${unassigned ? `${unassigned} still need an auditor.` : "Every query has an auditor."}`
      : "Read-only view of every confirmed query and where it stands.";

  const returned = isIa ? visibleQueries.filter((q) => q.status === "Returned").length : 0;

  return (
    <>
      <PageHeader title={title} lede={lede} />
      {returned > 0 && (
        <div className="mb-4">
          <Notice tone="error">
            {returned === 1 ? "One query was returned" : `${returned} queries were returned`} by the CIA. Read the reason on the query and continue the work.
          </Notice>
        </div>
      )}
      {flash && <div className="mb-4"><Notice tone="ok">{flash}</Notice></div>}

      <Panel>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr_auto] lg:items-end">
          <div>
            <Label htmlFor="q-search">Search</Label>
            <input id="q-search" className="field" placeholder="Reference or words in the finding" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="q-status">Status</Label>
            <select id="q-status" className="field" value={status} onChange={(e) => setStatus(e.target.value as Status | "")}>
              <option value="">Any status</option>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="q-risk">Risk</Label>
            <select id="q-risk" className="field" value={risk} onChange={(e) => setRisk(e.target.value as Risk | "")}>
              <option value="">Any risk</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </div>
          {!isIa ? (
            <div>
              <Label htmlFor="q-assignee">Auditor</Label>
              <select id="q-assignee" className="field" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Anyone</option>
                <option value="none">Not assigned</option>
                {auditors.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
            </div>
          ) : <div className="hidden lg:block" />}
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" className="size-4 accent-[#1f5741]" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Overdue only
          </label>
        </div>

        {isCia && selected.size > 0 && (
          <div className="glass-inset mb-4 flex flex-wrap items-center gap-3 rounded-md px-4 py-3">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <select className="field w-auto" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} aria-label="Assign to">
              <option value="">Choose an auditor</option>
              {auditors.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
            <Button kind="primary" disabled={!bulkTo} onClick={() => setBulkOpen(true)}>Assign selected</Button>
            <Button kind="quiet" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}

        <Table
          head={[
            ...(isCia ? [
              <input
                key="all"
                type="checkbox"
                aria-label="Select all unassigned"
                className="size-4 accent-[#1f5741]"
                disabled={!selectable.length}
                checked={selectable.length > 0 && selectable.every((q) => selected.has(q.id))}
                onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((q) => q.id)) : new Set())}
              />,
            ] : []),
            "Query",
            "Risk",
            "Status",
            ...(isIa ? [] : ["Auditor"]),
            "Deadline",
          ]}
          empty={!rows.length && (
            <div className="px-5 pb-2 sm:px-6">
              <Empty title={visibleQueries.length ? "No queries match these filters" : isIa ? "Nothing assigned to you yet" : "No queries yet"}>
                {visibleQueries.length ? "Clear a filter to see more." : isIa ? "The CIA will assign queries to you. You will get an email when they do." : "Confirmed imports appear here."}
              </Empty>
            </div>
          )}
        >
          {rows.map((q) => (
            <Row key={q.id} q={q} showAssignee={!isIa} selectable={isCia} selected={selected.has(q.id)} onToggle={() => toggle(q.id)} assigneeName={userName(q.currentAssignee)} />
          ))}
        </Table>
      </Panel>

      <ReasonDialog
        open={bulkOpen}
        title={`Assign ${selected.size} ${selected.size === 1 ? "query" : "queries"} to ${userName(bulkTo || null)}`}
        description="They will get an email for each query with its reference and a link."
        confirmLabel="Assign"
        optional
        onConfirm={runBulk}
        onClose={() => setBulkOpen(false)}
      />
    </>
  );
}

function Row({ q, showAssignee, selectable, selected, onToggle, assigneeName }: { q: Query; showAssignee: boolean; selectable: boolean; selected: boolean; onToggle: () => void; assigneeName: string }) {
  const late = daysOverdue(q);
  return (
    <tr className={cx("align-top transition-colors hover:bg-paper/60", q.status === "Returned" && "bg-danger-wash/40")}>
      {selectable && (
        <td className="w-10">
          {!q.currentAssignee && (
            <input type="checkbox" className="mt-1 size-4 accent-[#1f5741]" checked={selected} onChange={onToggle} aria-label={`Select ${q.reference}`} />
          )}
        </td>
      )}
      <td className="min-w-[18rem]">
        <Link to={`/queries/${q.id}`} className="group block">
          <Ref>{q.reference}</Ref>
          <span className="mt-0.5 block font-medium leading-snug group-hover:text-lake">{q.title}</span>
          <span className="mt-0.5 block text-[0.8125rem] text-muted">{q.department}</span>
        </Link>
      </td>
      <td><RiskTag risk={q.riskRatingCurrent} /></td>
      <td><StatusBadge status={q.status} /></td>
      {showAssignee && <td className={cx(!q.currentAssignee && "text-faint")}>{q.currentAssignee ? assigneeName : "Not assigned"}</td>}
      <td className="whitespace-nowrap">
        {fmtDate(q.deadline)}
        {late > 0 && <span className="block text-[0.8125rem] font-medium text-danger">{late} {late === 1 ? "day" : "days"} overdue</span>}
      </td>
    </tr>
  );
}
