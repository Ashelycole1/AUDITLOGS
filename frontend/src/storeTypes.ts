// The contract every screen uses. Two implementations: the in-browser demo store (store.tsx) and the
// API store (apiStore.tsx). VITE_DATA_SOURCE=api picks the API; anything else runs the demo.
import { createContext, useContext } from "react";
import type { State } from "./data/seed";
import type { EditableField, ExportFilters, FollowUpActivity, ImportRow, Query, Status, User } from "./types";

/** Where a closure proposal can go: the CIA closes or returns it; the PIA returns it or keeps it in view. */
export type Outcome = "Closed" | "Returned" | "Kept in View";

export type Result = { ok: true } | { ok: false; error: string };
export const ok: Result = { ok: true };
export const fail = (error: string): Result => ({ ok: false, error });

export interface ServerPreview {
  batchId: string;
  filename: string;
  hash: string;
  rows: ImportRow[];
}

export interface Store {
  mode: "demo" | "api";
  /** False until the API store has checked for an existing session. */
  ready: boolean;
  state: State;
  me: User | null;
  userName: (id: string | null) => string;
  visibleQueries: Query[];
  // auth
  // signedIn: the server signed in on the password alone (MFA paused on staging), so there is no PIN step.
  checkPassword: (email: string, password: string) => Promise<Result & { userId?: string; pin?: string; sentTo?: string; signedIn?: boolean }>;
  completeMfa: (userId: string, code: string) => Promise<Result>;
  resendPin: () => Promise<Result & { pin?: string; sentTo?: string }>;
  logout: (reason?: string) => void;
  // query detail: fetch follow-up, evidence, revisions and history (API); no-op in the demo
  loadQuery: (queryId: string) => Promise<void>;
  evidenceUrl: (evidenceId: string) => string | null;
  /** API: fetch a query's comments (the CEO cannot open the full query). No-op in the demo. */
  loadComments: (queryId: string) => Promise<void>;
  // CIA (import moved from the PIA, owner 2026-10-22)
  confirmImport: (filename: string, fileHash: string, rows: ImportRow[]) => Promise<Result>;
  cancelImport: (filename: string, fileHash: string, rowCount: number) => void;
  uploadImport: (file: File) => Promise<Result & { preview?: ServerPreview }>;
  confirmBatch: (batchId: string) => Promise<Result>;
  cancelBatch: (batchId: string) => Promise<Result>;
  // PIA + CIA. A PIA's reassignment becomes a request for the CIA to approve.
  assign: (queryId: string, assigneeId: string, reason: string) => Promise<Result>;
  /** Decide a closure proposal. CIA: Closed or Returned. PIA: Returned or Kept in View. */
  decide: (requestId: string, outcome: Outcome, reason: string) => Promise<Result>;
  // PIA
  requestExport: (filters: ExportFilters, reason: string) => Promise<Result>;
  downloadExport: (exportId: string) => Promise<Result>;
  // CIA
  decideReassignment: (requestId: string, approve: boolean, reason: string) => Promise<Result>;
  decideExport: (exportId: string, approve: boolean, reason: string) => Promise<Result>;
  editQuery: (queryId: string, field: EditableField, value: string, reason: string) => Promise<Result>;
  setStatusDirect: (queryId: string, to: Status, reason: string) => Promise<Result>;
  exportQueries: (rows: Query[], filters: ExportFilters) => Promise<Result>;
  decideAccess: (requestId: string, approve: boolean, reason: string) => Promise<Result>;
  verifyLogged: (result: string) => void;
  /** API only: the server recomputes the chain and logs the check. */
  verifyOnServer: () => Promise<{ ok: boolean; checked: number; brokenAt: number | null } | null>;
  // CIA + CEO
  addComment: (queryId: string, body: string) => Promise<Result>;
  // CIA + IA + SIA
  addActivity: (queryId: string, kind: FollowUpActivity["kind"], body: string) => Promise<Result>;
  addEvidence: (queryId: string, file: { name: string; size: number; bytes: Uint8Array; file?: File }) => Promise<Result>;
  // IA + SIA
  proposeClosure: (queryId: string, reason: string) => Promise<Result>;
  // ICT
  createUser: (u: Pick<User, "email" | "fullName" | "role">) => Promise<Result>;
  setUserActive: (userId: string, active: boolean, reason: string) => Promise<Result>;
  requestAccess: (reason: string) => Promise<Result>;
}

export const StoreCtx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreCtx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}

export function useMe(): User {
  const { me } = useStore();
  if (!me) throw new Error("No signed-in user");
  return me;
}
