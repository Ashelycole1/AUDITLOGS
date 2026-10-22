# design.md: AuditLogs Product and Domain Design

Defines what the system does and how it behaves. For rules that must never be broken, see `system.md`. For technical structure, see `architecture.md`.

## 1. Core workflow

Changed at the owner's request on 2026-10-22 (auditlogs-required-changes.md, DECISIONS 32).

1. **Import:** CIA uploads the final queries file, reviews a preview, confirms.
2. **Lock:** confirmed queries keep their original values; later corrections are CIA revisions.
3. **Assign:** PIA (or CIA) assigns each query to an IA or SIA. The CIA may reassign at any time; a PIA's reassignment waits for the CIA (Pending Approval).
4. **Follow up:** IA or SIA records notes, management responses, evidence.
5. **Propose:** the auditor proposes closure.
6. **Review:** PIA or CIA may return the proposal for more work or keep it in view.
7. **Decide:** CIA closes it.
8. **Monitor:** CEO views the dashboard and responsible personnel, and may comment.

Follow-up notes, management responses, evidence and comments can be added by anyone in the audit chain (IA, SIA, PIA, CIA) who can see the query; an IA or SIA only on their own. The CEO comments too.

## 2. Permission matrix

Y = allowed, N = never, S = only on own assigned queries, R = read only.

IA and SIA have the same rights (S) until the client defines more for the SIA.

| Action | PIA | CIA | IA / SIA | CEO | ICT |
|---|---|---|---|---|---|
| Import file and confirm batch | N | Y | N | N | N |
| View all queries | R | Y | N | summary | N |
| View assigned queries | R | Y | S | N | N |
| View evidence | R | Y | S | N | N |
| Edit query or risk rating | N | Y | N | N | N |
| Assign an unassigned query (to IA or SIA) | Y | Y | N | N | N |
| Reassign | request | Y | N | N | N |
| Approve or reject a reassignment | N | Y | N | N | N |
| Add follow-up note or response | Y | Y | S | N | N |
| Upload evidence | Y | Y | S | N | N |
| Propose closure | N | N | S | N | N |
| Close a proposal | N | Y | N | N | N |
| Return a proposal | Y | Y | N | N | N |
| Keep a proposal in view | Y | Y | N | N | N |
| Comment on a query | Y | Y | S | Y | N |
| Read own notifications | Y | Y | Y | Y | Y |
| View change history | R | Y | S | N | N |
| View CIA Activity view | N | N | N | Y | N |
| View responsible personnel | R | Y | N | Y | N |
| Manage accounts and roles | N | N | N | N | Y |
| Run backups and recovery | N | N | N | N | Y |
| Break-glass access to audit content | N | N | N | N | approved and logged only |
| Export data | request | Y | N | N | N |
| Approve or reject an export | N | Y | N | N | N |

Notes:
- A user who proposed a change can never decide it.
- Any permission not listed is denied by default.

## 3. Data model (fields)

All tables have `id` (UUID), `created_at`, `updated_at` (UTC) unless stated.

**User**: email, full_name, role (PIA/CIA/IA/CEO/ICT), is_active, mfa_enabled, acting_cia_until (nullable).

**ImportBatch**: imported_by, source_filename, source_file_path, source_sha256, status (Previewed/Confirmed/Cancelled), row_count, confirmed_at.

**Query**: reference (unique), batch, title, description_original (immutable), description_current, risk_rating_original, risk_rating_current, status, deadline, responsible_officer, department, current_assignee (nullable), closed_at.

**QueryRevision**: query, field, old_value, new_value, edited_by, reason (required), created_at.

**Assignment**: query, assignee, assigned_by, active (bool), assigned_at, ended_at.

**FollowUpActivity**: query, author, kind (Note/ManagementResponse), body, created_at.

**Evidence**: query, uploaded_by, original_filename, stored_path, sha256, size_bytes, content_type, created_at.

**StatusChangeRequest**: query, from_status, to_status, proposed_by, proposed_reason, decision (Pending/Approved/Rejected), decided_by, decision_reason, decided_at.

**AuditLog** (append-only): seq (bigint, increasing), timestamp, actor, actor_role, action, object_type, object_id, old_value (JSON), new_value (JSON), reason, ip_address, prev_hash, entry_hash.

**RetentionRule**: record_type, retention_months, approved_by, approved_at.

**DisposalRecord**: record_type, object_id, approved_by, disposed_at, reason.

**BreachRegister**: detected_at, description, data_affected, people_affected, actions_taken, pdpo_notified_at, closed_at.

## 4. Import design

- Preferred input: Excel (.xlsx) or CSV. PDF and Word are a fallback and flagged as lower reliability.
- Column mapping is defined by a template the client supplies. Until then, use configurable mapping.
- Steps: upload, parse, validate, show preview, PIA confirms or cancels.
- Preview shows every row, with errors (missing reference, duplicate reference, bad date, unknown rating) highlighted. Confirmation is blocked while blocking errors remain.
- The source file is kept with its SHA-256 hash.
- On confirm, all queries are created in one transaction with status **Imported**, `description_original` set, and an ImportBatch audit entry.
- After confirmation the PIA cannot edit. A bad confirmed import is corrected only by the CIA, field by field, with reasons.
- Duplicate references in a later batch are rejected with a clear message.

## 5. Status workflow

Auditor = the IA or SIA assigned to the query.

| From | To | Who | Rule |
|---|---|---|---|
| Imported | Assigned | PIA, CIA | Assignee (IA or SIA) required |
| Assigned | In Progress | Auditor | Happens on first follow-up entry |
| In Progress | Proposed for Closure | Auditor | Reason and at least one response or evidence item required |
| Proposed for Closure | Closed | CIA | Not the proposer; decision logged |
| Proposed for Closure | Returned | PIA, CIA | Reason required |
| Proposed for Closure | Kept in View | PIA, CIA | Reason required; the query stays under watch, not closed |
| Returned | In Progress | Auditor | Automatic when the auditor resumes work |
| Kept in View | In Progress | Auditor | Automatic when the auditor resumes work |
| Kept in View | Returned | PIA, CIA | Reason required |
| Assigned, In Progress, Returned, Kept in View | Pending Approval | PIA | Reassignment request; reason required |
| Pending Approval | Assigned | CIA | Reassignment approved; the new auditor holds the query |
| Pending Approval | the status before | CIA | Reassignment rejected; reason required |
| Closed | In Progress | CIA | Reopen; reason required |

Any other transition is rejected with an error. The CIA may also change status directly (for example to correct a mistake); this requires a reason and appears on the CIA Activity view.

## 6. Screens by role

**Login:** email, password, then a one-time PIN sent to the work email. Lockout message after repeated failures.

**PIA:** Dashboard, All queries (assign IA or SIA, bulk assign unassigned queries, Export with "Seek approval"), query page (Assign or Request reassignment, Return or Keep in view on a proposal), Reviews (proposals to review, own reassignment and export requests, download approved exports). Import and Batches moved to the CIA (2026-10-22).

**CIA:**
- Queries list: filters by status, risk, assignee, overdue, search by reference or text.
- Query detail: original and current text, revisions, assignment, activity, evidence, status history.
- Assignment: single and bulk assign, reassign with reason.
- Approvals inbox: closure proposals (approve or return), reassignment requests and export requests (approve or reject).
- Import (upload, preview, confirm) and Batch history.
- Comments on any query.
- Reports: status summary, overdue list, export.
- Compliance: retention rules, disposal approvals, breach register, data subject request search.

**IA and SIA:** My queries list, Query workspace (add note, add response, upload evidence, propose status, read CIA and CEO comments), Returned items highlighted.

**CEO:** Dashboard with counts by status, overdue items, due soon, by department and responsible officer. Responsible personnel (each department's responsible owner and auditors, and each open query's owner and auditor). CIA Activity view. Comments on any query; nothing else can be changed.

Visible query details for the CEO (default): reference, title, risk rating, status, department, responsible owner, assigned auditor, deadline, days overdue. Evidence and response text are hidden unless the CIA enables them per the owner's decision.

Everywhere a query is listed, the responsible owner's name is shown under its department.

**ICT:** Users (create, disable, change email or role), Roles, Backups status, System health, Break-glass requests.

## 7. Reassignment

The CIA reassigns directly. A PIA's reassignment is a request: the query is Pending Approval and stays with the current auditor until the CIA approves (it becomes Assigned under the new auditor) or rejects (it returns to its earlier status). A query proposed for closure is reviewed before it can be reassigned. The new auditor sees full history. The old auditor loses access immediately. Every request, decision and move is logged.

## 8. Acting CIA (cover)

ICT can grant a time-limited acting CIA flag on written instruction from the CEO or CIA. It expires automatically and is logged. The acting CIA has CIA rights for that period and appears on the CIA Activity view.

## 9. Notifications (in the app; email later)

Notifications are shown inside AuditLogs for now (owner, 2026-10-22): a bell in the top bar with the unread count, and a Notifications page. Each person sees only their own and can mark them read. Email through the client SMTP server can be switched on later (`NOTIFY_BY_EMAIL=true`) and then carries the same content.

New assignment or reassignment (new auditor), reassignment waiting (CIA), reassignment approved (requesting PIA and new auditor) or rejected (PIA), export waiting (CIA), export approved or rejected (PIA), query returned or kept in view (auditor), new comment by someone else (auditor). Not yet: deadline due in 7 days, query overdue, and the department owner, who has no account. Notifications contain the reference and a link, never evidence or sensitive text such as titles, reasons or comments. Emails, when switched on, are sent after the change is saved; a mail failure is logged and never undoes the change.

## 10. Audit log design

- Every create, update, status change, approval, login, failed login, export, role change, break-glass access and disposal writes an entry.
- Entry fields: seq, timestamp, actor, action, object, old and new values, reason, IP.
- **Hash chain:** `entry_hash = SHA-256(prev_hash || canonical_json(entry_without_hash))`. The first entry uses a fixed genesis value.
- **Nightly verification** recomputes the chain. On mismatch, alert the CIA and ICT and write a breach register draft.
- The CIA can view the log, filter by object, user, action, date.

## 11. CIA Activity view

Lists every direct CIA change: status changes made without a proposal, rating edits, reassignments (direct or approved), query edits, closures. The CEO or Audit Committee can comment on each one but change nothing. This is the control on the person who both edits and approves.

## 12. Compliance features

- Retention rule per record type; disposal needs approval and is logged.
- Breach register with alerts for repeated failed logins, unusual download volume and chain-verification failure.
- Search and export by person or query for data subject requests, with every export logged.
- Break-glass: ICT requests access to audit content with a reason; the CIA approves; access expires after a set time (default 2 hours); everything is logged.

## 13. Validation rules (examples)

- Reference: required, unique, max 50 characters.
- Risk rating: one of Low, Medium, High, Critical, per the Standard Risk Matrix Color Mapping Reference (`assets/`, DECISIONS 31). "Extreme" is accepted as Critical.
- Deadline: valid date; may not be before import date without a warning.
- Evidence: allowed types (pdf, docx, xlsx, png, jpg, csv, txt), size limit 20 MB, hashed on upload.
- Reasons: required, at least 10 characters.

## 14. Non-functional targets

- Available during working hours 99% of the time.
- Restore from backup within 4 hours; at most 24 hours of data loss.
- Pages load in under 3 seconds for 50 concurrent users.
- Session idle timeout 30 minutes.
- Accessible on desktop and tablet browsers; basic mobile layout.
