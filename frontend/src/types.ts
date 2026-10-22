export type Role = "PIA" | "CIA" | "IA" | "SIA" | "CEO" | "ICT";

export type Status =
  | "Imported"
  | "Assigned"
  | "In Progress"
  | "Proposed for Closure"
  | "Closed"
  | "Returned"
  | "Pending Approval"
  | "Kept in View";

export type Risk = "Critical" | "High" | "Medium" | "Low";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
}

export interface ImportBatch {
  id: string;
  importedBy: string;
  sourceFilename: string;
  sourceSha256: string;
  status: "Previewed" | "Confirmed" | "Cancelled";
  rowCount: number;
  createdAt: string;
  confirmedAt: string | null;
}

export interface Query {
  id: string;
  reference: string;
  batchId: string;
  title: string;
  descriptionOriginal: string;
  descriptionCurrent: string;
  riskRatingOriginal: Risk;
  riskRatingCurrent: Risk;
  status: Status;
  deadline: string;
  responsibleOfficer: string;
  department: string;
  currentAssignee: string | null;
  /** IA or SIA (API). The demo looks it up from its users. */
  assigneeRole?: Role | null;
  closedAt: string | null;
  /** When the batch was confirmed (API). The demo works it out from its batches. */
  importedAt?: string | null;
  /** Name of the imported file (API). */
  batchFilename?: string;
}

export type EditableField = "title" | "descriptionCurrent" | "riskRatingCurrent" | "deadline";

export interface QueryRevision {
  id: string;
  queryId: string;
  field: EditableField;
  oldValue: string;
  newValue: string;
  editedBy: string;
  reason: string;
  createdAt: string;
}

export interface FollowUpActivity {
  id: string;
  queryId: string;
  author: string;
  kind: "Note" | "ManagementResponse";
  body: string;
  createdAt: string;
}

export interface Evidence {
  id: string;
  queryId: string;
  uploadedBy: string;
  originalFilename: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
}

export interface StatusChangeRequest {
  id: string;
  queryId: string;
  fromStatus: Status;
  toStatus: Status;
  proposedBy: string;
  proposedReason: string;
  decision: "Pending" | "Approved" | "Rejected";
  decidedBy: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  /** Where the decision took the query: Closed, Returned or Kept in View. */
  decidedStatus?: Status | null;
  createdAt: string;
  /** Counts supplied by the API's approvals inbox. */
  responses?: number;
  evidenceFiles?: number;
}

export type Decision = "Pending" | "Approved" | "Rejected";

/** A PIA's request to move a query to another auditor, decided by the CIA. */
export interface ReassignmentRequest {
  id: string;
  queryId: string;
  fromAssignee: string;
  toAssignee: string;
  fromStatus: Status;
  requestedBy: string;
  reason: string;
  decision: Decision;
  decidedBy: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export type ExportFilters = Partial<Record<"status" | "risk" | "department" | "assignee" | "overdue" | "q", string>>;

/** A PIA's request to export queries. Downloadable once the CIA approves. */
export interface ExportRequest {
  id: string;
  requestedBy: string;
  filters: ExportFilters;
  reason: string;
  decision: Decision;
  decidedBy: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  downloads: number;
  createdAt: string;
}

/** An oversight comment on a query by the CIA or the CEO. */
export interface Comment {
  id: string;
  queryId: string;
  author: string;
  authorRole: Role;
  body: string;
  createdAt: string;
}

/** An in-app message to one person (owner, 2026-10-22). Names the query by reference only. */
export interface Notification {
  id: string;
  recipient: string;
  headline: string;
  body: string;
  queryId: string | null;
  link: string;
  readAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  seq: number;
  timestamp: string;
  actor: string | null;
  actorRole: Role | null;
  action: string;
  objectType: string;
  objectId: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  prevHash: string;
  entryHash: string;
}

export interface AccessRequest {
  id: string;
  requestedBy: string;
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
  decidedBy: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ImportRow {
  line: number;
  reference: string;
  title: string;
  description: string;
  riskRating: string;
  deadline: string;
  responsibleOfficer: string;
  department: string;
  errors: string[];
  warnings?: string[];
}
