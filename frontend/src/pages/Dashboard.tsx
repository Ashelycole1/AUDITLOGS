import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CRITICAL, ChartCard, Columns, GOOD, Heatmap, LegendKey, Meter, SERIES, Sparkline, StackedRows, TrendChart, BarList, type Part } from "../charts";
import { Avatar, Empty, PageHeader, Ref, RiskTag, StatusBadge, cx } from "../components";
import { Icon, type IconName } from "../icons";
import { STATUSES, daysOverdue, dueWithin, fmtDate, fmtDateTime } from "../lib/rules";
import { useMe, useStore } from "../store";
import type { Query, Risk, Status } from "../types";
import { ACTION_LABEL } from "./Cia";

const DAY = 86_400_000;
const RISKS: Risk[] = ["High", "Medium", "Low"];
const OPEN_STATUSES: Status[] = ["Imported", "Assigned", "In Progress", "Proposed for Closure", "Returned"];
const short = (t: number) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Kampala" }).format(t);
const endOfDeadline = (q: Query) => new Date(q.deadline + "T23:59:59+03:00").getTime();

// Progress parts: closed is good, open within deadline is the plain series, overdue is critical.
const PROGRESS: Part[] = [
  { key: "closed", name: "Closed", color: GOOD },
  { key: "open", name: "Open, on time", color: SERIES },
  { key: "overdue", name: "Overdue", color: CRITICAL },
];

function progressOf(qs: Query[]) {
  const closed = qs.filter((q) => q.status === "Closed").length;
  const overdue = qs.filter((q) => daysOverdue(q) > 0).length;
  return { closed, overdue, open: qs.length - closed - overdue };
}

export default function DashboardPage() {
  const me = useMe();
  const { visibleQueries, state, userName } = useStore();
  const [dept, setDept] = useState("");
  const [risk, setRisk] = useState<Risk | "">("");

  const departments = [...new Set(visibleQueries.map((q) => q.department))].sort();
  // The filters above the charts scope every number on the page, so they always agree.
  const qs = useMemo(() => visibleQueries.filter((q) => (!dept || q.department === dept) && (!risk || q.riskRatingCurrent === risk)), [visibleQueries, dept, risk]);
  const importedAt = (q: Query) => new Date(state.batches.find((b) => b.id === q.batchId)?.confirmedAt ?? 0).getTime();

  // Daily open and overdue counts, rebuilt from import, deadline and closure dates.
  const trend = useMemo(() => {
    const now = Date.now();
    const first = Math.min(now, ...qs.map(importedAt));
    const start = Math.max(first, now - 90 * DAY);
    const days = Math.max(2, Math.ceil((now - start) / DAY) + 1);
    const labels: string[] = [];
    const open: number[] = [];
    const late: number[] = [];
    for (let i = 0; i < days; i++) {
      const t = Math.min(now, start + i * DAY);
      const live = qs.filter((q) => importedAt(q) <= t && (!q.closedAt || new Date(q.closedAt).getTime() > t));
      labels.push(short(t));
      open.push(live.length);
      late.push(live.filter((q) => endOfDeadline(q) < t).length);
    }
    return { labels, open, late };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, state.batches]);

  const openQs = qs.filter((q) => q.status !== "Closed");
  const overdueQs = openQs.filter((q) => daysOverdue(q) > 0).sort((a, b) => daysOverdue(b) - daysOverdue(a));
  const dueSoon = openQs.filter((q) => dueWithin(q, 7)).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const closed = qs.length - openQs.length;
  const pending = state.requests.filter((r) => r.decision === "Pending" && qs.some((q) => q.id === r.queryId));
  const ago = (arr: number[], n: number) => arr[Math.max(0, arr.length - 1 - n)];

  const isCia = me.role === "CIA";
  const isIa = me.role === "IA";
  const canOpen = me.role !== "CEO";
  const title = isIa ? "My dashboard" : "Dashboard";
  const lede = isIa
    ? "Your assigned queries at a glance."
    : me.role === "CEO"
      ? "Where audit queries stand across the organisation. Read-only."
      : "Where every audit query stands, what is late and what needs a decision.";

  const fourth: Tile = isCia
    ? { icon: "approvals", label: "Awaiting your decision", value: pending.length, note: pending.length ? `Oldest waiting ${Math.floor((Date.now() - new Date(pending.reduce((a, r) => (r.createdAt < a ? r.createdAt : a), pending[0].createdAt)).getTime()) / DAY)} days` : "Nothing waiting", to: "/approvals", tone: pending.length ? "warn" : undefined }
    : isIa
      ? { icon: "alert", label: "Returned to you", value: qs.filter((q) => q.status === "Returned").length, note: "Read the CIA's reason and continue", to: "/queries", tone: qs.some((q) => q.status === "Returned") ? "danger" : undefined }
      : { icon: "clock", label: "Due in the next 7 days", value: dueSoon.length, note: dueSoon[0] ? `Next: ${fmtDate(dueSoon[0].deadline)}` : "Nothing due this week", tone: dueSoon.length ? "warn" : undefined };

  const lateDelta = trend.late[trend.late.length - 1] - ago(trend.late, 30);
  const openDelta = trend.open[trend.open.length - 1] - ago(trend.open, 30);
  const span = Math.min(30, trend.open.length - 1);

  const aging = [
    { key: "a", label: "1–7 days", lo: 1, hi: 7 },
    { key: "b", label: "8–30 days", lo: 8, hi: 30 },
    { key: "c", label: "31–60 days", lo: 31, hi: 60 },
    { key: "d", label: "Over 60 days", lo: 61, hi: Infinity },
  ].map((b) => ({ ...b, value: overdueQs.filter((q) => daysOverdue(q) >= b.lo && daysOverdue(q) <= b.hi).length }));

  const byDept = departments
    .filter((d) => !dept || d === dept)
    .map((d) => ({ name: d, ...progressOf(qs.filter((q) => q.department === d)) }))
    .filter((r) => r.closed + r.open + r.overdue > 0)
    .sort((a, b) => b.overdue - a.overdue || b.open + b.overdue - (a.open + a.overdue));

  const auditors = state.users.filter((u) => u.role === "IA");
  const workload = auditors
    .map((u) => {
      const mine = openQs.filter((q) => q.currentAssignee === u.id);
      const late = mine.filter((q) => daysOverdue(q) > 0).length;
      return { id: u.id, name: u.fullName, open: mine.length - late, overdue: late };
    })
    .sort((a, b) => b.open + b.overdue - (a.open + a.overdue));
  const unassigned = openQs.filter((q) => !q.currentAssignee).length;

  const attention = [...overdueQs, ...dueSoon.filter((q) => daysOverdue(q) === 0)].slice(0, 8);
  const recent = isCia ? [...state.audit].reverse().filter((e) => !e.action.startsWith("auth.")).slice(0, 6) : [];

  return (
    <>
      <PageHeader title={title} lede={lede} />

      <div className="mb-6 flex flex-wrap items-end gap-3" role="group" aria-label="Filter the dashboard">
        {!isIa && (
          <select aria-label="Department" className="field w-auto min-w-48" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d}>{d}</option>)}
          </select>
        )}
        <select aria-label="Risk" className="field w-auto min-w-36" value={risk} onChange={(e) => setRisk(e.target.value as Risk | "")}>
          <option value="">All risk ratings</option>
          {RISKS.map((r) => <option key={r} value={r}>{r} risk</option>)}
        </select>
        {(dept || risk) && <button type="button" onClick={() => { setDept(""); setRisk(""); }} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-lake hover:bg-lake-wash">Clear filters</button>}
        <p className="ml-auto text-sm text-muted">{qs.length} {qs.length === 1 ? "query" : "queries"}{dept || risk ? " match these filters" : " in total"}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          icon="queries"
          label="Open queries"
          value={openQs.length}
          note={<Delta value={openDelta} days={span} upIsBad={false} />}
          spark={<Sparkline values={trend.open.slice(-30)} />}
          to={canOpen ? "/queries" : undefined}
        />
        <KpiTile
          icon="alert"
          label="Overdue"
          value={overdueQs.length}
          tone={overdueQs.length ? "danger" : undefined}
          note={<Delta value={lateDelta} days={span} upIsBad />}
          spark={<Sparkline values={trend.late.slice(-30)} color={CRITICAL} />}
        />
        <KpiTile
          icon="approvals"
          label="Closure rate"
          value={`${qs.length ? Math.round((closed / qs.length) * 100) : 0}%`}
          note={<span className="text-muted">{closed} of {qs.length} closed</span>}
          spark={<div className="pt-4"><Meter value={qs.length ? closed / qs.length : 0} color={GOOD} track="#dcfae6" label="Share of queries closed" /></div>}
        />
        <KpiTile {...fourth} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Open and overdue queries"
          subtitle="Daily count since the first import"
          legend={<><LegendKey color={SERIES} label="Open" line /><LegendKey color={CRITICAL} label="Overdue" line /></>}
          table={{ head: ["Date", "Open", "Overdue"], rows: trend.labels.map((l, i) => [l, trend.open[i], trend.late[i]]).reverse() }}
        >
          <TrendChart
            labels={trend.labels}
            series={[
              { name: "Open", color: SERIES, values: trend.open, area: true },
              { name: "Overdue", color: CRITICAL, values: trend.late },
            ]}
          />
        </ChartCard>

        <ChartCard title="Queries by status" subtitle="Where each query is in the workflow" table={{ head: ["Status", "Queries"], rows: STATUSES.map((s) => [s, qs.filter((q) => q.status === s).length]) }}>
          <BarList items={STATUSES.map((s) => ({ key: s, name: s, label: <StatusBadge status={s} />, value: qs.filter((q) => q.status === s).length }))} />
        </ChartCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-[1fr_1.4fr_1fr]">
        <ChartCard title="How late overdue queries are" subtitle={`${overdueQs.length} open queries past their deadline`} table={{ head: ["Days overdue", "Queries"], rows: aging.map((a) => [a.label, a.value]) }}>
          {overdueQs.length ? <Columns color={CRITICAL} items={aging.map((a) => ({ key: a.key, label: a.label, value: a.value, note: `${a.label} overdue` }))} /> : <Empty title="Nothing is overdue" icon="approvals">Every open query is within its deadline.</Empty>}
        </ChartCard>

        <ChartCard
          title="Open queries by risk"
          subtitle="Count per risk rating and status"
          table={{ head: ["Risk", ...OPEN_STATUSES], rows: RISKS.map((r) => [r, ...OPEN_STATUSES.map((s) => openQs.filter((q) => q.riskRatingCurrent === r && q.status === s).length)]) }}
        >
          <Heatmap
            rows={RISKS.map((r) => ({ key: r, name: r, label: <RiskTag risk={r} /> }))}
            cols={OPEN_STATUSES.map((s) => ({ key: s, name: s, label: s === "Proposed for Closure" ? "Proposed" : s === "In Progress" ? "In progress" : s }))}
            value={(r, c) => openQs.filter((q) => q.riskRatingCurrent === r && q.status === c).length}
          />
        </ChartCard>

        <ChartCard
          className="lg:col-span-2 xl:col-span-1"
          title="Progress by department"
          subtitle="Most overdue first"
          legend={PROGRESS.map((p) => <LegendKey key={p.key} color={p.color} label={p.name} />)}
          table={{ head: ["Department", "Closed", "Open, on time", "Overdue"], rows: byDept.map((d) => [d.name, d.closed, d.open, d.overdue]) }}
        >
          <StackedRows parts={PROGRESS} rows={byDept.map((d) => ({ key: d.name, name: d.name, label: d.name, values: { closed: d.closed, open: d.open, overdue: d.overdue } }))} />
        </ChartCard>
      </div>

      <div className={cx("mt-4 grid gap-4", isCia && "xl:grid-cols-3")}>
        <section className={cx("card min-w-0 rounded-xl", isCia && "xl:col-span-2")}>
          <header className="flex flex-wrap items-start justify-between gap-3 p-5 pb-4">
            <div>
              <h2 className="text-base font-semibold">Needs attention</h2>
              <p className="mt-0.5 text-sm text-muted">Overdue first, then queries due in the next 7 days</p>
            </div>
            {canOpen && <Link to="/queries" className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-semibold text-lake hover:bg-lake-wash">View all queries</Link>}
          </header>
          {attention.length ? (
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-subtle text-xs text-muted">
                  <tr>
                    <th className="py-2.5 pl-5 pr-3 font-medium">Query</th>
                    <th className="px-3 py-2.5 font-medium">Risk</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">{isCia ? "Auditor" : "Responsible"}</th>
                    <th className="py-2.5 pl-3 pr-5 text-right font-medium">Deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.map((q) => {
                    const late = daysOverdue(q);
                    return (
                      <tr key={q.id} className="border-t border-line hover:bg-subtle">
                        <td className="py-3 pl-5 pr-3">
                          {canOpen ? (
                            <Link to={`/queries/${q.id}`} className="group block"><Ref>{q.reference}</Ref><span className="block font-medium group-hover:text-lake">{q.title}</span></Link>
                          ) : (
                            <><Ref>{q.reference}</Ref><span className="block font-medium">{q.title}</span></>
                          )}
                        </td>
                        <td className="px-3 py-3"><RiskTag risk={q.riskRatingCurrent} /></td>
                        <td className="px-3 py-3"><StatusBadge status={q.status} /></td>
                        <td className={cx("px-3 py-3", isCia && !q.currentAssignee && "text-faint")}>{isCia ? (q.currentAssignee ? userName(q.currentAssignee) : "Not assigned") : q.responsibleOfficer}</td>
                        <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right">
                          {fmtDate(q.deadline)}
                          <span className={cx("block text-xs font-medium", late ? "text-danger" : "text-warn")}>{late ? `${late} ${late === 1 ? "day" : "days"} overdue` : "Due this week"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border-t border-line"><Empty title="Nothing needs attention" icon="approvals">No query is overdue or due in the next 7 days.</Empty></div>
          )}
        </section>

        {isCia && (
          <div className="grid gap-4">
            <ChartCard
              title="Auditor workload"
              subtitle={unassigned ? `${unassigned} open ${unassigned === 1 ? "query has" : "queries have"} no auditor yet` : "Every open query has an auditor"}
              legend={<><LegendKey color={SERIES} label="Open, on time" /><LegendKey color={CRITICAL} label="Overdue" /></>}
              table={{ head: ["Auditor", "Open, on time", "Overdue"], rows: workload.map((u) => [u.name, u.open, u.overdue]) }}
            >
              <StackedRows parts={PROGRESS.slice(1)} rows={workload.map((u) => ({ key: u.id, name: u.name, label: <span className="flex items-center gap-2"><Avatar name={u.name} className="size-6 text-[0.625rem]" />{u.name}</span>, values: { open: u.open, overdue: u.overdue } }))} />
            </ChartCard>

            <section className="card rounded-xl p-5">
              <header className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Recent activity</h2>
                  <p className="mt-0.5 text-sm text-muted">From the audit log</p>
                </div>
                <Link to="/audit-log" className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-semibold text-lake hover:bg-lake-wash">Open log</Link>
              </header>
              <ol className="mt-4 space-y-3.5">
                {recent.map((e) => (
                  <li key={e.seq} className="flex gap-3 text-sm">
                    <Avatar name={userName(e.actor)} className="size-8 text-xs" />
                    <div className="min-w-0">
                      <p className="leading-snug"><span className="font-medium">{userName(e.actor)}</span> <span className="text-muted">{(ACTION_LABEL[e.action] ?? e.action).toLowerCase()}</span></p>
                      <p className="text-xs text-faint">{fmtDateTime(e.timestamp)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </div>
    </>
  );
}

type Tile = { icon: IconName; label: string; value: number | string; note?: ReactNode; spark?: ReactNode; to?: string; tone?: "danger" | "warn" };

function KpiTile({ icon, label, value, note, spark, to, tone }: Tile) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className={cx("grid size-9 place-items-center rounded-lg ring-1 ring-inset", tone === "danger" ? "bg-danger-wash text-danger ring-[#fecdca]" : tone === "warn" ? "bg-warn-wash text-warn ring-[#fedf89]" : "bg-subtle text-muted ring-line")}>
          <Icon name={icon} className="size-[18px]" />
        </span>
      </div>
      <p className="mt-1 text-[2rem] font-semibold leading-tight tracking-[-0.02em]">{value}</p>
      <div className="mt-1 text-sm">{note}</div>
      {spark && <div className="mt-3">{spark}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="card block rounded-xl p-5 transition-shadow hover:shadow-[0_4px_8px_-2px_rgba(16,24,40,0.1)]">{body}</Link>
  ) : (
    <div className="card rounded-xl p-5">{body}</div>
  );
}

function Delta({ value, days, upIsBad }: { value: number; days: number; upIsBad: boolean }) {
  if (days < 1) return <span className="text-muted">No earlier data yet</span>;
  if (value === 0) return <span className="text-muted">No change in {days} days</span>;
  const bad = upIsBad ? value > 0 : false;
  const good = upIsBad ? value < 0 : false;
  return (
    <span className="text-muted">
      <span className={cx("font-semibold", bad && "text-danger", good && "text-good", !bad && !good && "text-ink")}>
        {value > 0 ? "Up" : "Down"} {Math.abs(value)}
      </span>{" "}
      in {days} days
    </span>
  );
}
