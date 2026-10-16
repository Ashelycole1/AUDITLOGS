import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Label, Notice, Wordmark } from "../components";
import { DEMO_PASSWORD, useStore } from "../store";
import { Icon, type IconName } from "../icons";

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "upload", title: "Imported once, then locked", body: "Final queries come straight from the PIA's file and cannot be changed without a recorded reason." },
  { icon: "approvals", title: "Closed only with independent approval", body: "Auditors propose closure. The CIA decides, and nobody can approve their own proposal." },
  { icon: "chain", title: "A log that cannot be edited", body: "Every action is sealed into a hash-chained audit log that can be verified at any time." },
];

export default function Login() {
  const { me, state, checkPassword, completeMfa } = useStore();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (me) return <Navigate to="/" replace />;

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    const r = checkPassword(email, password);
    if (!r.ok) return setError(r.error);
    setError(null);
    setPendingUser(r.userId!);
  };

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    const r = completeMfa(pendingUser!, code.trim());
    if (!r.ok) return setError(r.error);
    nav("/", { replace: true });
  };

  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-spine px-10 py-10 text-spine-ink lg:flex xl:px-14">
        <Wordmark onSpine />
        <div>
          <h1 className="max-w-[18ch] text-balance text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.025em] text-white xl:text-[2.875rem]">
            Every audit query, followed through to closure.
          </h1>
          <ul className="mt-10 max-w-md space-y-6">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/10 text-white"><Icon name={f.icon} className="size-5" /></span>
                <span>
                  <span className="block font-semibold text-white">{f.title}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed">{f.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-spine-ink/80">Internal use only. All data is held in Uganda.</p>
      </section>

      <div className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="mb-8 w-full max-w-[24rem] lg:hidden"><Wordmark /></div>
        <section className="w-full max-w-[24rem]">
          {!pendingUser ? (
            <form onSubmit={submitPassword} className="space-y-4" noValidate>
              <div>
                <h2 className="text-[1.75rem] font-semibold tracking-[-0.02em]">Sign in</h2>
                <p className="mt-2 text-muted">Use your work email. You will be asked for an authenticator code next.</p>
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <input id="email" type="email" autoComplete="username" className="field" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <input id="password" type="password" autoComplete="current-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error && <Notice tone="error">{error}</Notice>}
              <Button kind="primary" type="submit" className="min-h-11 w-full">Continue</Button>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-4" noValidate>
              <div>
                <h2 className="text-[1.75rem] font-semibold tracking-[-0.02em]">Enter your code</h2>
                <p className="mt-2 text-muted">Open your authenticator app and enter the 6-digit code for AuditLogs.</p>
              </div>
              <div>
                <Label htmlFor="code">Authenticator code</Label>
                <input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="field text-center font-mono text-xl tracking-[0.4em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                />
              </div>
              {error && <Notice tone="error">{error}</Notice>}
              <Button kind="primary" type="submit" className="min-h-11 w-full">Sign in</Button>
              <button type="button" className="min-h-10 w-full text-sm font-medium text-lake hover:underline" onClick={() => { setPendingUser(null); setCode(""); setError(null); }}>
                Use a different account
              </button>
            </form>
          )}

          <details className="mt-8 border-t border-line pt-4 text-sm">
            <summary className="min-h-10 cursor-pointer content-center font-medium text-muted">Demo accounts (dummy data)</summary>
            <p className="mt-2 text-muted">
              Password <span className="font-mono text-ink">{DEMO_PASSWORD}</span>, any 6-digit code.
            </p>
            <ul className="mt-2 space-y-1">
              {state.users.filter((u) => u.isActive).map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => { setEmail(u.email); setPassword(DEMO_PASSWORD); setPendingUser(null); setError(null); }}
                    className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-2 text-left hover:bg-subtle"
                  >
                    <span>{u.fullName}</span>
                    <span className="text-muted">{u.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </section>
      </div>
    </div>
  );
}
