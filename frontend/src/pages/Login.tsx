import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Label, Notice, Wordmark } from "../components";
import { DEMO_PASSWORD, useStore } from "../store";

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
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* The binder cover. */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-spine px-6 py-8 text-spine-ink sm:px-10 lg:px-14 lg:py-12">
        <Wordmark onSpine />
        <div className="mt-14 lg:mt-0">
          <h1 className="max-w-[13ch] text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.035em] text-sheet sm:text-[3.5rem] xl:text-[4rem]">
            Every audit query, followed through to closure.
          </h1>
          <p className="mt-6 max-w-[44ch] text-[1.0625rem] leading-relaxed text-spine-ink">
            Imported once, assigned to an auditor, closed only with independent approval. Every change is sealed into a log
            that cannot be edited.
          </p>
          <CoverChain />
        </div>
        <p className="mt-14 text-sm text-spine-ink/70 lg:mt-0">Internal use only. Data is held in Uganda.</p>
      </section>

      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <section className="sheet w-full max-w-[26rem] rounded-[10px] p-6 sm:p-8">
          {!pendingUser ? (
            <form onSubmit={submitPassword} className="space-y-4" noValidate>
              <div>
                <h2 className="border-b-[3px] border-double border-ink/50 pb-3 text-2xl font-semibold tracking-[-0.02em]">Sign in</h2>
                <p className="mt-3 text-sm text-muted">Use your work email. You will be asked for an authenticator code next.</p>
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
                <h2 className="border-b-[3px] border-double border-ink/50 pb-3 text-2xl font-semibold tracking-[-0.02em]">Enter your code</h2>
                <p className="mt-3 text-sm text-muted">Open your authenticator app and enter the 6-digit code for AuditLogs.</p>
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
                    className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-2 text-left hover:bg-paper"
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

// Interlocked links, the last one closed: the chain every entry is sealed into.
function CoverChain() {
  const links = 9;
  return (
    <svg viewBox={`0 0 ${links * 30 + 14} 28`} className="mt-10 h-7 w-auto max-w-full" aria-hidden>
      {Array.from({ length: links }, (_, i) => (
        <rect
          key={i}
          x={1 + i * 30}
          y={i % 2 ? 6 : 2}
          width={42}
          height={i % 2 ? 16 : 24}
          rx={i % 2 ? 8 : 12}
          fill={i === links - 1 ? "#cfdfd4" : "none"}
          stroke="#cfdfd4"
          strokeOpacity={0.35 + (i / links) * 0.65}
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}
