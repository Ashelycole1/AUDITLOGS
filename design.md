# design.md: AuditLogs Product and Domain Design

Defines what the system does and how it behaves. For rules that must never be broken, see `system.md`. For technical structure, see `architecture.md`.

## 1. Core workflow

1. **Import:** PIA uploads the final queries file, reviews a preview, confirms.
2. **Lock:** confirmed queries are read-only for the PIA.
3. **Assign:** CIA reviews, adjusts risk ratings if needed, assigns each query to an IA.
4. **Follow up:** IA records notes, management responses, evidence.
5. **Propose:** IA proposes a status change.
6. **Decide:** CIA approves or rejects, with a reason on rejection.
7. **Monitor:** CEO views a read-only dashboard throughout.

## 2. Permission matrix

Y = allowed, N = never, S = only on own assigned queries, R = read only.

| Action | PIA | CIA | IA | CEO | ICT |
|---|---|---|---|---|---|
| Import file and confirm batch | Y | N | N | N | N |
| View all queries | R | Y | N | summary | N |
| View assigned queries | R | Y | S | N | N |
| View evidence | R | Y | S | N | N |
| Edit query or risk rating | N | Y | N | N | N |
| Assign or reassign auditor | N | Y | N | N | N |
| Add follow-up note or response | N | Y | S | N | N |
| Upload evidence | N | Y | S | N | N |
| Propose status change | N | N | S | N | N |
| Approve or reject status change | N | Y | N | N | N |
| View change history | R | Y | S | N | N |
| View CIA Activity view | N | N | N | Y | N |
| Manage accounts and roles | N | N | N | N | Y |
| Run backups and recovery | N | N | N | N | Y |
| Break-glass access to audit content | N | N | N | N | approved and logged only |
| Export data | N | Y | N | N | N |

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

| From | To | Who | Rule |
|---|---|---|---|
| Imported | Assigned | CIA | Assignee required |
| Assigned | In Progress | IA | Happens on first follow-up entry |
| In Progress | Proposed for Closure | IA | Reason and at least one response or evidence item required |
| Proposed for Closure | Closed | CIA | Not the proposer; decision logged |
| Proposed for Closure | Returned | CIA | Reason required |
| Returned | In Progress | IA | Automatic when IA resumes work |
| Closed | In Progress | CIA | Reopen; reason required |

Any other transition is rejected with an error. The CIA may also change status directly (for example to correct a mistake); this requires a reason and appears on the CIA Activity view.

## 6. Screens by role

**Login:** email, password, then a one-time PIN sent to the work email. Lockout message after repeated failures.

**PIA:** Import (upload, preview, confirm), Batch history, All queries (read-only), Progress overview.

**CIA:**
- Queries list: filters by status, risk, assignee, overdue, search by reference or text.
- Query detail: original and current text, revisions, assignment, activity, evidence, status history.
- Assignment: single and bulk assign, reassign with reason.
- Approvals inbox: pending status change requests with approve and reject.
- Reports: status summary, overdue list, export.
- Compliance: retention rules, disposal approvals, breach register, data subject request search.

**IA:** My queries list, Query workspace (add note, add response, upload evidence, propose status), Returned items highlighted.

**CEO:** Dashboard with counts by status, overdue items, due soon, by department and responsible officer. CIA Activity view. Read-only.

Visible query details for the CEO (default): reference, title, risk rating, status, responsible officer, deadline, days overdue. Evidence and response text are hidden unless the CIA enables them per the owner's decision.

**ICT:** Users (create, disable, change email or role), Roles, Backups status, System health, Break-glass requests.

## 7. Reassignment

The new IA sees full history. The old IA loses access immediately. Both events are logged. Open status change requests stay pending for the CIA.

## 8. Acting CIA (cover)

ICT can grant a time-limited acting CIA flag on written instruction from the CEO or CIA. It expires automatically and is logged. The acting CIA has CIA rights for that period and appears on the CIA Activity view.

## 9. Notifications (email via client SMTP)

New assignment, returned item, approval waiting for CIA, deadline due in 7 days, query overdue. Emails contain the reference and a link, never evidence or sensitive text.

## 10. Audit log design

- Every create, update, status change, approval, login, failed login, export, role change, break-glass access and disposal writes an entry.
- Entry fields: seq, timestamp, actor, action, object, old and new values, reason, IP.
- **Hash chain:** `entry_hash = SHA-256(prev_hash || canonical_json(entry_without_hash))`. The first entry uses a fixed genesis value.
- **Nightly verification** recomputes the chain. On mismatch, alert the CIA and ICT and write a breach register draft.
- The CIA can view the log, filter by object, user, action, date.

## 11. CIA Activity view

Lists every direct CIA change: status changes made without a proposal, rating edits, reassignments, query edits, closures. Read-only for the CEO or Audit Committee. This is the control on the person who both edits and approves.

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
