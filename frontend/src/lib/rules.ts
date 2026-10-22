import type { ExportFilters, Query, Role, Status, User } from "../types";

export const ROLE_NAME: Record<Role, string> = {
  PIA: "Principal Internal Auditor",
  CIA: "Chief Internal Auditor",
  IA: "Internal Auditor",
  SIA: "Senior Internal Auditor",
  CEO: "Chief Executive",
  ICT: "ICT administrator",
};

// The audit chain, lowest first (owner, 2026-10-22). CEO and ICT sit outside it.
const RANK: Partial<Record<Role, number>> = { IA: 1, SIA: 2, PIA: 3, CIA: 4 };
/** The roles that work the queries assigned to them. */
export const AUDITOR_ROLES: Role[] = ["IA", "SIA"];
export const isAuditor = (role: Role) => AUDITOR_ROLES.includes(role);
/** Roles that may assign. SIA permissions are still to be agreed with the client. */
export const canAssignRole = (role: Role) => role === "PIA" || role === "CIA";

/** Assignment flows down the chain: only to an active auditor ranked below the actor. Mirrors the server. */
export function canAssign(actor: User, target: User): boolean {
  return target.isActive && isAuditor(target.role) && (RANK[target.role] ?? 0) < (RANK[actor.role] ?? 0);
}

// Statuses a PIA's reassignment can start from, and return to if the CIA rejects it.
export const REASSIGNABLE: Status[] = ["Assigned", "In Progress", "Returned", "Kept in View"];

// Allowed transitions: design.md section 5, with the owner's changes of 2026-10-22. Any other is rejected.
const T = (from: Status, to: Status, ...who: Role[]) => who.map((w) => ({ from, to, who: w }));
export const TRANSITIONS: { from: Status; to: Status; who: Role }[] = [
  ...T("Imported", "Assigned", "PIA", "CIA"),
  ...T("Assigned", "In Progress", "IA", "SIA"),
  ...T("In Progress", "Proposed for Closure", "IA", "SIA"),
  ...T("Proposed for Closure", "Closed", "CIA"),
  ...T("Proposed for Closure", "Returned", "PIA", "CIA"),
  ...T("Proposed for Closure", "Kept in View", "PIA"),
  ...T("Returned", "In Progress", "IA", "SIA"),
  ...T("Kept in View", "In Progress", "IA", "SIA"),
  ...T("Kept in View", "Returned", "PIA", "CIA"),
  ...T("Closed", "In Progress", "CIA"),
  ...REASSIGNABLE.flatMap((s) => [...T(s, "Pending Approval", "PIA"), ...T("Pending Approval", s, "CIA")]),
];

export const STATUSES: Status[] = [
  "Imported",
  "Assigned",
  "In Progress",
  "Proposed for Closure",
  "Pending Approval",
  "Kept in View",
  "Returned",
  "Closed",
];

export function isAllowedTransition(from: Status, to: Status, role: Role): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.to === to && t.who === role);
}

export const MIN_REASON = 10;

export function reasonError(reason: string): string | null {
  return reason.trim().length < MIN_REASON
    ? `Give a reason of at least ${MIN_REASON} characters.`
    : null;
}

// Mirrors the server-side `for_user` scoping (architecture.md 5.1). The UI never relies on it for security.
export function queriesFor(user: User, all: Query[]): Query[] {
  switch (user.role) {
    case "CIA":
    case "PIA":
    case "CEO":
      return all;
    case "IA":
    case "SIA":
      return all.filter((q) => q.currentAssignee === user.id);
    case "ICT":
      return [];
  }
}

/** The query-list filters, as the server applies them to the list and to exports. */
export function matchesFilters(q: Query, f: ExportFilters): boolean {
  const term = (f.q ?? "").trim().toLowerCase();
  return (
    (!f.status || q.status === f.status) &&
    (!f.risk || q.riskRatingCurrent === f.risk) &&
    (!f.department || q.department === f.department) &&
    (!f.assignee || (f.assignee === "none" ? !q.currentAssignee : q.currentAssignee === f.assignee)) &&
    (!(f.overdue === "1" || f.overdue === "true") || daysOverdue(q) > 0) &&
    (!term || q.reference.toLowerCase().includes(term) || q.title.toLowerCase().includes(term) || q.descriptionCurrent.toLowerCase().includes(term))
  );
}

export function describeFilters(f: ExportFilters, name: (id: string) => string): string {
  const parts = [
    f.status && `status ${f.status}`,
    f.risk && `${f.risk} risk`,
    f.department && f.department,
    f.assignee && (f.assignee === "none" ? "not assigned" : `auditor ${name(f.assignee)}`),
    (f.overdue === "1" || f.overdue === "true") && "overdue only",
    f.q && `matching "${f.q}"`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "all queries";
}

export function daysOverdue(q: Query, now = new Date()): number {
  if (q.status === "Closed") return 0;
  const due = new Date(q.deadline + "T23:59:59+03:00");
  const diff = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
  return diff > 0 ? diff : 0;
}

export function dueWithin(q: Query, days: number, now = new Date()): boolean {
  if (q.status === "Closed") return false;
  const due = new Date(q.deadline + "T23:59:59+03:00").getTime();
  const left = (due - now.getTime()) / 86_400_000;
  return left >= 0 && left <= days;
}

const KAMPALA = "Africa/Kampala";

export function fmtDate(iso: string): string {
  const d = iso.length === 10 ? new Date(iso + "T12:00:00+03:00") : new Date(iso);
  return new Intl.DateTimeFormat("en-UG", {
    timeZone: KAMPALA,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-UG", {
    timeZone: KAMPALA,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const EVIDENCE_TYPES = ["pdf", "docx", "xlsx", "png", "jpg", "csv", "txt"];
export const EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;
