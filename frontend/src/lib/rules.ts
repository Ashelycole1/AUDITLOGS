import type { Query, Role, Status, User } from "../types";

// Allowed transitions: design.md section 5. Any other transition is rejected.
export const TRANSITIONS: { from: Status; to: Status; who: Role }[] = [
  { from: "Imported", to: "Assigned", who: "CIA" },
  { from: "Assigned", to: "In Progress", who: "IA" },
  { from: "In Progress", to: "Proposed for Closure", who: "IA" },
  { from: "Proposed for Closure", to: "Closed", who: "CIA" },
  { from: "Proposed for Closure", to: "Returned", who: "CIA" },
  { from: "Returned", to: "In Progress", who: "IA" },
  { from: "Closed", to: "In Progress", who: "CIA" },
];

export const STATUSES: Status[] = [
  "Imported",
  "Assigned",
  "In Progress",
  "Proposed for Closure",
  "Closed",
  "Returned",
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
      return all.filter((q) => q.currentAssignee === user.id);
    case "ICT":
      return [];
  }
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
