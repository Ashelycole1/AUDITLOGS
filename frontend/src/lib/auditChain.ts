import type { AuditEntry } from "../types";
import { sha256 } from "./sha256";

export const GENESIS = "0".repeat(64);

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

export type NewAuditEntry = Omit<AuditEntry, "seq" | "timestamp" | "prevHash" | "entryHash"> & {
  timestamp?: string;
};

// entry_hash = SHA-256(prev_hash || canonical_json(entry_without_hash)) — design.md section 10.
function hashEntry(prevHash: string, entry: Omit<AuditEntry, "prevHash" | "entryHash">): string {
  return sha256(prevHash + canonical(entry));
}

export function appendAudit(log: AuditEntry[], e: NewAuditEntry): AuditEntry[] {
  const prev = log[log.length - 1];
  const prevHash = prev?.entryHash ?? GENESIS;
  const body = {
    ...e,
    seq: (prev?.seq ?? 0) + 1,
    timestamp: e.timestamp ?? new Date().toISOString(),
  };
  return [...log, { ...body, prevHash, entryHash: hashEntry(prevHash, body) }];
}

export function verifyChain(log: AuditEntry[]): { ok: true; checked: number } | { ok: false; brokenAt: number } {
  let prevHash = GENESIS;
  for (const entry of log) {
    const { prevHash: storedPrev, entryHash, ...body } = entry;
    if (storedPrev !== prevHash || hashEntry(prevHash, body) !== entryHash) {
      return { ok: false, brokenAt: entry.seq };
    }
    prevHash = entryHash;
  }
  return { ok: true, checked: log.length };
}
