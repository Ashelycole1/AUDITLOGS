import { useState } from "react";
import { Button, Check, Empty, Label, Notice, PageHeader, Panel, ReasonDialog, Table, cx } from "../components";
import { ROLE_NAME, fmtDateTime } from "../lib/rules";
import { useMe, useStore } from "../storeTypes";
import type { Role } from "../types";

const ROLES: Role[] = ["CIA", "PIA", "SIA", "IA", "CEO", "ICT"];

export function UsersPage() {
  const me = useMe();
  const { state, createUser, setUserActive } = useStore();
  const [form, setForm] = useState({ fullName: "", email: "", role: "IA" as Role });
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "toggle"; userId: string } | null>(null);
  const target = state.users.find((u) => u.id === dialog?.userId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await createUser(form);
    if (!r.ok) return setError(r.error);
    setError(null);
    setFlash(`Account created for ${form.fullName}. Sign-in codes go to their work email.`);
    setForm({ fullName: "", email: "", role: "IA" });
  };

  return (
    <>
      <PageHeader title="Users" lede={`${state.users.filter((u) => u.isActive).length} active accounts. Accounts are never deleted: disabling one keeps its history in the audit log.`} />
      {flash && <div className="mb-4"><Notice tone="ok">{flash}</Notice></div>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel>
          <Table head={["Name", "Role", "Status", <span key="a" className="sr-only">Actions</span>]}>
            {state.users.map((u) => (
              <tr key={u.id} className={cx("align-top", !u.isActive && "text-muted [&_.font-medium]:line-through [&_.font-medium]:decoration-ink/30")}>
                <td>
                  <span className="font-medium">{u.fullName}</span>{u.id === me.id && <span className="ml-1.5 text-[0.8125rem] text-muted">(you)</span>}
                  <span className="block text-[0.8125rem] text-muted">{u.email}</span>
                </td>
                <td className="whitespace-nowrap" title={u.role}>{ROLE_NAME[u.role]}</td>
                <td className="whitespace-nowrap">
                  <span className="flex items-center gap-1.5"><Check ok={u.isActive} />{u.isActive ? "Active" : "Disabled"}</span>
                </td>
                <td className="w-px whitespace-nowrap">
                  {u.id !== me.id && (
                    <div className="-my-2 flex flex-col items-end">
                      <Button kind={u.isActive ? "quiet" : "secondary"} onClick={() => setDialog({ kind: "toggle", userId: u.id })}>{u.isActive ? "Disable" : "Enable"}</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Panel>

        <Panel title="New account" className="self-start">
          <form onSubmit={submit} className="space-y-3" noValidate>
            <div>
              <Label htmlFor="nu-name">Full name</Label>
              <input id="nu-name" className="field" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="nu-email">Work email</Label>
              <input id="nu-email" type="email" className="field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="nu-role">Role</Label>
              <select id="nu-role" className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}
              </select>
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <Button kind="primary" type="submit" className="w-full">Create account</Button>
            <p className="text-[0.8125rem] leading-snug text-muted">They get an email to set a password. Each sign-in then needs a one-time code sent to that email.</p>
          </form>
        </Panel>
      </div>

      <ReasonDialog
        open={!!dialog}
        title={`${target?.isActive ? "Disable" : "Enable"} ${target?.fullName}`}
        description={target?.isActive ? "They are signed out and cannot sign in. Their history stays in the log." : "They can sign in again with their password and an emailed code."}
        confirmLabel={target?.isActive ? "Disable account" : "Enable account"}
        danger={dialog?.kind === "toggle" && target?.isActive}
        onConfirm={async (reason) => {
          const r = await setUserActive(dialog!.userId, !target!.isActive, reason);
          return r.ok ? null : r.error;
        }}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

export function SystemPage() {
  const me = useMe();
  const { state, requestAccess, userName } = useStore();
  const [open, setOpen] = useState(false);
  const mine = state.accessRequests.filter((a) => a.requestedBy === me.id);

  // Placeholder figures until the health endpoint exists (architecture.md 8).
  const checks = [
    { name: "Nightly database backup", detail: "Copied to the second site in Uganda", ok: true },
    { name: "Evidence volume backup", detail: "Encrypted copy present", ok: true },
    { name: "Audit chain verification", detail: "Last nightly run passed", ok: true },
    { name: "Disk space", detail: "68% free", ok: true },
    { name: "Quarterly restore test", detail: "Not yet recorded this quarter. Restore last night's backup to the test server and record the result.", ok: false },
  ];
  const failing = checks.filter((c) => !c.ok).length;

  return (
    <>
      <PageHeader title="System" lede="Backups, health and access requests. ICT has no access to audit content unless the CIA approves a time-limited request." />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Health and backups" aside={<span className={cx("text-sm font-medium", failing ? "text-danger" : "text-good")}>{checks.length - failing} of {checks.length} passing</span>}>
          <ul className="divide-y divide-line">
            {checks.map((c) => (
              <li key={c.name} className={cx("-mx-2 flex items-start gap-3 rounded-md px-2 py-3", !c.ok && "bg-danger-wash/70")}>
                <span className="mt-0.5"><Check ok={c.ok} label={c.ok ? "Passing" : "Needs action"} /></span>
                <div className="flex-1">
                  <p className="font-medium">{c.name}</p>
                  <p className={cx("text-sm", c.ok ? "text-muted" : "text-danger")}>{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Access to audit content" aside={<Button kind="secondary" onClick={() => setOpen(true)}>Request access</Button>}>
          {mine.length ? (
            <ul className="divide-y divide-line">
              {mine.map((a) => (
                <li key={a.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="mt-1"><Check pending={a.status === "Pending"} ok={a.status === "Approved"} /></span>
                  <div className="flex-1">
                  <p className="leading-relaxed">{a.reason}</p>
                  <p className="mt-1 text-sm text-muted">
                    {fmtDateTime(a.createdAt)}.{" "}
                    {a.status === "Pending" && "Waiting for the CIA."}
                    {a.status === "Approved" && `Approved by ${userName(a.decidedBy)} until ${fmtDateTime(a.expiresAt!)}.`}
                    {a.status === "Rejected" && `Refused by ${userName(a.decidedBy)}.`}
                  </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No requests">Request access only when you must open audit content to fix a problem. The CIA decides, and access lasts 2 hours.</Empty>
          )}
        </Panel>
      </div>

      <ReasonDialog
        open={open}
        title="Request access to audit content"
        description="The CIA approves or refuses. Access lasts 2 hours and everything you open is logged."
        confirmLabel="Send request"
        onConfirm={async (reason) => { const r = await requestAccess(reason); return r.ok ? null : r.error; }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
