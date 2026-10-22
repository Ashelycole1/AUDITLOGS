# AuditLogs: Required System Changes (v2)

**Source:** Handwritten client meeting notes (2 pages), clarified by the project manager
**System:** https://auditlog.ashelycole.dev
**Purpose:** Additions and adjustments requested by the users after reviewing the current build.

> **Status legend:** ✅ Confirmed | ⚠️ Interpretation, confirm with the client before building

---

## 1. Role Hierarchy (confirmed)

The ranking written beside the roles is the official hierarchy. **IA is the lowest rank**, and each role above it has more authority.

| Rank | Role | Position |
|------|------|----------|
| 1st (lowest) | **IA**: Internal Auditor (up to 3 users) | Handles assigned queries |
| 2nd | **SIA**: Internal Auditor, Senior (**NEW ROLE**) | Senior to IA |
| 3rd | **PIA**: Principal Internal Auditor | Assigns and reviews |
| 4th (highest) | **CIA**: Chief Internal Auditor | Final authority: imports, reassigns, approves |

**Outside the audit chain**

| Role | Position |
|------|----------|
| CEO | Oversight: comments on activity, views responsible personnel |
| ICT | System administration, no change noted |

### Rules that follow from the hierarchy
1. **Work flows up the chain:** IA → SIA → PIA → CIA. Queries are escalated, reviewed and approved in that order.
2. **Assignment flows down the chain:** a role can assign only to roles ranked below it. PIA assigns IA and SIA. CIA can assign SIA and reassign any query.
3. **Approvals go to the next rank up:** PIA requests, CIA approves (export, reassignment).
4. **CIA is the final approver** for anything that needs approval.

> This also settles the earlier "PIA to assign" vs "CIA is the one that assigns" question. PIA does day-to-day assignment, and CIA is the top authority who can reassign and approve.

---

## 2. Query Statuses (confirmed)

**Kept in view** is a status in the workflow, together with the other new statuses.

| Status | Meaning | Set by |
|--------|---------|--------|
| Open / Imported | Query imported, not yet assigned | System (on CIA import) |
| Assigned | Allocated to an IA or SIA | PIA, CIA |
| **Pending approval** | Reassignment or export awaiting CIA approval | System |
| **Returned** | Sent back to the assignee for further work | PIA, CIA |
| **Kept in view** | Query stays under watch by the reviewer, not closed | PIA |
| Closed | Resolved | Per the existing system |

- Add all new statuses to filters, badges, dashboards and the query history.
- Every status change is written to the audit trail and triggers a notification where relevant (§7).
- ⚠️ "Kept in view" is listed under PIA in the notes. Confirm whether the CIA can also set it.

---

## 3. Summary of Changes

| # | Change | Role(s) | Status |
|---|--------|---------|--------|
| 1 | Add the **SIA** role and the hierarchy IA < SIA < PIA < CIA | System | ✅ |
| 2 | **Remove Import / Batches** buttons from PIA | PIA | ✅ |
| 3 | Give **Import** to CIA | CIA | ✅ |
| 4 | PIA can **assign IA** and **assign SIA** | PIA | ✅ |
| 5 | CIA can **assign SIA and reassign** | CIA | ✅ |
| 6 | New status **Kept in view** | PIA | ✅ |
| 7 | New status **Returned** | PIA, CIA | ✅ |
| 8 | New status **Pending approval** (assignments and exports) | All | ✅ |
| 9 | CIA can **comment on queries raised by IAs** | CIA | ✅ |
| 10 | **Export approval workflow** (PIA requests, CIA approves) | PIA, CIA | ✅ |
| 11 | **Reassign and approve** with notification | CIA | ✅ |
| 12 | Show **name of responsible owner** under the department | All | ✅ |
| 13 | **Email notifications** | All | ✅ |
| 14 | CEO can **comment on activity** | CEO | ✅ |
| 15 | CEO can **view the responsible personnel** | CEO | ✅ |
| 16 | **Comments (extra), Evidence, Follow-up** | All | ⚠️ |
| 17 | **SRA** | ? | ⚠️ |

---

## 4. Detail by Role

### 4.1 IA (rank 1, lowest)
- Receives queries assigned by the PIA, SIA or CIA.
- Can respond to queries and attach evidence. ⚠️ Confirm Evidence and Follow-up (§9).
- Queries it raises can be commented on by the CIA.
- Cannot assign, import or approve.

### 4.2 SIA (rank 2, new role)
- Receives assignments from the PIA and the CIA.
- Ranked above IA, below PIA.
- Further permissions are not specified. **To be defined with the client.**

### 4.3 PIA (rank 3)
- **Remove** the Import and Batches buttons.
- **Assign IA** and **assign SIA**.
- Set statuses **Returned** and **Kept in view**.
- **Request approval to export** (cannot export directly).
- Reassignment requests go to the CIA for approval.

### 4.4 CIA (rank 4, highest)
- **Import** queries and batches (moved from PIA).
- **Assign SIA and reassign** any query.
- **Reassign and approve**, with a **notification** to the affected users.
- **Approve or reject export requests** from the PIA.
- **Comment on queries raised by the IAs.**

### 4.5 CEO (outside the chain)
- **Comment on activity.**
- **View the responsible personnel** for each query or activity.
- *(A third bullet was started on the page but left blank.)*

### 4.6 ICT
- No changes noted.

---

## 5. Workflows

### 5.1 Import and assignment
1. **CIA** imports the queries (status: Open).
2. **PIA** assigns each query to an **IA** or **SIA** (status: Assigned).
3. Assignee and department owner receive an **email notification**.
4. **CIA** can assign an SIA or reassign at any time.

### 5.2 Escalation and review (up the chain)
1. IA or SIA works the query and responds.
2. **PIA** reviews. The result is one of:
   - **Returned** to the assignee for more work,
   - **Kept in view** (under watch, not closed),
   - or passed on for closure.
3. **CIA** has final oversight and may comment on IA queries.

### 5.3 Reassignment approval
1. A query is reassigned and its status becomes **Pending approval**.
2. **CIA approves**, and a **notification** is sent.
3. On approval the status returns to **Assigned** under the new owner.

### 5.4 Export approval
1. PIA clicks **Export** and is prompted to **Seek approval**.
2. An export request is created (status: **Pending approval**).
3. **CIA** is notified and approves or rejects.
4. On approval, PIA is notified and can download the export.

---

## 6. UI Changes

- **Remove** Import / Batches from the PIA view and show them for the CIA only.
- **Add** an Assign / Reassign control with a role picker that only lists roles ranked below the user (IA and SIA for PIA).
- **Add** an Export button with the "Seek approval" flow, and an **Approvals** inbox for the CIA.
- **Show the "Responsible owner" name** under the department on query cards and tables.
- **Add statuses** (Pending approval, Returned, Kept in view) to filters, badges and dashboard counts.
- **Add comment boxes** for the CIA (on IA queries) and the CEO (on activity).
- **Add a CEO view** of responsible personnel.

---

## 7. Email Notifications

| Event | Recipient |
|-------|-----------|
| Query assigned / reassigned | New assignee, department owner |
| Reassignment awaiting approval | CIA |
| Reassignment approved | PIA, new assignee |
| Export approval requested | CIA |
| Export approved / rejected | PIA |
| Query returned | Assigned IA / SIA |
| Query marked Kept in view | Assignee, department owner |
| New comment (CIA / CEO) | Query owner |

> **Dependency:** Staging has **no SMTP service connected**. A mail provider (SMTP, SendGrid, Mailgun, etc.) must be configured before these can be tested.

---

## 8. Technical Implementation Notes
*(Stack: Django + DRF, React, PostgreSQL.)*

**Backend (Django / DRF)**
- Add `SIA` to the role choices and define a numeric **rank** (IA=1, SIA=2, PIA=3, CIA=4). Use it in permission checks, e.g. `can_assign(actor, target)` allows assignment only to a lower rank, with CIA allowed to reassign anyone.
- Query statuses: add `PENDING_APPROVAL`, `RETURNED`, `KEPT_IN_VIEW`.
- New models: `ExportRequest` (requester, status, approver, timestamps), `ReassignmentRequest` (query, from, to, status, approver), `Comment` (query, author, role, body).
- Endpoints: assign, reassign, approve/reject, export request, comment.
- Make import and batch endpoints CIA-only.
- Email via Django's email backend with notifications fired from signals or a task queue.
- Log every action in the audit trail.

**Frontend (React)**
- Role- and rank-based rendering of buttons and menus.
- Approvals inbox, assignment modal, comment panel, CEO personnel view.

**Database (PostgreSQL)**
- Migrations for the new role, statuses and tables.

> The live site renders client-side and could not be read automatically, so this list comes from the notes alone. **Compare it against the current build** and drop anything already implemented.

---

## 9. Remaining Items to Confirm

1. **"SRA"** (circled): possibly *Seek Reassignment Approval*. Not clear from the notes.
2. **"Evidence" and "Follow-up"** (starred) and **"Comments, extra"**: new tabs or fields on each query? Who can add evidence?
3. **SIA permissions** beyond receiving assignments.
4. **CEO's third bullet** (left blank).
5. **Kept in view:** can CIA also set it?
6. **Notification recipients:** confirm the table in §7, and whether in-app notifications are also wanted.

---

## 10. Suggested Build Order

1. SIA role, rank hierarchy and permission changes (Import moves to CIA, buttons removed for PIA)
2. New statuses (Pending approval, Returned, Kept in view)
3. Assign / reassign with owner name under the department
4. Export approval workflow and CIA approvals inbox
5. Comments (CIA, CEO) and the CEO personnel view
6. Email notifications (once SMTP is connected)
7. Evidence / Follow-up / SRA once clarified
