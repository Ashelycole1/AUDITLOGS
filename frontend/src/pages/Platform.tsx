// The System Administrator's pages (auditlogs-additions_final.md 4 and 5): institutions, their status,
// their package of features and their first administrator. Counts only; never an organization's audit
// content. These talk to the API directly; the in-browser demo has no platform.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { Button, Check, Empty, Label, Notice, PageHeader, Panel, ReasonDialog, Stat, Table, cx } from "../components";
import { fmtDate, fmtDateTime } from "../lib/rules";
import { useStore } from "../storeTypes";
import type { FeatureKey, OrgStatus } from "../types";

type Raw = Record<string, unknown>;

interface Org {
  id: string;
  name: string;
  country: string;
  contactPerson: string;
  email: string;
  phone: string;
  status: OrgStatus;
  emailVerifiedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  features: Record<FeatureKey, boolean>;
  users: number;
  activeUsers: number;
  queries: number;
  administrators: { id: string; full_name: string; email: string; is_active: boolean }[];
}

const toOrg = (o: Raw): Org => ({
  id: String(o.id),
  name: String(o.name),
  country: String(o.country),
  contactPerson: String(o.contact_person),
  email: String(o.email),
  phone: String(o.phone ?? ""),
  status: o.status as OrgStatus,
  emailVerifiedAt: (o.email_verified_at as string) ?? null,
  approvedAt: (o.approved_at as string) ?? null,
  createdAt: String(o.created_at),
  features: o.features as Org["features"],
  users: Number(o.users ?? 0),
  activeUsers: Number(o.active_users ?? 0),
  queries: Number(o.queries ?? 0),
  administrators: (o.administrators as Org["administrators"]) ?? [],
});

const message = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");

const DASHBOARDS: { key: FeatureKey; label: string; note: string }[] = [
  { key: "dashboard.IA", label: "IA dashboard", note: "Must stay on: queries are worked here." },
  { key: "dashboard.SIA", label: "SIA dashboard", note: "Senior Internal Auditors." },
  { key: "dashboard.PIA", label: "PIA dashboard", note: "Principal Internal Auditors assign and review." },
  { key: "dashboard.CIA", label: "CIA dashboard", note: "Imports, approvals, exports and the audit log." },
  { key: "dashboard.CEO", label: "CEO dashboard", note: "Read-only overview." },
];
const COMPONENTS: { key: FeatureKey; label: string; note: string }[] = [
  { key: "component.status_pie", label: "Query status pie chart", note: "Worked on, not worked on and allocated, with a key." },
  { key: "component.registered_numbers", label: "Registered numbers", note: "Counts of people and records." },
  { key: "component.system_stats", label: "System stats", note: "Workload, activity and storage." },
];
const PRESETS: { key: string; label: string }[] = [
  { key: "full", label: "Full" },
  { key: "core", label: "Core: IA, PIA, CIA, CEO" },
];

const STATUS_TONE: Record<OrgStatus, string> = {
  Pending: "bg-warn-wash text-warn ring-warn-ring",
  Active: "bg-good-wash text-good ring-good-ring",
  Suspended: "bg-danger-wash text-danger ring-danger-ring",
  Deactivated: "bg-chip text-muted ring-chip-ring",
  Rejected: "bg-chip text-muted ring-chip-ring",
};

function OrgStatusBadge({ status }: { status: OrgStatus }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", STATUS_TONE[status])}>{status}</span>;
}

function ApiOnly() {
  return <Notice tone="info">Platform administration works against the server. Connect the app to the API to use it.</Notice>;
}

const EMPTY_FORM = { name: "", country: "Uganda", contact_person: "", email: "", phone: "", admin_name: "", admin_email: "", preset: "full" };

export function PlatformHome() {
  const { mode } = useStore();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [stats, setStats] = useState<{ organizations: number; users: number; queries: number; by_status: Record<OrgStatus, number> } | null>(null);
  const [filter, setFilter] = useState<OrgStatus | "">("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [created, setCreated] = useState<{ name: string; sentTo?: string; link?: string } | null>(null);

  const load = async () => {
    try {
      const [list, s] = await Promise.all([api.get<Raw[]>("/platform/organizations"), api.get<Raw>("/platform/stats")]);
      setOrgs(list.map(toOrg));
      setStats(s as never);
    } catch (e) {
      setError(message(e));
    }
  };
  useEffect(() => { if (mode === "api") load(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.post<Raw>("/platform/organizations", form);
      const admin = r.admin as Raw | undefined;
      setCreated({ name: String(r.name), sentTo: admin ? String(admin.sent_to) : undefined, link: admin?.set_password_link as string | undefined });
      setForm(EMPTY_FORM);
      setCreating(false);
      setError(null);
      await load();
    } catch (err) {
      setError(message(err));
    }
  };

  if (mode !== "api") return <><PageHeader title="Organizations" /><ApiOnly /></>;
  const pending = (orgs ?? []).filter((o) => o.status === "Pending");
  const shown = (orgs ?? []).filter((o) => !filter || o.status === filter);

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Organizations"
        lede="Every institution on AuditLogs, its status and what it has switched on. You see counts, never an organization's audit records."
        actions={<Button kind="primary" onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New organization"}</Button>}
      />
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
      {created && (
        <div className="mb-4">
          <Notice tone="ok">
            {created.name} is active.
            {created.sentTo && <> A link to choose a password was emailed to {created.sentTo}.</>}
            {created.link && <> Outside production the link is also shown here: <a className="break-all font-medium underline" href={created.link}>{created.link}</a></>}
          </Notice>
        </div>
      )}

      {stats && (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Organizations" value={stats.organizations} />
          <Stat label="Waiting for approval" value={stats.by_status.Pending ?? 0} tone={stats.by_status.Pending ? "warn" : undefined} />
          <Stat label="Users" value={stats.users} />
          <Stat label="Queries" value={stats.queries} />
        </div>
      )}

      {creating && (
        <Panel title="New organization" subtitle="Created active with the package you choose. Its first administrator gets a one-time link to choose a password." className="mb-5">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            {([
              ["name", "Organization name", true],
              ["country", "Country", true],
              ["contact_person", "Contact person", true],
              ["email", "Contact email", true],
              ["phone", "Phone", false],
              ["admin_name", "Administrator's name", false],
              ["admin_email", "Administrator's email", false],
            ] as const).map(([key, label, required]) => (
              <div key={key}>
                <Label htmlFor={`o-${key}`}>{label}</Label>
                <input id={`o-${key}`} className="field" type={key.includes("email") ? "email" : "text"} required={required} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </div>
            ))}
            <div>
              <Label htmlFor="o-preset">Package</Label>
              <select id="o-preset" className="field" value={form.preset} onChange={(e) => setForm({ ...form, preset: e.target.value })}>
                {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2"><Button kind="primary" type="submit">Create organization</Button></div>
          </form>
        </Panel>
      )}

      {pending.length > 0 && (
        <Panel title="Waiting for approval" subtitle="Sign-ups wait here until you approve or reject them" className="mb-5 !border-warn-ring">
          <ul className="divide-y divide-line">
            {pending.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div>
                  <Link to={`/platform/organizations/${o.id}`} className="font-medium hover:text-lake hover:underline">{o.name}</Link>
                  <p className="text-sm text-muted">{o.contactPerson}, {o.email}. Signed up {fmtDate(o.createdAt)}. {o.emailVerifiedAt ? "Email confirmed." : "Email not confirmed yet."}</p>
                </div>
                <Link to={`/platform/organizations/${o.id}`} className="inline-flex min-h-10 items-center rounded-[5px] border border-rule px-4 text-sm font-medium hover:bg-hover">Review</Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="All organizations"
        aside={
          <select aria-label="Status" className="field !w-auto" value={filter} onChange={(e) => setFilter(e.target.value as OrgStatus | "")}>
            <option value="">Any status</option>
            {(["Pending", "Active", "Suspended", "Deactivated", "Rejected"] as OrgStatus[]).map((s) => <option key={s}>{s}</option>)}
          </select>
        }
      >
        <Table head={["Organization", "Status", "Users", "Queries", "Since"]} empty={orgs && !shown.length && <div className="px-5 pb-2 sm:px-6"><Empty title="No organizations">None match this status.</Empty></div>}>
          {shown.map((o) => (
            <tr key={o.id}>
              <td className="min-w-[14rem]"><Link to={`/platform/organizations/${o.id}`} className="font-medium hover:text-lake hover:underline">{o.name}</Link><span className="block text-[0.8125rem] text-muted">{o.country}</span></td>
              <td><OrgStatusBadge status={o.status} /></td>
              <td className="tabular-nums">{o.activeUsers} <span className="text-faint">of {o.users}</span></td>
              <td className="tabular-nums">{o.queries}</td>
              <td className="whitespace-nowrap">{fmtDate(o.approvedAt ?? o.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}

type Move = "approve" | "reject" | "suspend" | "reactivate" | "deactivate";
const MOVES: Record<OrgStatus, Move[]> = {
  Pending: ["approve", "reject"],
  Active: ["suspend", "deactivate"],
  Suspended: ["reactivate", "deactivate"],
  Deactivated: ["reactivate"],
  Rejected: [],
};
const MOVE_LABEL: Record<Move, string> = { approve: "Approve", reject: "Reject", suspend: "Suspend", reactivate: "Reactivate", deactivate: "Deactivate" };
const MOVE_TEXT: Record<Move, string> = {
  approve: "Its people can sign in once approved. The package below is applied; you can change it later.",
  reject: "The sign-up is refused and nobody from it can sign in. The contact is emailed.",
  suspend: "Everyone in it is signed out and cannot sign in until it is reactivated. Its data is kept.",
  reactivate: "Its people can sign in again, with the package it had.",
  deactivate: "Its access ends. Its data is kept, and it can be reactivated later.",
};

export function OrganizationPage() {
  const { id } = useParams();
  const { mode } = useStore();
  const [org, setOrg] = useState<Org | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [preset, setPreset] = useState("full");
  const [wanted, setWanted] = useState<Record<FeatureKey, boolean> | null>(null);
  const [savingFeatures, setSavingFeatures] = useState(false);
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState({ name: "", country: "", contact_person: "", email: "", phone: "" });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [admin, setAdmin] = useState({ full_name: "", email: "" });
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminLink, setAdminLink] = useState<{ sentTo: string; link?: string } | null>(null);

  const fullPackage = () => Object.fromEntries([...DASHBOARDS, ...COMPONENTS].map((f) => [f.key, true])) as Record<FeatureKey, boolean>;
  const show = (o: Org) => {
    setOrg(o);
    // A pending organization has no package yet; approval applies the default one unless changed here.
    setWanted(o.status === "Pending" ? fullPackage() : o.features);
    setDetails({ name: o.name, country: o.country, contact_person: o.contactPerson, email: o.email, phone: o.phone });
  };
  const load = () => api.get<Raw>(`/platform/organizations/${id}`).then((r) => show(toOrg(r))).catch((e) => setError(message(e)));
  useEffect(() => { if (mode === "api") load(); }, [id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (mode !== "api") return <><PageHeader title="Organization" /><ApiOnly /></>;
  if (!org || !wanted) return error ? <div className="mx-auto max-w-lg pt-16"><Empty title="Organization not found">{error}</Empty></div> : <p className="text-sm text-muted" role="status">Loading</p>;

  const changed = org.status === "Pending" ? [] : (Object.keys(wanted) as FeatureKey[]).filter((k) => wanted[k] !== org.features[k]);
  const run = async (fn: () => Promise<Raw>, done: string): Promise<string | null> => {
    try {
      show(toOrg(await fn()));
      setFlash(done);
      setError(null);
      return null;
    } catch (e) {
      return message(e);
    }
  };

  const toggle = (key: FeatureKey) => setWanted({ ...wanted, [key]: !wanted[key] });
  const applyPreset = (p: string) => {
    setPreset(p);
    const all = fullPackage();
    setWanted(p === "core" ? { ...all, "dashboard.SIA": false } : all);
  };

  return (
    <>
      <Link to="/platform" className="inline-flex min-h-10 items-center text-sm font-medium text-lake hover:underline">Organizations</Link>
      <PageHeader
        eyebrow="Organization"
        title={org.name}
        lede={`${org.country}. ${org.activeUsers} active ${org.activeUsers === 1 ? "user" : "users"}, ${org.queries} ${org.queries === 1 ? "query" : "queries"}.`}
        actions={MOVES[org.status].map((m) => (
          <Button key={m} kind={m === "approve" || m === "reactivate" ? "primary" : m === "reject" || m === "deactivate" ? "danger" : "secondary"} onClick={() => setMove(m)}>{MOVE_LABEL[m]}</Button>
        ))}
      />
      {flash && <div className="mb-4"><Notice tone="ok">{flash}</Notice></div>}
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Panel
          title="Features"
          subtitle="What this organization gets. Anything off is hidden and refused by the server. Turning something off only hides it: its data is kept."
          aside={
            <select aria-label="Preset" className="field !w-auto" value={preset} onChange={(e) => applyPreset(e.target.value)}>
              {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          }
        >
          {[
            { title: "Dashboards", items: DASHBOARDS },
            { title: "Dashboard components", items: COMPONENTS },
          ].map((group) => (
            <fieldset key={group.title} className="mb-5 last:mb-0">
              <legend className="eyebrow mb-2">{group.title}</legend>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {group.items.map((f) => (
                  <li key={f.key}>
                    <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        role="switch"
                        className="size-4 accent-lake"
                        checked={wanted[f.key]}
                        disabled={f.key === "dashboard.IA"}
                        onChange={() => toggle(f.key)}
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{f.label}</span>
                        <span className="block text-[0.8125rem] text-muted">{f.note}</span>
                      </span>
                      {org.status !== "Pending" && wanted[f.key] !== org.features[f.key] && <span className="text-xs font-medium text-warn">Changed</span>}
                    </label>
                  </li>
                ))}
                {group.title === "Dashboards" && (
                  <li className="flex min-h-12 items-center gap-3 px-3 py-2.5 text-sm">
                    <Check ok label="Always on" />
                    <span className="flex-1"><span className="block font-medium">ICT Admin</span><span className="block text-[0.8125rem] text-muted">Always on: an organization must be able to manage itself.</span></span>
                  </li>
                )}
              </ul>
            </fieldset>
          ))}
          {org.status !== "Pending" && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button kind="primary" disabled={!changed.length || savingFeatures} onClick={() => setSavingFeatures(true)}>Save {changed.length || ""} {changed.length === 1 ? "change" : "changes"}</Button>
              {changed.length > 0 && <Button kind="quiet" onClick={() => setWanted(org.features)}>Undo</Button>}
              <p className="text-[0.8125rem] text-faint">A role cannot be switched off while active people hold it. Changes apply at their next page load.</p>
            </div>
          )}
          {org.status === "Pending" && <p className="mt-4 text-[0.8125rem] text-muted">These switches are applied when you approve the organization.</p>}
        </Panel>

        <div className="space-y-5">
          <Panel title="Details" aside={<Button kind="quiet" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit"}</Button>}>
            {editing ? (
              <form onSubmit={(e) => { e.preventDefault(); setDetailsOpen(true); }} className="grid gap-3">
                {(["name", "country", "contact_person", "email", "phone"] as const).map((k) => (
                  <div key={k}>
                    <Label htmlFor={`d-${k}`}>{k.replace("_", " ").replace(/^./, (c) => c.toUpperCase())}</Label>
                    <input id={`d-${k}`} className="field" type={k === "email" ? "email" : "text"} value={details[k]} onChange={(e) => setDetails({ ...details, [k]: e.target.value })} />
                  </div>
                ))}
                <div><Button kind="primary" type="submit">Save details</Button></div>
              </form>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Status</dt><dd><OrgStatusBadge status={org.status} /></dd>
                <dt className="text-muted">Contact</dt><dd>{org.contactPerson}</dd>
                <dt className="text-muted">Email</dt><dd className="break-all">{org.email}{org.emailVerifiedAt ? <span className="block text-good">Confirmed {fmtDate(org.emailVerifiedAt)}</span> : <span className="block text-warn">Not confirmed</span>}</dd>
                <dt className="text-muted">Phone</dt><dd>{org.phone || <span className="text-faint">Not given</span>}</dd>
                <dt className="text-muted">Signed up</dt><dd>{fmtDateTime(org.createdAt)}</dd>
                {org.approvedAt && <><dt className="text-muted">Approved</dt><dd>{fmtDateTime(org.approvedAt)}</dd></>}
              </dl>
            )}
          </Panel>

          <Panel title="Administrators" subtitle="The organization's ICT administrators manage its people">
            {org.administrators.length ? (
              <ul className="mb-4 divide-y divide-line text-sm">
                {org.administrators.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <span><span className="block font-medium">{a.full_name}</span><span className="block break-all text-muted">{a.email}</span></span>
                    <span className="flex items-center gap-2">
                      {!a.is_active && <span className="text-xs text-faint">Disabled</span>}
                      <Button kind="quiet" onClick={() => { setAdmin({ full_name: a.full_name, email: a.email }); setAdminOpen(true); }}>Reset</Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-muted">No administrator yet.</p>
            )}
            <form onSubmit={(e) => { e.preventDefault(); setAdminOpen(true); }} className="grid gap-2">
              <Label htmlFor="a-name">New administrator</Label>
              <input id="a-name" className="field" placeholder="Full name" required value={admin.full_name} onChange={(e) => setAdmin({ ...admin, full_name: e.target.value })} />
              <input aria-label="Email" className="field" type="email" placeholder="Work email" required value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
              <div><Button kind="secondary" type="submit">Set up administrator</Button></div>
            </form>
            {adminLink && (
              <div className="mt-3">
                <Notice tone="ok">
                  A one-time link to choose a password was emailed to {adminLink.sentTo}.
                  {adminLink.link && <> Outside production it is also shown here: <a className="break-all font-medium underline" href={adminLink.link}>{adminLink.link}</a></>}
                </Notice>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <ReasonDialog
        open={move !== null}
        title={move ? `${MOVE_LABEL[move]} ${org.name}` : ""}
        description={move ? MOVE_TEXT[move] : undefined}
        confirmLabel={move ? MOVE_LABEL[move] : ""}
        danger={move === "reject" || move === "deactivate" || move === "suspend"}
        optional={move === "approve"}
        onConfirm={(reason) =>
          run(
            () => api.post<Raw>(`/platform/organizations/${id}/${move}`, move === "approve" ? { reason, features: wanted } : { reason }),
            `${org.name}: ${move === "approve" ? "approved" : `${move}d`}.`,
          )
        }
        onClose={() => setMove(null)}
      />
      <ReasonDialog
        open={savingFeatures}
        title="Save feature changes"
        description={`${changed.length} ${changed.length === 1 ? "switch changes" : "switches change"}. The change is recorded with your name and reason.`}
        confirmLabel="Save"
        optional
        onConfirm={(reason) =>
          run(() => api.put<Raw>(`/platform/organizations/${id}/features`, { features: wanted, reason }), "Features saved.")
        }
        onClose={() => setSavingFeatures(false)}
      />
      <ReasonDialog
        open={detailsOpen}
        title="Save details"
        confirmLabel="Save"
        onConfirm={async (reason) => {
          const err = await run(() => api.patch<Raw>(`/platform/organizations/${id}`, { ...details, reason }), "Details saved.");
          if (!err) setEditing(false);
          return err;
        }}
        onClose={() => setDetailsOpen(false)}
      />
      <ReasonDialog
        open={adminOpen}
        title={`Administrator: ${admin.full_name || admin.email}`}
        description="A new administrator gets a one-time link to choose a password. Resetting an existing one stops their old password, clears any lockout and sends a fresh link; give a reason."
        confirmLabel="Send link"
        optional={!org.administrators.some((a) => a.email === admin.email.trim().toLowerCase())}
        onConfirm={async (reason) => {
          try {
            const r = await api.post<Raw>(`/platform/organizations/${id}/admin`, { ...admin, reason });
            const a = r.admin as Raw;
            setAdminLink({ sentTo: String(a.sent_to), link: a.set_password_link as string | undefined });
            show(toOrg(r));
            setAdmin({ full_name: "", email: "" });
            return null;
          } catch (e) {
            return message(e);
          }
        }}
        onClose={() => setAdminOpen(false)}
      />
    </>
  );
}

interface LogRow { seq: number; timestamp: string; actor_name: string | null; action: string; organization_name: string | null; reason: string; new_value: unknown }

export function PlatformLogPage() {
  const { mode } = useStore();
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; checked: number; broken_at: number | null } | null>(null);
  useEffect(() => {
    if (mode !== "api") return;
    api.get<{ results: LogRow[] }>("/platform/audit-log").then((r) => setRows(r.results)).catch((e) => setError(message(e)));
  }, [mode]);
  if (mode !== "api") return <><PageHeader title="Platform log" /><ApiOnly /></>;
  const verify = async () => {
    try {
      setResult(await api.post("/platform/audit-log/verify"));
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Platform log"
        lede="What platform administrators did and the organizations' sign-ups and status changes. Organizations' audit entries stay with them."
        actions={<Button kind="secondary" onClick={verify}>Verify the whole chain</Button>}
      />
      {result && <div className="mb-4"><Notice tone={result.ok ? "ok" : "error"}>{result.ok ? `The chain is intact: ${result.checked} entries checked.` : `The chain is broken at entry ${result.broken_at}. Investigate before anything else.`}</Notice></div>}
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
      <Panel>
        <Table head={["When", "Who", "What", "Organization", "Reason"]} empty={rows && !rows.length && <div className="px-5 pb-2 sm:px-6"><Empty title="Nothing logged yet" /></div>}>
          {(rows ?? []).map((e) => (
            <tr key={e.seq}>
              <td className="whitespace-nowrap">{fmtDateTime(e.timestamp)}</td>
              <td>{e.actor_name ?? "Public sign-up"}</td>
              <td className="font-mono text-xs">{e.action}</td>
              <td>{e.organization_name ?? <span className="text-faint">Platform</span>}</td>
              <td className="max-w-[24rem] text-muted">{e.reason}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
