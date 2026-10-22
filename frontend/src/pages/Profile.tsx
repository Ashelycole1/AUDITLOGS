import { Link } from "react-router-dom";
import { Avatar, Button, PageHeader, Panel, cx } from "../components";
import { ROLE_NAME, daysOverdue, isAuditor } from "../lib/rules";
import { useMe, useStore } from "../storeTypes";
import type { Role } from "../types";

// The audit chain, lowest rank first (owner, 2026-10-22). CEO and ICT sit outside it.
const CHAIN: Role[] = ["IA", "SIA", "PIA", "CIA"];

const CAN: Record<Role, string[]> = {
  CIA: [
    "Import and confirm final queries",
    "Assign, reassign and correct queries; every edit is kept as a revision",
    "Close, return or keep in view the auditors' closure proposals",
    "Approve or reject the PIA's reassignments and exports",
    "Export queries, and keep the audit log",
  ],
  PIA: [
    "Assign queries to an IA or SIA",
    "Ask the CIA to approve a reassignment or an export",
    "Return closure proposals or keep them in view",
    "Add follow-up, evidence and comments to any query",
  ],
  SIA: [
    "Follow up the queries assigned to you",
    "Record notes, management responses, evidence and comments",
    "Propose closure when a finding is resolved",
  ],
  IA: [
    "Follow up the queries assigned to you",
    "Record notes, management responses, evidence and comments",
    "Propose closure when a finding is resolved",
  ],
  CEO: [
    "See where every query stands, and who is responsible",
    "Comment on queries and on the CIA's activity",
    "See every change the CIA makes directly",
  ],
  ICT: [
    "Create, change and disable accounts",
    "Watch system health and backups",
    "Ask the CIA for time-limited access to audit content when something needs fixing",
  ],
};

export default function ProfilePage() {
  const me = useMe();
  const { state, visibleQueries, logout } = useStore();
  const open = visibleQueries.filter((q) => q.status !== "Closed");
  const unread = state.notifications.filter((n) => n.recipient === me.id && !n.readAt).length;
  const pending = (list: { decision: string }[]) => list.filter((r) => r.decision === "Pending").length;

  const work: { label: string; value: number; to: string }[] = isAuditor(me.role)
    ? [
        { label: "Open queries assigned to you", value: open.length, to: "/queries" },
        { label: "Overdue", value: open.filter((q) => daysOverdue(q) > 0).length, to: "/queries" },
        { label: "Returned to you", value: open.filter((q) => q.status === "Returned").length, to: "/queries" },
      ]
    : me.role === "CIA"
      ? [
          { label: "Waiting for your decision", value: pending(state.requests) + pending(state.reassignments) + pending(state.exports), to: "/approvals" },
          { label: "Open queries", value: open.length, to: "/queries" },
          { label: "Not assigned", value: open.filter((q) => !q.currentAssignee).length, to: "/queries" },
        ]
      : me.role === "PIA"
        ? [
            { label: "Proposals to review", value: pending(state.requests), to: "/approvals" },
            { label: "Your requests waiting for the CIA", value: pending(state.reassignments.filter((r) => r.requestedBy === me.id)) + pending(state.exports.filter((x) => x.requestedBy === me.id)), to: "/approvals" },
            { label: "Not assigned", value: open.filter((q) => !q.currentAssignee).length, to: "/queries" },
          ]
        : me.role === "CEO"
          ? [
              { label: "Open queries", value: open.length, to: "/personnel" },
              { label: "Overdue", value: open.filter((q) => daysOverdue(q) > 0).length, to: "/personnel" },
            ]
          : [];

  return (
    <>
      <PageHeader eyebrow="Profile" title="Your profile" />

      <section className="card mb-5 flex flex-wrap items-center gap-5 rounded-xl p-5 sm:p-6">
        <Avatar name={me.fullName} className="!size-16 !text-xl" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.375rem] font-medium tracking-[-0.02em]">{me.fullName}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="rounded bg-chip px-1.5 py-px font-mono text-[0.75rem] text-ink">{me.role}</span>
            {ROLE_NAME[me.role]}
          </p>
          {me.email && <p className="mt-1 break-all text-sm text-muted">{me.email}</p>}
        </div>
        <Button kind="secondary" onClick={() => logout()}>Sign out</Button>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Your place in the audit chain" subtitle={CHAIN.includes(me.role) ? "Work flows up the chain; assignments flow down it." : "Your role sits outside the audit chain."}>
          <ol className="flex flex-wrap items-center gap-2" aria-label="Audit chain, lowest rank first">
            {CHAIN.map((r, i) => (
              <li key={r} className="flex items-center gap-2">
                {i > 0 && <span className="text-faint" aria-hidden>›</span>}
                <span
                  className={cx("rounded-md px-2.5 py-1.5 text-sm", r === me.role ? "bg-lake font-medium text-on-accent" : "bg-chip text-muted")}
                  title={ROLE_NAME[r]}
                  aria-current={r === me.role ? "true" : undefined}
                >
                  {r}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[0.8125rem] text-faint">Lowest rank on the left. CEO and ICT oversee and support the chain from outside it.</p>
        </Panel>

        <Panel title="What you can do">
          <ul className="space-y-2 text-[0.9375rem]">
            {CAN[me.role].map((c) => (
              <li key={c} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-lake" aria-hidden />{c}</li>
            ))}
          </ul>
        </Panel>

        {work.length > 0 && (
          <Panel title="Your work now">
            <ul className="divide-y divide-line">
              {work.map((w) => (
                <li key={w.label}>
                  <Link to={w.to} className="flex items-center justify-between gap-4 py-2.5 text-sm hover:text-lake">
                    <span>{w.label}</span>
                    <span className="text-lg font-medium tabular-nums">{w.value}</span>
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/notifications" className="flex items-center justify-between gap-4 py-2.5 text-sm hover:text-lake">
                  <span>Unread notifications</span>
                  <span className="text-lg font-medium tabular-nums">{unread}</span>
                </Link>
              </li>
            </ul>
          </Panel>
        )}

        <Panel title="Account and security">
          <ul className="space-y-2 text-sm text-muted">
            <li>Signing in takes your password and, in production, a one-time code sent to your work email.</li>
            <li>You are signed out after 30 minutes without activity.</li>
            <li>Everything you change is written to the audit log under your name.</li>
            <li>To change your name, email or role, ask ICT. Those changes are logged too.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
