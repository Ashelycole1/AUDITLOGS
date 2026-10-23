export type Role = "PIA" | "CIA" | "IA" | "SIA" | "CEO" | "ICT" | "SYS";
/** Roles held inside an organization. The System Administrator (SYS) belongs to none. */
export type OrgRole = Exclude<Role, "SYS">;

/** Switches the System Administrator sets per organization (auditlogs-additions_final.md 5). */
export type FeatureKey =
  | "dashboard.IA"
  | "dashboard.SIA"
  | "dashboard.PIA"
  | "dashboard.CIA"
  | "dashboard.CEO"
  | "component.registered_numbers"
  | "component.system_stats"
  | "component.status_pie";

export interface OrgInfo {
  id: string;
  name: string;
  country: string;
  status: OrgStatus;
  features: FeatureKey[];
  roles: OrgRole[];
}

export type OrgStatus = "Pending" | "Active" | "Suspended" | "Deactivated" | "Rejected";

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
  /** The signed-in person's organization and its switches (API). Null for the System Administrator. */
  organization?: OrgInfo | null;
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
  // The rest of the query record (auditlogs-additions_final.md 8.2), in its order.
  managementResponse?: string;
  recommendation?: string;
  auditObservation?: string;
  policyTitle?: string;
  policyReference?: string;
  notableNumbers?: string;
  /** The criterion of the audit report the query was raised against (section 8.1). */
  criterionId?: string | null;
  criterionTitle?: string | null;
  reportId?: string | null;
  reportTitle?: string | null;
}

export type EditableField =
  | "title"
  | "descriptionCurrent"
  | "managementResponse"
  | "riskRatingCurrent"
  | "recommendation"
  | "auditObservation"
  | "policyTitle"
  | "policyReference"
  | "deadline"
  | "responsibleOfficer"
  | "department"
  | "notableNumbers"
  | "criterion";

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

export type ExportFilters = Partial<Record<"status" | "risk" | "department" | "assignee" | "overdue" | "q" | "report" | "criterion" | "worked", string>>;

/** Excel register or PDF report (auditlogs-additions_final.md 13). */
export type ExportFormat = "xlsx" | "pdf";

/** A PIA's request to export queries. Downloadable once the CIA approves. */
export interface ExportRequest {
  id: string;
  requestedBy: string;
  filters: ExportFilters;
  format?: ExportFormat;
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
  /** Criterion the row sits under, from a Word report or a criterion column. */
  criterion?: string;
  errors: string[];
  warnings?: string[];
}

/** An audit report and its criteria (section 8.1). */
export interface AuditReport {
  id: string;
  title: string;
  auditPeriod: string;
  reportDate: string | null;
  preparedBy: string;
  criteriaCount: number;
  createdAt: string;
}

export interface Criterion {
  id: string;
  title: string;
  description: string;
  position: number;
  queries: number;
}

/** The query status pie chart (section 10). The three slices add up to the total. */
export interface StatusSummary {
  total: number;
  workedOn: number;
  notWorkedOn: number;
  allocated: number;
  unallocated: number;
  slices: { key: "worked_on" | "allocated_not_worked" | "unallocated"; label: string; count: number; percent: number; meaning: string }[];
}
