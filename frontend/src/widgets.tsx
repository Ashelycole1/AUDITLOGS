// Dashboard widgets the System Administrator switches per organization (auditlogs-additions_final.md 5 and 10).
// The server refuses a widget that is off; these hide it so nobody sees a refusal. In API mode the counts
// come from the server and cover the whole organization; the demo works them out in the browser.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { ChartCard, GOOD, SERIES } from "./charts";
import { cx } from "./components";
import { fmtBytes, fmtDateTime, ROLE_NAME, statusSummary } from "./lib/rules";
import { useStore } from "./storeTypes";
import type { OrgRole, StatusSummary } from "./types";

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
          <Donut summary={s} />
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

/** A donut of the three slices, with a 2px gap between them and a hover tooltip per slice. */
function Donut({ summary }: { summary: StatusSummary }) {
  const [hover, setHover] = useState<string | null>(null);
  const size = 168;
  const r = 66;
  const stroke = 22;
  const c = 2 * Math.PI * r;
  const live = summary.slices.filter((x) => x.count > 0);
  const gap = live.length > 1 ? 2 : 0;
  let offset = 0;
  const shown = summary.slices.find((x) => x.key === hover);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90" role="img" aria-label={summary.slices.map((x) => `${x.label}: ${x.count}`).join(", ")}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-meter-track)" strokeWidth={stroke} />
        {summary.total > 0 &&
          live.map((x) => {
            const len = (x.count / summary.total) * c;
            const dash = Math.max(0, len - gap);
            const el = (
              <circle
                key={x.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={SLICE_COLOR[x.key]}
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
        {shown ? (
          <span>
            <span className="block text-xl font-medium tabular-nums">{shown.count}</span>
            <span className="block max-w-[6.5rem] text-[0.6875rem] leading-tight text-muted">{shown.label}</span>
          </span>
        ) : (
          <span>
            <span className="block text-xl font-medium tabular-nums">{summary.total ? `${Math.round((100 * summary.workedOn) / summary.total)}%` : "0%"}</span>
            <span className="block text-[0.6875rem] text-muted">worked on</span>
          </span>
        )}
      </div>
    </div>
  );
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
