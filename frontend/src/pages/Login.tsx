import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, IS_STAGING, Label, Notice, ThemeToggle } from "../components";
import { useStore } from "../storeTypes";
import { Icon, type IconName } from "../icons";

// Public landing and sign-in, after the owner's mock-up (assets/AuditLogs_Landing_Page.png).
const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "bolt", title: "Imported once, then locked", body: "Final queries come straight from the PIA's file and cannot be changed without a recorded reason." },
  { icon: "users", title: "Closed only with independent approval", body: "Auditors propose closure. The CIA decides, and nobody can approve their own proposal." },
  { icon: "compliance", title: "A log that cannot be edited", body: "Every action is sealed into a hash-chained audit log that can be verified at any time." },
  { icon: "lock", title: "Secure & transparent", body: "Built for compliance, accountability and peace of mind." },
];

const SECTIONS = [
  { id: "top", label: "Home" },
  { id: "features", label: "Features" },
  { id: "security", label: "Security" },
  { id: "about", label: "About" },
];

const SECURITY: { title: string; body: string }[] = [
  { title: "Two-step sign-in", body: "A password, then a one-time code sent to your work email. The code works once and expires in 5 minutes." },
  { title: "Idle sessions end", body: "You are signed out after 30 minutes without activity, on the server as well as in the browser." },
  { title: "Tamper-evident history", body: "Each audit log entry carries the hash of the one before it, so any edit breaks the chain and shows." },
];

const ROLES: { role: string; body: string }[] = [
  { role: "PIA", body: "Imports the final queries and assigns them." },
  { role: "IA", body: "Follows up with management and proposes closure." },
  { role: "CIA", body: "Approves or rejects closure and keeps the audit log." },
  { role: "CEO", body: "Oversees the CIA's activity." },
];

const CARD = "rounded-2xl border border-land-line bg-land-card p-5";
const EYEBROW = "font-mono text-xs uppercase tracking-[0.32em] text-leaf";
const FIELD = "field !min-h-14 !rounded-xl !border-land-field-line";
const SUBMIT = "!min-h-14 w-full !rounded-xl !border-forest !bg-forest !text-lg !text-white hover:!bg-forest-2";

export default function Login() {
  const { me, ready, mode, state, checkPassword, completeMfa, resendPin } = useStore();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  // Demo only: stands in for the emailed one-time PIN. In API mode the server emails the real one.
  const [pin, setPin] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ready) return null;
  if (me) return <Navigate to="/" replace />;

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await checkPassword(email, password);
      if (!r.ok) return setError(r.error);
      if (r.signedIn) return nav("/", { replace: true });
      setError(null);
      setNotice(null);
      setCode("");
      setPin(r.pin ?? null);
      setSentTo(r.sentTo ?? null);
      setPendingUser(r.userId!);
    });
  };

  const resend = () =>
    run(async () => {
      const r = await resendPin();
      if (!r.ok) return setError(r.error);
      setError(null);
      if (r.pin) setPin(r.pin);
      setNotice("A new code is on its way. Use the most recent email.");
    });

  const masked =
    sentTo ??
    (() => {
      const [local, domain] = email.trim().split("@");
      return local && domain ? `${local[0]}•••@${domain}` : "your work email";
    })();

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (mode === "demo" && code.trim() !== pin) {
        return setError("That code is not correct or has expired. Check the latest email and try again.");
      }
      const r = await completeMfa(pendingUser!, code.trim());
      if (!r.ok) {
        setError(r.error);
        // The server ends a sign-in after too many wrong codes or when it expires: start again.
        if (/expired|sign-in has expired/i.test(r.error)) {
          setPendingUser(null);
          setCode("");
        }
        return;
      }
      nav("/", { replace: true });
    });
  };

  return (
    <div id="top" className="landing min-h-dvh bg-land-to bg-[radial-gradient(ellipse_at_top_left,var(--color-land-from)_0%,var(--color-land-via)_45%,var(--color-land-to)_100%)] text-land-ink">
      <header className="mx-auto flex h-20 max-w-[1600px] items-center gap-6 px-4 sm:px-6 lg:h-28 lg:px-8">
        <a href="#top" aria-label="AuditLogs home" className="flex shrink-0 items-center gap-3">
          <span className="grid size-10 place-items-center rounded-[10px] bg-forest text-white lg:size-12">
            <Icon name="chain" className="size-5 lg:size-6" />
          </span>
          <span className="text-[1.5rem] font-semibold tracking-[-0.035em] lg:text-[1.875rem]">AuditLogs</span>
        </a>
        <nav aria-label="Sections" className="mx-auto hidden items-center gap-12 md:flex">
          {SECTIONS.map((n, i) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              aria-current={i === 0 ? "page" : undefined}
              className={
                i === 0
                  ? "relative py-2 text-[0.9375rem] font-medium after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-leaf"
                  : "py-2 text-[0.9375rem] text-forest-ink/80 hover:text-forest-ink"
              }
            >
              {n.label}
            </a>
          ))}
        </nav>
        <p className="ml-auto flex items-center gap-2.5 whitespace-nowrap text-[0.9375rem] text-mist md:ml-0">
          <span className="size-2.5 rounded-full bg-live ring-4 ring-live/15" aria-hidden />
          <span className="max-[400px]:sr-only">Secure Access</span>
        </p>
        <ThemeToggle className="!text-mist hover:!bg-leaf-wash hover:!text-forest-ink" />
      </header>

      <main className="mx-auto grid max-w-[1600px] gap-10 px-4 pb-16 pt-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_30rem] lg:gap-x-10 lg:gap-y-0 lg:px-8 lg:pt-10">
        <section className="order-1 min-w-0 lg:order-none">
          <p className={EYEBROW}>Audit · Track · Stay compliant</p>
          <h1 className="mt-5 text-[2.5rem] font-bold leading-[1.04] tracking-[-0.035em] sm:text-[3.75rem] xl:text-[4.5rem]">
            Every audit query,
            <br />
            <em className="font-semibold text-leaf">followed through</em>
            <br />
            to closure.
          </h1>
          <p className="mt-7 max-w-[34rem] text-lg leading-relaxed text-mist">
            Track, manage and close audit queries with ease. No more lost follow-ups. No more unverified changes.
          </p>
        </section>

        <ul id="features" className="order-3 grid scroll-mt-8 gap-4 sm:grid-cols-2 lg:order-none lg:col-start-1 lg:mt-10 xl:grid-cols-4">
            {FEATURES.map((f) => (
              <li key={f.title} className={CARD}>
                <span className="grid size-12 place-items-center rounded-full bg-leaf-wash text-forest-ink">
                  <Icon name={f.icon} className="size-6" />
                </span>
                <span className="mt-4 block text-[1.0625rem] font-medium leading-snug tracking-[-0.01em]">{f.title}</span>
                <span className="mt-2 block text-[0.9375rem] leading-relaxed text-mist">{f.body}</span>
              </li>
            ))}
        </ul>

        <section aria-label="Sign in" className="order-2 h-fit lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1 rounded-3xl border border-land-panel-line bg-land-panel p-6 shadow-[0_24px_60px_-28px_var(--color-land-shadow)] sm:p-8 lg:mt-4">
          {!pendingUser ? (
            <form onSubmit={submitPassword} className="space-y-5" noValidate>
              <div>
                <h2 className="text-[2.5rem] font-semibold leading-tight tracking-[-0.04em]">Sign in</h2>
                <p className="mt-2 text-[1.0625rem] leading-relaxed text-mist">Use your work email. We will then email you a one-time code.</p>
              </div>
              <div>
                <label htmlFor="email" className="mb-2 block font-medium">Email</label>
                <div className="relative">
                  <Icon name="mail" className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-forest-ink/70" />
                  <input id="email" type="email" autoComplete="username" placeholder="you@company.com" className={`${FIELD} !pl-12`} value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
              </div>
              <div>
                <label htmlFor="password" className="mb-2 block font-medium">Password</label>
                <div className="relative">
                  <Icon name="lock" className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-forest-ink/70" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className={`${FIELD} !pl-12 !pr-12`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-forest-ink/70 hover:bg-leaf-wash hover:text-forest-ink"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    <Icon name={showPassword ? "eye" : "eyeOff"} className="size-5" />
                  </button>
                </div>
              </div>
              {error && <Notice tone="error">{error}</Notice>}
              <Button kind="primary" type="submit" disabled={busy} className={SUBMIT}>
                {busy ? "Checking" : <>Continue <Icon name="arrowRight" className="size-5" /></>}
              </Button>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-5" noValidate>
              <div>
                <h2 className="text-[2.5rem] font-semibold leading-tight tracking-[-0.04em]">Check your email</h2>
                <p className="mt-2 text-[1.0625rem] leading-relaxed text-mist">We sent a 6-digit code to {masked}. It works once and expires in 5 minutes.</p>
              </div>
              <div>
                <Label htmlFor="code">Sign-in code</Label>
                <input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className={`${FIELD} text-center font-mono text-xl tracking-[0.4em]`}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                />
              </div>
              {mode === "demo" && pin && (
                <Notice tone="info">Prototype only: the email would contain <span className="font-mono font-medium">{pin}</span>.</Notice>
              )}
              {notice && <Notice tone="ok">{notice}</Notice>}
              {error && <Notice tone="error">{error}</Notice>}
              <Button kind="primary" type="submit" disabled={busy || code.length !== 6} className={SUBMIT}>
                {busy ? "Signing in" : <>Sign in <Icon name="arrowRight" className="size-5" /></>}
              </Button>
              <button type="button" className="min-h-10 w-full text-sm font-medium text-leaf hover:underline" onClick={resend}>
                Send a new code
              </button>
              <button type="button" className="min-h-10 w-full text-sm font-medium text-leaf hover:underline" onClick={() => { setPendingUser(null); setPin(null); setNotice(null); setCode(""); setError(null); }}>
                Use a different account
              </button>
            </form>
          )}

          {mode === "demo" && (
            <details className="mt-6 border-t border-land-panel-line pt-4 text-sm">
              <summary className="min-h-10 cursor-pointer content-center font-medium text-mist">Demo accounts (dummy data)</summary>
              <p className="mt-2 text-mist">
                Prototype only: pick an account and type any password. The code is shown on screen instead of emailed.
              </p>
              <ul className="mt-2 space-y-1">
                {state.users.filter((u) => u.isActive).map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => { setEmail(u.email); setPendingUser(null); setPin(null); setError(null); }}
                      className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2 text-left hover:bg-leaf-wash"
                    >
                      <span>{u.fullName}</span>
                      <span className="text-mist">{u.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </main>

      <section id="security" className="mx-auto max-w-[1600px] scroll-mt-8 px-4 py-16 sm:px-6 lg:px-8">
        <p className={EYEBROW}>Security</p>
        <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.035em]">Built so the record can be trusted.</h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {SECURITY.map((s) => (
            <li key={s.title} className={CARD}>
              <span className="block text-[1.0625rem] font-medium">{s.title}</span>
              <span className="mt-2 block text-[0.9375rem] leading-relaxed text-mist">{s.body}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="about" className="mx-auto max-w-[1600px] scroll-mt-8 px-4 pb-16 sm:px-6 lg:px-8">
        <p className={EYEBROW}>About</p>
        <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.035em]">One place for every audit query.</h2>
        <p className="mt-3 max-w-[40rem] text-lg leading-relaxed text-mist">
          AuditLogs follows each query from the final report to its closure, and each role sees only the work that is theirs.
        </p>
        <dl className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {ROLES.map((r) => (
            <div key={r.role} className="border-t border-land-field-line pt-4">
              <dt className="font-mono text-sm font-medium text-leaf">{r.role}</dt>
              <dd className="mt-1 text-[0.9375rem] leading-relaxed text-mist">{r.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="mx-auto max-w-[1600px] border-t border-land-line px-4 py-6 sm:px-6 lg:px-8">
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-mist">
          {IS_STAGING ? "Test copy on a hosted service outside Uganda. Dummy data only." : "Internal use only. All data is held in Uganda."}
        </p>
      </footer>
    </div>
  );
}
