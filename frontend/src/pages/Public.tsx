// Pages reached without signing in (auditlogs-additions_final.md 4 and 6): an organization signs up, its
// contact confirms the email address, and new administrators choose a password from a one-time link.
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { Button, Label, Notice, ThemeToggle, Wordmark } from "../components";
import { useStore } from "../storeTypes";

const message = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");

function Frame({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
        <Link to="/login" aria-label="AuditLogs sign-in"><Wordmark /></Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-xl px-4 pb-20 pt-8 sm:px-6">
        <h1 className="text-[1.75rem] font-medium leading-tight tracking-[-0.03em] sm:text-[2.25rem]">{title}</h1>
        {lede && <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">{lede}</p>}
        <div className="card mt-6 rounded-xl p-5 sm:p-6">{children}</div>
      </main>
    </div>
  );
}

function DemoNote() {
  return <Notice tone="info">This needs the server. The in-browser demo has one organization already set up.</Notice>;
}

const FIELDS = [
  { key: "name", label: "Organization name", type: "text", autoComplete: "organization" },
  { key: "country", label: "Country", type: "text", autoComplete: "country-name" },
  { key: "contact_person", label: "Contact person (becomes your administrator)", type: "text", autoComplete: "name" },
  { key: "email", label: "Work email", type: "email", autoComplete: "email" },
  { key: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
] as const;

export function SignupPage() {
  const { mode } = useStore();
  const [form, setForm] = useState({ name: "", country: "Uganda", contact_person: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ detail: string; link?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ detail: string; verify_link?: string }>("/signup", form);
      setDone({ detail: r.detail, link: r.verify_link });
      setError(null);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame title="Sign up your organization" lede="Companies and institutions use AuditLogs as organizations, each with its own people and data, kept apart from every other.">
      {mode !== "api" ? (
        <DemoNote />
      ) : done ? (
        <div className="space-y-4">
          <Notice tone="ok">{done.detail}</Notice>
          {done.link && <p className="text-sm text-muted">Outside production the confirmation link is also shown here: <a className="break-all font-medium text-lake underline" href={done.link}>confirm the email address</a>.</p>}
          <Link to="/login" className="inline-flex min-h-10 items-center text-sm font-medium text-lake hover:underline">Back to sign-in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {FIELDS.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`s-${f.key}`}>{f.label}</Label>
              <input id={`s-${f.key}`} className="field" type={f.type} autoComplete={f.autoComplete} required={f.key !== "phone"} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            </div>
          ))}
          <div>
            <Label htmlFor="s-password">Password for your administrator account</Label>
            <input id="s-password" className="field" type="password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <p className="mt-1 text-[0.8125rem] text-faint">At least 12 characters, not a common password.</p>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <p className="text-[0.8125rem] text-muted">New organizations wait for the platform administrator's approval. You can sign in, and add your people, once it is approved.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button kind="primary" type="submit" disabled={busy}>{busy ? "Sending" : "Sign up"}</Button>
            <Link to="/login" className="text-sm font-medium text-lake hover:underline">I already have an account</Link>
          </div>
        </form>
      )}
    </Frame>
  );
}

export function VerifyEmailPage() {
  const { mode } = useStore();
  const [params] = useSearchParams();
  const [state, setState] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (mode !== "api") return;
    const token = params.get("token");
    if (!token) return setState({ tone: "error", text: "This link is incomplete. Open it from the email again." });
    api
      .post<{ detail: string }>("/signup/verify", { token })
      .then((r) => setState({ tone: "ok", text: r.detail }))
      .catch((e) => setState({ tone: "error", text: message(e) }));
  }, [mode, params]);
  return (
    <Frame title="Confirm your email address">
      {mode !== "api" ? <DemoNote /> : state ? <Notice tone={state.tone}>{state.text}</Notice> : <p className="text-sm text-muted" role="status">Checking the link</p>}
      <Link to="/login" className="mt-4 inline-flex min-h-10 items-center text-sm font-medium text-lake hover:underline">Back to sign-in</Link>
    </Frame>
  );
}

export function SetPasswordPage({ platform }: { platform?: boolean }) {
  const { mode } = useStore();
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const signIn = platform ? "/platform/login" : "/login";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError("The two passwords are not the same.");
    try {
      const r = await api.post<{ detail: string }>("/auth/set-password", { uid: params.get("uid") ?? "", token: params.get("token") ?? "", password });
      setDone(r.detail);
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  };

  return (
    <Frame title="Choose your password" lede="This link works once. After that, sign in with your email and this password.">
      {mode !== "api" ? (
        <DemoNote />
      ) : done ? (
        <div className="space-y-4">
          <Notice tone="ok">{done}</Notice>
          <Link to={signIn} className="inline-flex min-h-10 items-center text-sm font-medium text-lake hover:underline">Go to sign-in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div>
            <Label htmlFor="p-new">New password</Label>
            <input id="p-new" className="field" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="mt-1 text-[0.8125rem] text-faint">At least 12 characters, not a common password.</p>
          </div>
          <div>
            <Label htmlFor="p-again">Type it again</Label>
            <input id="p-again" className="field" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <div><Button kind="primary" type="submit" disabled={!password || !again}>Set password</Button></div>
        </form>
      )}
    </Frame>
  );
}
