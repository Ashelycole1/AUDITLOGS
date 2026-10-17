import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, IS_STAGING, Label, Notice, Wordmark } from "../components";
import { useStore } from "../storeTypes";
import type { IconName } from "../icons";

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "upload", title: "Imported once, then locked", body: "Final queries come straight from the PIA's file and cannot be changed without a recorded reason." },
  { icon: "approvals", title: "Closed only with independent approval", body: "Auditors propose closure. The CIA decides, and nobody can approve their own proposal." },
  { icon: "chain", title: "A log that cannot be edited", body: "Every action is sealed into a hash-chained audit log that can be verified at any time." },
];

export default function Login() {
  const { me, ready, mode, state, checkPassword, completeMfa, resendPin } = useStore();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <>
    <div className="grid min-h-dvh bg-paper lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section className="relative hidden flex-col justify-between px-10 py-9 lg:flex xl:px-16">
        <Wordmark />
        <div>
          <p className="eyebrow mb-5">Audit query follow-up</p>
          <h1 className="max-w-[14ch] text-[3.25rem] font-medium leading-[1.02] tracking-[-0.045em] text-ink xl:text-[4rem]">
            Every audit query, followed through to closure.
          </h1>
          <ol className="mt-12 grid max-w-2xl gap-x-8 gap-y-6 xl:grid-cols-3">
            {FEATURES.map((f, i) => (
              <li key={f.title} className="border-t border-rule pt-4">
                <span className="font-mono text-xs text-faint">{String(i + 1).padStart(2, "0")}</span>
                <span className="mt-2 block font-medium text-ink">{f.title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-muted">{f.body}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="eyebrow">
          {IS_STAGING ? "Test copy on a hosted service outside Uganda. Dummy data only." : "Internal use only. All data is held in Uganda."}
        </p>
      </section>

      <div className="flex flex-col items-center justify-center border-line bg-sheet px-4 py-10 sm:px-8 lg:border-l">
        <div className="mb-8 w-full max-w-[24rem] lg:hidden"><Wordmark /></div>
        <section className="w-full max-w-[24rem]">
          {!pendingUser ? (
            <form onSubmit={submitPassword} className="space-y-4" noValidate>
              <div>
                <h2 className="text-[2rem] font-medium tracking-[-0.035em]">Sign in</h2>
                <p className="mt-2 text-muted">Use your work email. We will then email you a one-time code.</p>
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
              <Button kind="primary" type="submit" disabled={busy} className="min-h-11 w-full">{busy ? "Checking" : "Continue"}</Button>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-4" noValidate>
              <div>
                <h2 className="text-[2rem] font-medium tracking-[-0.035em]">Check your email</h2>
                <p className="mt-2 text-muted">We sent a 6-digit code to {masked}. It works once and expires in 5 minutes.</p>
              </div>
              <div>
                <Label htmlFor="code">Sign-in code</Label>
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
              {mode === "demo" && pin && (
                <Notice tone="info">Prototype only: the email would contain <span className="font-mono font-medium">{pin}</span>.</Notice>
              )}
              {notice && <Notice tone="ok">{notice}</Notice>}
              {error && <Notice tone="error">{error}</Notice>}
              <Button kind="primary" type="submit" disabled={busy || code.length !== 6} className="min-h-11 w-full">{busy ? "Signing in" : "Sign in"}</Button>
              <button type="button" className="min-h-10 w-full text-sm font-medium text-lake-deep hover:underline" onClick={resend}>
                Send a new code
              </button>
              <button type="button" className="min-h-10 w-full text-sm font-medium text-lake-deep hover:underline" onClick={() => { setPendingUser(null); setPin(null); setNotice(null); setCode(""); setError(null); }}>
                Use a different account
              </button>
            </form>
          )}

          {mode === "demo" && (
          <details className="mt-8 border-t border-line pt-4 text-sm">
            <summary className="min-h-10 cursor-pointer content-center font-medium text-muted">Demo accounts (dummy data)</summary>
            <p className="mt-2 text-muted">
              Prototype only: pick an account and type any password. The code is shown on screen instead of emailed.
            </p>
            <ul className="mt-2 space-y-1">
              {state.users.filter((u) => u.isActive).map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => { setEmail(u.email); setPendingUser(null); setPin(null); setError(null); }}
                    className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-2 text-left hover:bg-subtle"
                  >
                    <span>{u.fullName}</span>
                    <span className="text-muted">{u.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
          )}
        </section>
      </div>
    </div>
    </>
  );
}
