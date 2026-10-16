// Dummy data only (system.md rule 10). Names, departments and findings are invented.
import { appendAudit } from "../lib/auditChain";
import { sha256 } from "../lib/sha256";
import type {
  AccessRequest,
  AuditEntry,
  Evidence,
  FollowUpActivity,
  ImportBatch,
  Query,
  QueryRevision,
  Risk,
  Status,
  StatusChangeRequest,
  User,
} from "../types";

export interface State {
  users: User[];
  batches: ImportBatch[];
  queries: Query[];
  revisions: QueryRevision[];
  activities: FollowUpActivity[];
  evidence: Evidence[];
  requests: StatusChangeRequest[];
  accessRequests: AccessRequest[];
  audit: AuditEntry[];
}

const DAY = 86_400_000;
const at = (daysAgo: number, hour = 9): string => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setUTCHours(hour - 3, (daysAgo * 7) % 60, 0, 0);
  return d.toISOString();
};
const dateIn = (days: number): string => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

export const users: User[] = [
  { id: "u-pia", email: "ruth.akello@auditlogs.test", fullName: "Ruth Akello", role: "PIA", isActive: true, mfaEnabled: true },
  { id: "u-cia", email: "daniel.okello@auditlogs.test", fullName: "Daniel Okello", role: "CIA", isActive: true, mfaEnabled: true },
  { id: "u-ia1", email: "sarah.nabirye@auditlogs.test", fullName: "Sarah Nabirye", role: "IA", isActive: true, mfaEnabled: true },
  { id: "u-ia2", email: "peter.mugisha@auditlogs.test", fullName: "Peter Mugisha", role: "IA", isActive: true, mfaEnabled: true },
  { id: "u-ia3", email: "joan.atim@auditlogs.test", fullName: "Joan Atim", role: "IA", isActive: true, mfaEnabled: true },
  { id: "u-ceo", email: "moses.kiggundu@auditlogs.test", fullName: "Moses Kiggundu", role: "CEO", isActive: true, mfaEnabled: true },
  { id: "u-ict", email: "brian.ssali@auditlogs.test", fullName: "Brian Ssali", role: "ICT", isActive: true, mfaEnabled: true },
];

type Seed = [ref: string, title: string, desc: string, risk: Risk, dept: string, officer: string, deadlineIn: number];

const batch1: Seed[] = [
  ["IA/2026/014", "Payments made without approved purchase orders", "Eleven supplier payments totalling UGX 48.2m were processed before a purchase order was approved in the system.", "High", "Procurement", "Head of Procurement", -20],
  ["IA/2026/015", "Bank accounts not reconciled at month end", "The operations and project accounts were last reconciled in June. Unexplained differences remain on both.", "High", "Finance", "Financial Controller", 12],
  ["IA/2026/016", "Fixed asset register not updated", "Thirty-four laptops and two vehicles bought this year are missing from the fixed asset register.", "Medium", "Finance", "Assets Accountant", -9],
  ["IA/2026/017", "Fuel cards active for transferred staff", "Six fuel cards remain active for staff who moved stations more than three months ago.", "Medium", "Fleet", "Transport Officer", 5],
  ["IA/2026/018", "Salary advances not recovered", "Advances issued to nine staff have not been deducted from payroll beyond the agreed three months.", "Medium", "Human Resources", "HR Manager", 20],
  ["IA/2026/019", "Shared administrator password on payroll system", "Two payroll officers use one administrator account, so changes cannot be traced to a person.", "High", "ICT", "ICT Manager", 30],
  ["IA/2026/020", "Stores issues without signed requisitions", "Stationery and spares worth UGX 6.1m were issued from stores without a signed requisition.", "Low", "Stores", "Stores Supervisor", -4],
  ["IA/2026/021", "Leave records not matched to attendance", "Leave approved in the HR file does not match the attendance register for four departments.", "Low", "Human Resources", "HR Manager", 6],
  ["IA/2026/022", "Contract register missing renewal dates", "Twelve active contracts have no renewal or expiry date recorded in the contract register.", "Medium", "Procurement", "Contracts Officer", -30],
  ["IA/2026/023", "Petty cash count exceeded float", "The surprise cash count found UGX 420,000 above the authorised float with no supporting vouchers.", "Low", "Finance", "Cashier", 15],
];

const batch2: Seed[] = [
  ["IA/2026/031", "Vehicle logbooks incomplete", "Logbooks for five pool vehicles have gaps of more than a week in September.", "Medium", "Fleet", "Transport Officer", 40],
  ["IA/2026/032", "Backups not tested", "No restore test of the finance system backup has been recorded this financial year.", "High", "ICT", "ICT Manager", 35],
  ["IA/2026/033", "Supplier bank details changed by email", "Two supplier bank account changes were made on the strength of an email without a call-back check.", "High", "Finance", "Financial Controller", 21],
  ["IA/2026/034", "Training costs not budgeted", "External training worth UGX 12m was paid from the general operations line.", "Low", "Human Resources", "HR Manager", 45],
];

function toQuery(s: Seed, batchId: string, i: number, prefix: string): Query {
  const [reference, title, desc, risk, department, responsibleOfficer, deadlineIn] = s;
  return {
    id: `${prefix}-${i + 1}`,
    reference,
    batchId,
    title,
    descriptionOriginal: desc,
    descriptionCurrent: desc,
    riskRatingOriginal: risk,
    riskRatingCurrent: risk,
    status: "Imported",
    deadline: dateIn(deadlineIn),
    responsibleOfficer,
    department,
    currentAssignee: null,
    closedAt: null,
  };
}

export function seed(): State {
  const queries = [
    ...batch1.map((s, i) => toQuery(s, "b-1", i, "q1")),
    ...batch2.map((s, i) => toQuery(s, "b-2", i, "q2")),
  ];
  const q = (ref: string): Query => queries.find((x) => x.reference === ref)!;
  const batches: ImportBatch[] = [
    { id: "b-1", importedBy: "u-pia", sourceFilename: "final-queries-q1-fy2026.xlsx", sourceSha256: sha256("batch-1"), status: "Confirmed", rowCount: 10, createdAt: at(42), confirmedAt: at(42, 10) },
    { id: "b-2", importedBy: "u-pia", sourceFilename: "final-queries-ict-fleet.xlsx", sourceSha256: sha256("batch-2"), status: "Confirmed", rowCount: 4, createdAt: at(3), confirmedAt: at(3, 11) },
  ];
  const revisions: QueryRevision[] = [];
  const activities: FollowUpActivity[] = [];
  const evidence: Evidence[] = [];
  const requests: StatusChangeRequest[] = [];
  let audit: AuditEntry[] = [];
  const role = (id: string) => users.find((u) => u.id === id)!.role;

  const log = (
    ts: string,
    actor: string,
    action: string,
    objectType: string,
    objectId: string,
    oldValue: unknown,
    newValue: unknown,
    reason = "",
  ) => {
    audit = appendAudit(audit, { timestamp: ts, actor, actorRole: role(actor), action, objectType, objectId, oldValue, newValue, reason });
  };
  const setStatus = (query: Query, to: Status, actor: string, ts: string, reason = "", action = "status.change") => {
    log(ts, actor, action, "Query", query.id, { status: query.status }, { status: to }, reason);
    query.status = to;
    query.closedAt = to === "Closed" ? ts : null;
  };

  // Events are queued and replayed in time order so the hash chain is chronological.
  const queue: { ts: string; run: () => void }[] = [];
  const later = (ts: string, run: () => void) => queue.push({ ts, run });

  const assign = (ref: string, ia: string, daysAgo: number) =>
    later(at(daysAgo, 11), () => {
      const query = q(ref);
      const ts = at(daysAgo, 11);
      log(ts, "u-cia", "query.assign", "Query", query.id, { assignee: null }, { assignee: ia });
      query.currentAssignee = ia;
      setStatus(query, "Assigned", "u-cia", ts);
    });
  const note = (ref: string, author: string, kind: FollowUpActivity["kind"], body: string, daysAgo: number) =>
    later(at(daysAgo, 14), () => {
      const query = q(ref);
      const ts = at(daysAgo, 14);
      const id = `a-${activities.length + 1}`;
      activities.push({ id, queryId: query.id, author, kind, body, createdAt: ts });
      log(ts, author, kind === "Note" ? "activity.note" : "activity.response", "FollowUpActivity", id, null, { queryId: query.id });
      if (query.status === "Assigned" || query.status === "Returned") setStatus(query, "In Progress", author, ts);
    });
  const file = (ref: string, by: string, name: string, size: number, daysAgo: number) =>
    later(at(daysAgo, 15), () => {
      const query = q(ref);
      const ts = at(daysAgo, 15);
      const id = `e-${evidence.length + 1}`;
      evidence.push({ id, queryId: query.id, uploadedBy: by, originalFilename: name, sha256: sha256(name), sizeBytes: size, createdAt: ts });
      log(ts, by, "evidence.upload", "Evidence", id, null, { queryId: query.id, filename: name });
    });
  const propose = (ref: string, by: string, reason: string, daysAgo: number) =>
    later(at(daysAgo, 16), () => {
      const query = q(ref);
      const ts = at(daysAgo, 16);
      requests.push({
        id: `r-${requests.length + 1}`, queryId: query.id, fromStatus: query.status, toStatus: "Proposed for Closure",
        proposedBy: by, proposedReason: reason, decision: "Pending", decidedBy: null, decisionReason: null, decidedAt: null, createdAt: ts,
      });
      setStatus(query, "Proposed for Closure", by, ts, reason, "status.propose");
    });
  const decide = (ref: string, approve: boolean, reason: string, daysAgo: number) =>
    later(at(daysAgo, 10), () => {
      const query = q(ref);
      const r = requests.find((x) => x.queryId === query.id && x.decision === "Pending")!;
      const ts = at(daysAgo, 10);
      r.decision = approve ? "Approved" : "Rejected";
      r.decidedBy = "u-cia";
      r.decisionReason = reason || null;
      r.decidedAt = ts;
      setStatus(query, approve ? "Closed" : "Returned", "u-cia", ts, reason, approve ? "status.approve" : "status.reject");
    });

  later(at(42), () => log(at(42), "u-pia", "import.upload", "ImportBatch", "b-1", null, { filename: batches[0].sourceFilename, rows: 10 }));
  later(at(42, 10), () => log(at(42, 10), "u-pia", "import.confirm", "ImportBatch", "b-1", { status: "Previewed" }, { status: "Confirmed", queries: 10 }));

  assign("IA/2026/014", "u-ia1", 40);
  assign("IA/2026/015", "u-ia1", 40);
  assign("IA/2026/016", "u-ia1", 40);
  assign("IA/2026/017", "u-ia2", 39);
  assign("IA/2026/018", "u-ia2", 39);
  assign("IA/2026/019", "u-ia2", 39);
  assign("IA/2026/020", "u-ia3", 38);
  assign("IA/2026/021", "u-ia3", 38);
  assign("IA/2026/022", "u-ia3", 38);
  assign("IA/2026/023", "u-ia2", 38);

  q("IA/2026/019").riskRatingOriginal = "Medium";
  q("IA/2026/019").riskRatingCurrent = "Medium";
  later(at(37, 12), () => {
    const query = q("IA/2026/019");
    const ts = at(37, 12);
    const reason = "Payroll access affects every salary run; raised after review with ICT.";
    revisions.push({ id: "rev-1", queryId: query.id, field: "riskRatingCurrent", oldValue: "Medium", newValue: "High", editedBy: "u-cia", reason, createdAt: ts });
    log(ts, "u-cia", "query.edit", "Query", query.id, { riskRatingCurrent: "Medium" }, { riskRatingCurrent: "High" }, reason);
    query.riskRatingCurrent = "High";
  });

  note("IA/2026/014", "u-ia1", "Note", "Met the Head of Procurement. Requested the list of payments and the approval dates from the system.", 33);
  note("IA/2026/014", "u-ia1", "ManagementResponse", "Management agrees. The system now blocks payment until a purchase order is approved.", 18);
  file("IA/2026/014", "u-ia1", "erp-control-change-note.pdf", 284_000, 18);
  propose("IA/2026/014", "u-ia1", "System control is live and tested on five sample payments.", 14);
  decide("IA/2026/014", true, "", 12);

  note("IA/2026/015", "u-ia1", "Note", "Reconciliations for July and August are now prepared. September is with the accountant.", 20);
  note("IA/2026/015", "u-ia1", "ManagementResponse", "All three months reconciled and reviewed by the Financial Controller.", 4);
  file("IA/2026/015", "u-ia1", "bank-recs-jul-sep.xlsx", 96_000, 4);
  propose("IA/2026/015", "u-ia1", "Reconciliations complete with reviewer sign-off for July to September.", 2);

  note("IA/2026/016", "u-ia1", "Note", "Assets accountant says the register update is waiting for delivery notes from stores.", 15);

  note("IA/2026/017", "u-ia2", "ManagementResponse", "Five of the six cards have been cancelled. The sixth card holder is on leave.", 22);
  file("IA/2026/017", "u-ia2", "fuel-card-cancellations.pdf", 120_000, 22);
  propose("IA/2026/017", "u-ia2", "Cards cancelled and confirmed with the fuel supplier statement.", 19);
  decide("IA/2026/017", false, "One card is still active. Return when all six are cancelled.", 17);

  note("IA/2026/018", "u-ia2", "Note", "Payroll schedule shows recovery started for six of the nine staff.", 10);

  note("IA/2026/020", "u-ia3", "Note", "Stores has printed new requisition books. Waiting for the first month of use.", 25);

  note("IA/2026/022", "u-ia3", "ManagementResponse", "Register updated with dates for all twelve contracts.", 30);
  file("IA/2026/022", "u-ia3", "contract-register-sept.xlsx", 64_000, 30);
  propose("IA/2026/022", "u-ia3", "Register checked line by line against signed contracts.", 28);
  decide("IA/2026/022", true, "", 27);
  later(at(9, 10), () =>
    setStatus(q("IA/2026/022"), "In Progress", "u-cia", at(9, 10), "Two contracts renewed after closure were not added; reopening to confirm.", "status.direct"),
  );

  note("IA/2026/023", "u-ia2", "ManagementResponse", "Excess cash banked and vouchers traced. Cashier retrained on float limits.", 8);
  file("IA/2026/023", "u-ia2", "petty-cash-recount.pdf", 210_000, 8);
  propose("IA/2026/023", "u-ia2", "Recount matches float and excess banked with deposit slip.", 1);

  later(at(3), () => log(at(3), "u-pia", "import.upload", "ImportBatch", "b-2", null, { filename: batches[1].sourceFilename, rows: 4 }));
  later(at(3, 11), () => log(at(3, 11), "u-pia", "import.confirm", "ImportBatch", "b-2", { status: "Previewed" }, { status: "Confirmed", queries: 4 }));

  const accessRequests: AccessRequest[] = [
    { id: "ar-1", requestedBy: "u-ict", reason: "Evidence file for IA/2026/016 reported as unreadable; need to check storage integrity.", status: "Pending", decidedBy: null, expiresAt: null, createdAt: at(0, 7) },
  ];
  later(at(0, 7), () => log(at(0, 7), "u-ict", "breakglass.request", "AccessRequest", "ar-1", null, { status: "Pending" }, accessRequests[0].reason));

  queue.sort((a, b) => a.ts.localeCompare(b.ts)).forEach((e) => e.run());

  return { users: [...users], batches, queries, revisions, activities, evidence, requests, accessRequests, audit };
}
