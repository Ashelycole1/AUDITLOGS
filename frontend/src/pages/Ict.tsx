import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Check, Empty, Label, Notice, PageHeader, Panel, ReasonDialog, Table, cx } from "../components";
import { ROLE_NAME, fmtDate, isOpen } from "../lib/rules";
import { useMe, useStore, type Enrolment } from "../storeTypes";
import type { Role, User } from "../types";
import { RegisteredNumbersCard, SystemStatsCard } from "../widgets";
import { AccessRequests, BreachRegister, timeLeft } from "./Compliance";

const ROLES: Role[] = ["CIA", "PIA", "SIA", "IA", "CEO", "ICT"];
const MAX_ACTING_DAYS = 90;

type UserDialog = { kind: "toggle" | "link" | "acting" | "endActing"; user: User };

/** What a one-time link produced: where it went, and the link itself where there is no mail server. */
function EnrolmentNotice({ name, sent }: { name: string; sent: Enrolment }) {
  return (
    <Notice tone="ok">
      A link to choose a password was sent to {name}{sent.sentTo ? ` at ${sent.sentTo}` : ""}. It works once.
      {sent.link && (
        <span className="mt-1 block">
          No mail server here, so pass it on yourself: <span className="break-all font-mono text-[0.8125rem] select-all">{sent.link}</span>
        </span>
      )}
    </Notice>
  );
}

export function UsersPage() {
  const me = useMe();
  const { state, createUser, setUserActive, sendEnrolment, setActingCia, orgRoles } = useStore();
  // Only the roles whose dashboards the platform administrator switched on (auditlogs-additions_final.md 5).
  const roles = ROLES.filter((r) => orgRoles.includes(r as (typeof orgRoles)[number]));
  const [form, setForm] = useState({ fullName: "", email: "", role: "IA" as Role });
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<React.ReactNode>(null);
  const [dialog, setDialog] = useState<UserDialog | null>(null);
  const [until, setUntil] = useState("");
  const target = dialog?.user;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await createUser(form);
    if (!r.ok) return setError(r.error);
    setError(null);
    setFlash(<EnrolmentNotice name={form.fullName} sent={r} />);
    setForm({ fullName: "", email: "", role: "IA" });
  };

  const open = (kind: UserDialog["kind"], user: User) => {
    setUntil("");
    setDialog({ kind, user });
  };

  const latest = new Date(Date.now() + MAX_ACTING_DAYS * 86_400_000).toISOString().slice(0, 10);
  const copy: Record<UserDialog["kind"], { title: string; description: string; confirm: string; danger?: boolean }> = {
    toggle: target?.isActive
      ? { title: `Disable ${target.fullName}`, description: "They are signed out and cannot sign in. Their history stays in the log.", confirm: "Disable account", danger: true }
      : { title: `Enable ${target?.fullName}`, description: "They can sign in again with their password and an emailed code.", confirm: "Enable account" },
    link: {
      title: `Send ${target?.fullName} a sign-in link`,
      description: "For a first sign-in or a forgotten password. Any earlier link stops working, and they choose a new password.",
      confirm: "Send link",
    },
    acting: {
      title: `Make ${target?.fullName} acting CIA`,
      description: `They get the CIA's rights until the end of the day you choose, at most ${MAX_ACTING_DAYS} days. Record whose written instruction this follows.`,
      confirm: "Grant CIA rights",
    },
    endActing: { title: `End ${target?.fullName}'s acting CIA rights`, description: "They go back to Principal Internal Auditor at once.", confirm: "End rights", danger: true },
  };
  const c = dialog ? copy[dialog.kind] : null;

  return (
    <>
      <PageHeader title="Users" lede={`${state.users.filter((u) => u.isActive).length} active accounts. Accounts are never deleted: disabling one keeps its history in the audit log.`} />
      {flash && <div className="mb-4">{flash}</div>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel>
          <Table head={["Name", "Role", "Status", <span key="a" className="sr-only">Actions</span>]}>
            {state.users.map((u) => {
              const base = u.baseRole ?? u.role;
              const acting = !!u.actingCiaUntil && Date.parse(u.actingCiaUntil) > Date.now();
              const waiting = u.isActive && u.hasPassword === false;
              return (
                <tr key={u.id} className={cx("align-top", !u.isActive && "text-muted [&_.font-medium]:line-through [&_.font-medium]:decoration-ink/30")}>
                  <td>
                    <span className="font-medium">{u.fullName}</span>{u.id === me.id && <span className="ml-1.5 text-[0.8125rem] text-muted">(you)</span>}
                    <span className="block text-[0.8125rem] text-muted">{u.email}</span>
                  </td>
                  <td className="whitespace-nowrap" title={base}>
                    {ROLE_NAME[base]}
                    {acting && <span className="block text-[0.8125rem] font-medium text-warn">Acting CIA until {fmtDate(u.actingCiaUntil!)}</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      <Check ok={u.isActive && !waiting} pending={waiting} />
                      {!u.isActive ? "Disabled" : waiting ? "Not signed in yet" : "Active"}
                    </span>
                  </td>
                  <td className="w-px whitespace-nowrap">
                    {u.id !== me.id && (
                      <div className="-my-2 flex flex-col items-end">
                        <Button kind={u.isActive ? "quiet" : "secondary"} onClick={() => open("toggle", u)}>{u.isActive ? "Disable" : "Enable"}</Button>
                        {u.isActive && <Button kind="quiet" onClick={() => open("link", u)}>Send sign-in link</Button>}
                        {u.isActive && base === "PIA" && (acting
                          ? <Button kind="quiet" onClick={() => open("endActing", u)}>End acting CIA</Button>
                          : <Button kind="quiet" onClick={() => open("acting", u)}>Make acting CIA</Button>)}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
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
                {roles.map((r) => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}
              </select>
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <Button kind="primary" type="submit" className="w-full">Create account</Button>
            <p className="text-[0.8125rem] leading-snug text-muted">They get a one-time link to choose a password. Each sign-in then needs a code sent to that email.</p>
          </form>
        </Panel>
      </div>

      <ReasonDialog
        open={!!dialog}
        title={c?.title ?? ""}
        description={c?.description}
        confirmLabel={c?.confirm ?? ""}
        danger={c?.danger}
        onConfirm={async (reason) => {
          const { kind, user } = dialog!;
          if (kind === "toggle") {
            const r = await setUserActive(user.id, !user.isActive, reason);
            return r.ok ? null : r.error;
          }
          if (kind === "link") {
            const r = await sendEnrolment(user.id, reason);
            if (r.ok) setFlash(<EnrolmentNotice name={user.fullName} sent={r} />);
            return r.ok ? null : r.error;
          }
          if (kind === "acting" && !until) return "Choose the last day of cover.";
          // The rights run to the end of the chosen day, Kampala time.
          const r = await setActingCia(user.id, kind === "acting" ? `${until}T23:59:59+03:00` : null, reason);
          return r.ok ? null : r.error;
        }}
        onClose={() => setDialog(null)}
      >
        {dialog?.kind === "acting" && (
          <div className="mb-3">
            <Label htmlFor="acting-until">Last day of cover</Label>
            <input id="acting-until" type="date" className="field w-48" min={new Date().toISOString().slice(0, 10)} max={latest} value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
        )}
      </ReasonDialog>
    </>
  );
}

export function SystemPage() {
  const { mode } = useStore();
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
      <PageHeader title="System" lede="Backups, health and the breach register. ICT has no access to audit content unless the CIA approves a time-limited break-glass request." />
      <div className="mb-5 grid gap-5 xl:grid-cols-2 empty:hidden">
        <RegisteredNumbersCard />
        <SystemStatsCard />
      </div>
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
        {mode === "api" ? <BreachRegister /> : (
          <Panel title="Breach register"><Empty title="Needs the server">The CIA and ICT keep the breach register together once connected to the server.</Empty></Panel>
        )}
      </div>
    </>
  );
}

// ICT asks; the CIA decides; reads are logged one by one (design.md 12). Read only, never write.
export function BreakGlassPage() {
  const me = useMe();
  const { state, requestAccess, refresh, visibleQueries } = useStore();
  const [asking, setAsking] = useState(false);
  const [hours, setHours] = useState(2);
  // Pick up the CIA's decision without signing in again.
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = state.accessRequests.filter((a) => a.requestedBy === me.id);
  const current = mine.find(isOpen);
  const waiting = mine.some((a) => a.status === "Pending");

  return (
    <>
      <PageHeader
        title="Break-glass access"
        lede="Read audit content only when you must, to fix a problem. The CIA approves each request, access ends on its own, and every page and file you open is recorded."
        actions={!current && !waiting && <Button kind="primary" onClick={() => setAsking(true)}>Request access</Button>}
      />
      {current && (
        <div className="mb-5">
          <Notice tone="warn">
            <span className="font-medium">Access is open, {timeLeft(current.expiresAt!)}.</span> You can read but not change anything.{" "}
            <Link to="/queries" className="font-medium underline">Open the {visibleQueries.length} queries</Link>
          </Notice>
        </div>
      )}
      <Panel title="Your requests">
        <AccessRequests />
      </Panel>

      <ReasonDialog
        open={asking}
        title="Request access to audit content"
        description="Say what is broken and why you need to read the content. The CIA approves or refuses."
        confirmLabel="Send request"
        onConfirm={async (reason) => { const r = await requestAccess(reason, hours); return r.ok ? null : r.error; }}
        onClose={() => setAsking(false)}
      >
        <div className="mb-3">
          <Label htmlFor="bg-hours">For how long</Label>
          <select id="bg-hours" className="field w-40" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {[1, 2, 3, 4, 6, 8].map((h) => <option key={h} value={h}>{h} {h === 1 ? "hour" : "hours"}</option>)}
          </select>
        </div>
      </ReasonDialog>
    </>
  );
}
