export type Role = "PIA" | "CIA" | "IA" | "CEO" | "ICT";

export type Status =
  | "Imported"
  | "Assigned"
  | "In Progress"
  | "Proposed for Closure"
  | "Closed"
  | "Returned";

export type Risk = "High" | "Medium" | "Low";

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
  createdAt: string;
  /** Counts supplied by the API's approvals inbox. */
  responses?: number;
  evidenceFiles?: number;
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
