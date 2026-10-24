// Dashboard widgets the System Administrator switches per organization (auditlogs-additions_final.md 5 and 10).
// The server refuses a widget that is off; these hide it so nobody sees a refusal. In API mode the counts
// come from the server and cover the whole organization; the demo works them out in the browser.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { ChartCard, GOOD, SERIES } from "./charts";
import { cx } from "./components";
import { fmtBytes, fmtDateTime, isWorkedOn, ROLE_NAME, statusSummary } from "./lib/rules";
import { useStore } from "./storeTypes";
import type { Allocation, OrgRole, Query, StatusSummary, User } from "./types";

// Worked on is good, allocated is the plain series, not allocated is the neutral remainder. Checked with the
// dataviz validator in both themes (CVD and normal-vision separation pass; the grey is the intended "none").
const SLICE_COLOR: Record<StatusSummary["slices"][number]["key"], string> = {
  worked_on: GOOD,
  allocated_not_worked: SERIES,
  unallocated: "var(--color-mark-neutral)",
};
// Clicking a slice opens the query list filtered to it.
const SLICE_LINK: Record<StatusSummary["slices"][number]["key"], string> = {
  worked_on: "/queries?worked=yes",
  allocated_not_worked: "/queries?worked=no&assignee=any",
  unallocated: "/queries?worked=no&assignee=none",
};

type Raw = Record<string, unknown>;

/** Load a widget's numbers from the API once. Null while loading or when it could not be read. */
function useApi<T>(path: string, enabled: boolean, map: (r: Raw) => T): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api.get<Raw>(path).then((r) => live && setData(map(r))).catch(() => live && setData(null));
    return () => { live = false; };
  }, [path, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

const toSummary = (r: Raw): StatusSummary => ({
  total: Number(r.total),
  workedOn: Number(r.worked_on),
  notWorkedOn: Number(r.not_worked_on),
  allocated: Number(r.allocated),
  unallocated: Number(r.unallocated),
  slices: r.slices as StatusSummary["slices"],
  allocatedTo: ((r.allocated_to as Raw[]) ?? []).map((p) => ({
    id: String(p.id),
    fullName: String(p.full_name),
    role: p.role as Allocation["role"],
    count: Number(p.count),
    workedOn: Number(p.worked_on),
  })),
});

export function StatusPieCard({ className, summary, subtitle = "Every query imported into the organization" }: { className?: string; summary?: StatusSummary; subtitle?: string }) {
  const { mode, has, me, visibleQueries, state } = useStore();
  const on = has("component.status_pie");
  const fromApi = useApi("/dashboard/status-summary", mode === "api" && on && !summary, toSummary);
  if (!on) return null;
  const s = summary ?? (mode === "api" ? fromApi : statusSummary(visibleQueries, state.reassignments));
  const canOpen = me?.role === "PIA" || me?.role === "CIA" || me?.role === "CEO";
  const pct = (n: number) => (s && s.total ? `${Math.round((1000 * n) / s.total) / 10}%` : "0%");

  return (
    <ChartCard
      className={className}
      title="Queries worked on"
      subtitle={subtitle}
      table={s ? { head: ["Slice", "Queries", "Share"], rows: [...s.slices.map((x) => [x.label, x.count, `${x.percent}%`]), ["Allocated (has an auditor)", s.allocated, pct(s.allocated)], ["Total imported", s.total, "100%"]] } : undefined}
    >
      {!s ? (
        <p className="text-sm text-muted" role="status">Loading</p>
      ) : (
        <div className="flex flex-wrap items-center gap-6">
          <Donut
            total={s.total}
            slices={s.slices.map((x) => ({ key: x.key, label: x.label, count: x.count, color: SLICE_COLOR[x.key] }))}
            center={{ value: s.total ? `${Math.round((100 * s.workedOn) / s.total)}%` : "0%", label: "worked on" }}
          />
          <div className="min-w-[14rem] flex-1">
            <p className="text-sm text-muted">Total imported</p>
            <p className="text-[2rem] font-medium leading-none tracking-[-0.04em] tabular-nums">{s.total}</p>
            <ul className="mt-4 space-y-2.5 text-sm" aria-label="Key">
              {s.slices.map((x) => {
                const body = (
                  <>
                    <span className="mt-1 size-2.5 shrink-0 rounded-[3px]" style={{ background: SLICE_COLOR[x.key] }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block">{x.label}</span>
                      <span className="block text-xs text-faint">{x.meaning}</span>
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="font-medium">{x.count}</span>
                      <span className="block text-xs text-muted">{x.percent}%</span>
                    </span>
                  </>
                );
                return (
                  <li key={x.key}>
                    {canOpen ? (
                      <Link to={SLICE_LINK[x.key]} className="-mx-2 flex items-start gap-2.5 rounded-md px-2 py-1 hover:bg-subtle">{body}</Link>
                    ) : (
                      <div className="flex items-start gap-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
              <span className="font-medium text-ink tabular-nums">{s.allocated}</span> allocated to an auditor ({pct(s.allocated)}),{" "}
              <span className="font-medium text-ink tabular-nums">{s.notWorkedOn}</span> not yet worked on.
            </p>
          </div>
        </div>
      )}
    </ChartCard>
  );
}

interface DonutSlice { key: string; label: string; count: number; color: string }

/** A donut with a 2px gap between slices and the hovered slice's count in the middle. */
function Donut({ total, slices, center }: { total: number; slices: DonutSlice[]; center: { value: string; label: string } }) {
  const [hover, setHover] = useState<string | null>(null);
  const size = 168;
  const r = 66;
  const stroke = 22;
  const c = 2 * Math.PI * r;
  const live = slices.filter((x) => x.count > 0);
  const gap = live.length > 1 ? 2 : 0;
  let offset = 0;
  const shown = slices.find((x) => x.key === hover);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90" role="img" aria-label={slices.map((x) => `${x.label}: ${x.count}`).join(", ")}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-meter-track)" strokeWidth={stroke} />
        {total > 0 &&
          live.map((x) => {
            const len = (x.count / total) * c;
            const dash = Math.max(0, len - gap);
            const el = (
              <circle
                key={x.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={x.color}
                strokeWidth={hover === x.key ? stroke + 4 : stroke}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
                className="cursor-default transition-[stroke-width]"
                onPointerEnter={() => setHover(x.key)}
                onPointerLeave={() => setHover(null)}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <span>
          <span className="block text-xl font-medium tabular-nums">{shown ? shown.count : center.value}</span>
          <span className="block max-w-[6.5rem] text-[0.6875rem] leading-tight text-muted">{shown ? shown.label : center.label}</span>
        </span>
      </div>
    </div>
  );
}

// Three people get a colour each, in this fixed order; everyone after them shares the grey slice. More
// hues could not all be told apart once any slice can sit beside any other (checked with the validator).
const PERSON_COLORS = [1, 2, 3].map((n) => `var(--color-cat-${n})`);
const OTHERS = "var(--color-cat-other)";

/** Who the allocated queries are with: a count per person and nothing else (owner, 2026-10-25). The
 *  queries themselves stay private to the people allowed to open them; only roles that can already
 *  open the query list get a link to it. */
export function AllocationPieCard({ className }: { className?: string }) {
  const { mode, has, me, state } = useStore();
  const on = has("component.status_pie");
  const fromApi = useApi("/dashboard/status-summary", mode === "api" && on, toSummary);
  if (!on) return null;
  const people: Allocation[] | null = mode === "api" ? (fromApi?.allocatedTo ?? null) : demoAllocation(state.queries, state.users);
  const canOpen = me?.role === "PIA" || me?.role === "CIA" || me?.role === "CEO";
  const total = people?.reduce((n, p) => n + p.count, 0) ?? 0;
  const share = (n: number) => (total ? `${Math.round((1000 * n) / total) / 10}%` : "0%");

  // Those who hold the most get their own slice. Colours go by name, so a person keeps theirs as counts move.
  const named = people?.slice(0, PERSON_COLORS.length) ?? [];
  const rest = people?.slice(named.length) ?? [];
  const colorOf = new Map([...named].sort((a, b) => a.fullName.localeCompare(b.fullName)).map((p, i) => [p.id, PERSON_COLORS[i]]));
  const color = (id: string) => colorOf.get(id) ?? OTHERS;
  const slices: DonutSlice[] = [
    ...named.map((p) => ({ key: p.id, label: p.fullName, count: p.count, color: color(p.id) })),
    ...(rest.length ? [{ key: "others", label: rest.length === 1 ? rest[0].fullName : `Everyone else (${rest.length})`, count: rest.reduce((n, p) => n + p.count, 0), color: OTHERS }] : []),
  ];

  return (
    <ChartCard
      className={className}
      title="Queries per person"
      subtitle="How many allocated queries each person holds. Counts only; the queries stay private."
      table={people ? { head: ["Person", "Role", "Queries", "Worked on", "Share"], rows: [...people.map((p) => [p.fullName, ROLE_NAME[p.role], p.count, p.workedOn, share(p.count)]), ["Total allocated", "", total, people.reduce((n, p) => n + p.workedOn, 0), "100%"]] } : undefined}
    >
      {!people ? (
        <p className="text-sm text-muted" role="status">Loading</p>
      ) : !people.length ? (
        <p className="text-sm text-muted">No query has been allocated yet.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-6">
          <Donut total={total} slices={slices} center={{ value: String(people.length), label: people.length === 1 ? "person" : "people" }} />
          <div className="min-w-[14rem] flex-1">
            <p className="text-sm text-muted">Allocated queries</p>
            <p className="text-[2rem] font-medium leading-none tracking-[-0.04em] tabular-nums">{total}</p>
            {/* Every person is listed with their count, including those who share the grey slice. */}
            <ul className="mt-4 max-h-[17rem] space-y-2 overflow-y-auto text-sm" aria-label="Key">
              {people.map((person) => {
                const body = (
                  <>
                    <span className="mt-1 size-2.5 shrink-0 rounded-[3px]" style={{ background: color(person.id) }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{person.fullName}</span>
                      <span className="block text-xs text-faint">{ROLE_NAME[person.role]}, {person.workedOn} worked on</span>
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="font-medium">{person.count}</span>
                      <span className="block text-xs text-muted">{share(person.count)}</span>
                    </span>
                  </>
                );
                return (
                  <li key={person.id}>
                    {canOpen ? (
                      <Link to={`/queries?assignee=${person.id}`} className="-mx-2 flex items-start gap-2.5 rounded-md px-2 py-1 hover:bg-subtle">{body}</Link>
                    ) : (
                      <div className="flex items-start gap-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </ChartCard>
  );
}

/** The demo works the same counts out in the browser, from every query of the demo organization. */
function demoAllocation(queries: Query[], users: User[]): Allocation[] {
  const by = new Map<string, Allocation>();
  for (const q of queries) {
    if (!q.currentAssignee) continue;
    const u = users.find((x) => x.id === q.currentAssignee);
    const row = by.get(q.currentAssignee) ?? { id: q.currentAssignee, fullName: u?.fullName ?? "Unknown", role: u?.role ?? "IA", count: 0, workedOn: 0 };
    row.count += 1;
    if (isWorkedOn(q)) row.workedOn += 1;
    by.set(q.currentAssignee, row);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.fullName.localeCompare(b.fullName));
}

interface Numbers {
  users: number;
  activeUsers: number;
  byRole: Partial<Record<OrgRole, number>>;
  queries: number;
  imports: number;
  reports: number;
  criteria: number;
}

export function RegisteredNumbersCard({ className }: { className?: string }) {
  const { mode, has, state, orgRoles } = useStore();
  const on = has("component.registered_numbers");
  const fromApi = useApi("/dashboard/registered-numbers", mode === "api" && on, (r): Numbers => ({
    users: Number(r.users),
    activeUsers: Number(r.active_users),
    byRole: (r.users_by_role ?? {}) as Numbers["byRole"],
    queries: Number(r.queries),
    imports: Number(r.imports),
    reports: Number(r.reports),
    criteria: Number(r.criteria),
  }));
  if (!on) return null;
  const n: Numbers | null =
    mode === "api"
      ? fromApi
      : {
          users: state.users.length,
          activeUsers: state.users.filter((u) => u.isActive).length,
          byRole: Object.fromEntries(orgRoles.map((r) => [r, state.users.filter((u) => u.isActive && u.role === r).length])),
          queries: state.queries.length,
          imports: state.batches.filter((b) => b.status === "Confirmed").length,
          reports: 0,
          criteria: 0,
        };
  return (
    <section className={cx("card min-w-0 rounded-xl p-5", className)}>
      <h2 className="text-base font-medium">Registered numbers</h2>
      <p className="mt-0.5 text-sm text-muted">People and records in the organization</p>
      {!n ? (
        <p className="mt-4 text-sm text-muted" role="status">Loading</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["Active users", n.activeUsers],
              ["Queries", n.queries],
              ["Imports", n.imports],
              ["Audit reports", n.reports],
              ["Criteria", n.criteria],
              ["All accounts", n.users],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-subtle px-3 py-2.5">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-xl font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <ul className="mt-4 divide-y divide-line text-sm">
            {(Object.entries(n.byRole) as [OrgRole, number][]).map(([role, count]) => (
              <li key={role} className="flex justify-between gap-3 py-1.5">
                <span className="text-muted">{ROLE_NAME[role]}</span>
                <span className="font-medium tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

interface Stats {
  open: number;
  closed: number;
  overdue: number;
  followUp: number;
  comments: number;
  logEntries: number;
  lastActivity: string | null;
  lastImport: string | null;
  evidenceFiles: number;
  evidenceBytes: number;
}

export function SystemStatsCard({ className }: { className?: string }) {
  const { mode, has } = useStore();
  const on = has("component.system_stats");
  const fromApi = useApi("/dashboard/system-stats", mode === "api" && on, (r): Stats => {
    const q = r.queries as Raw;
    const a = r.activity as Raw;
    const st = r.storage as Raw;
    return {
      open: Number(q.open),
      closed: Number(q.closed),
      overdue: Number(q.overdue),
      followUp: Number(a.follow_up_entries),
      comments: Number(a.comments),
      logEntries: Number(a.audit_log_entries),
      lastActivity: (a.last_activity_at as string) ?? null,
      lastImport: (a.last_import_at as string) ?? null,
      evidenceFiles: Number(st.evidence_files),
      evidenceBytes: Number(st.evidence_bytes),
    };
  });
  if (!on) return null;
  if (mode !== "api") return null;
  const s = fromApi;
  return (
    <section className={cx("card min-w-0 rounded-xl p-5", className)}>
      <h2 className="text-base font-medium">System stats</h2>
      <p className="mt-0.5 text-sm text-muted">Workload, activity and storage for the organization</p>
      {!s ? (
        <p className="mt-4 text-sm text-muted" role="status">Loading</p>
      ) : (
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
          {[
            ["Open queries", s.open],
            ["Overdue", s.overdue],
            ["Closed", s.closed],
            ["Follow-up entries", s.followUp],
            ["Comments", s.comments],
            ["Audit log entries", s.logEntries],
            ["Evidence files", `${s.evidenceFiles} (${fmtBytes(s.evidenceBytes)})`],
            ["Last import", s.lastImport ? fmtDateTime(s.lastImport) : "None yet"],
            ["Last activity", s.lastActivity ? fmtDateTime(s.lastActivity) : "None yet"],
          ].map(([label, value]) => (
            <div key={label as string} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="text-right font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
