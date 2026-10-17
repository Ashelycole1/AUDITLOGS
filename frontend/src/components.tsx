import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { MIN_REASON, reasonError } from "./lib/rules";
import { riskLevel } from "./lib/risk";
import { useTheme } from "./theme";
import type { Risk, Status } from "./types";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

export function Panel({ title, subtitle, aside, children, className }: { title?: string; subtitle?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("card rounded-xl p-5 sm:p-6", className)}>
      {(title || aside) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            {title && <h2 className="text-base font-medium tracking-[-0.01em]">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, lede, actions, eyebrow }: { title: string; lede?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-[68ch]">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-balance text-[1.75rem] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[2.25rem]">{title}</h1>
        {lede && <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

type BtnKind = "primary" | "secondary" | "quiet" | "danger";
export function Button({
  kind = "secondary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind }) {
  const styles: Record<BtnKind, string> = {
    primary: "bg-ink text-on-ink border border-ink hover:bg-spine-2",
    secondary: "bg-transparent text-ink border border-rule hover:border-rule-strong hover:bg-hover",
    quiet: "text-lake-deep hover:bg-lake-wash border border-transparent",
    danger: "bg-transparent text-danger border border-danger-line hover:bg-danger-wash",
  };
  return (
    <button
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-[5px] px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        styles[kind],
        className,
      )}
      {...rest}
    />
  );
}

// Each status has its own glyph as well as its own colour, so it reads without colour.
const STATUS_STYLE: Record<Status, { pill: string; dot: string }> = {
  Imported: { pill: "bg-chip text-muted ring-chip-ring", dot: "bg-mark-imported" },
  Assigned: { pill: "bg-assign-wash text-assign ring-assign-ring", dot: "bg-mark-assigned" },
  "In Progress": { pill: "bg-lake-wash text-lake-deep ring-lake-ring", dot: "bg-lake" },
  "Proposed for Closure": { pill: "bg-warn-wash text-warn ring-warn-ring", dot: "bg-mark-warn" },
  Closed: { pill: "bg-good-wash text-good ring-good-ring", dot: "bg-mark-good" },
  Returned: { pill: "bg-danger-wash text-danger ring-danger-ring", dot: "bg-mark-critical" },
};

export function statusDot(s: Status): string {
  return STATUS_STYLE[s].dot;
}

export function StatusMark({ status, className }: { status: Status; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const tone: Record<Status, string> = {
    Imported: "text-faint",
    Assigned: "text-assign",
    "In Progress": "text-lake",
    "Proposed for Closure": "text-warn",
    Closed: "text-good",
    Returned: "text-danger",
  };
  return (
    <svg viewBox="0 0 16 16" className={cx("size-4 shrink-0", tone[status], className)} aria-hidden>
      {status === "Imported" && <circle cx="8" cy="8" r="5" {...common} strokeWidth={1.5} />}
      {status === "Assigned" && (<><circle cx="8" cy="8" r="5" {...common} strokeWidth={1.5} /><path d="M8 3a5 5 0 0 1 0 10Z" fill="currentColor" /></>)}
      {status === "In Progress" && (<><circle cx="8" cy="8" r="5" {...common} strokeWidth={1.5} /><path d="M8 3a5 5 0 0 1 5 5H8Z" fill="currentColor" /></>)}
      {status === "Proposed for Closure" && <path d="M3 8.5 6.3 12 13 3.5" {...common} />}
      {status === "Closed" && (<><circle cx="8" cy="8" r="6" fill="currentColor" /><path d="m5.2 8.2 2 2 3.8-4.2" fill="none" className="stroke-sheet" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></>)}
      {status === "Returned" && <path d="m4 4 8 8M12 4l-8 8" {...common} />}
    </svg>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const st = STATUS_STYLE[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", st.pill)}>
      <span className={cx("size-1.5 rounded-full", st.dot)} aria-hidden />
      {status}
    </span>
  );
}

// The plain tick and cross, for checks that are not query statuses: validation, health, approvals.
export function Check({ ok, pending, label }: { ok?: boolean; pending?: boolean; label?: string }) {
  const tone = pending ? "bg-warn-wash text-warn" : ok ? "bg-good-wash text-good" : "bg-danger-wash text-danger";
  return (
    <span className={cx("grid size-5 shrink-0 place-items-center rounded-full", tone)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        {pending ? <path d="M8 4.5V8l2.2 1.5" /> : ok ? <path d="m3.8 8.3 2.7 2.7 5.7-6" /> : <path d="m5 5 6 6M11 5l-6 6" />}
      </svg>
    </span>
  );
}

// Risk colour chips follow the Standard Risk Matrix Color Mapping Reference (lib/risk.ts). The letter
// code and the name always travel with the colour, so the rating never depends on colour alone.
const RISK_CHIP: Record<Risk, string> = {
  Critical: "bg-risk-critical text-risk-critical-ink",
  High: "bg-risk-high text-risk-high-ink",
  Medium: "bg-risk-medium text-risk-medium-ink",
  Low: "bg-risk-low text-risk-low-ink",
};

export function RiskTag({ risk }: { risk: Risk }) {
  const level = riskLevel(risk);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.8125rem] text-ink" title={`${risk} risk: ${level.escalation}`}>
      <span className={cx("grid size-[18px] place-items-center rounded-[4px] font-mono text-[0.6875rem] font-medium leading-none", RISK_CHIP[risk])} aria-hidden>
        {level.code}
      </span>
      {risk}
    </span>
  );
}

// What a rating means and who it goes to, for the query page and the CIA's edit dialog.
export function RiskGuide({ risk, className }: { risk: Risk; className?: string }) {
  const level = riskLevel(risk);
  return (
    <div className={cx("rounded-md border border-line bg-subtle px-3 py-2.5 text-[0.8125rem] leading-snug", className)}>
      <RiskTag risk={risk} />
      <p className="mt-1.5 text-muted">{level.meaning}</p>
      <p className="mt-1 text-ink"><span className="font-medium">Escalation:</span> {level.escalation}</p>
    </div>
  );
}

export function Ref({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[0.8125rem] text-faint">{children}</span>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "ok" | "warn"; children: ReactNode }) {
  const t = {
    info: { box: "bg-lake-wash border-lake-ring text-lake-deep", icon: "info" },
    error: { box: "bg-danger-wash border-danger-ring text-danger", icon: "alert" },
    ok: { box: "bg-good-wash border-good-ring text-good", icon: "check" },
    warn: { box: "bg-warn-wash border-warn-ring text-warn", icon: "alert" },
  }[tone] as { box: string; icon: IconName };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm leading-snug", t.box)}>
      <Icon name={t.icon} className="mt-px size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Empty({ title, children, icon = "inbox" }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-col items-center rounded-lg px-6 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-paper text-faint ring-8 ring-subtle"><Icon name={icon} className="size-5" /></span>
      <p className="mt-4 font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-[46ch] text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-muted">
      {children}
    </label>
  );
}

// Every state-changing action that needs a reason goes through this dialog (design.md 13: at least 10 characters).
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  optional,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  optional?: boolean;
  onConfirm: (reason: string) => string | null | Promise<string | null>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setReason("");
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const pre = optional && reason.trim() === "" ? null : reasonError(reason);
    if (pre) return setError(pre);
    setBusy(true);
    const err = await onConfirm(reason.trim());
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-transparent p-0 text-ink backdrop:bg-[#130d0b]/55 backdrop:backdrop-blur-[2px]"
    >
      <form onSubmit={submit} className="rounded-xl border border-line bg-sheet p-6 shadow-[0_20px_24px_-4px_rgba(0,0,0,0.12),0_8px_8px_-4px_rgba(0,0,0,0.05)]">
        <h2 className="text-lg font-medium tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
        {children && <div className="mt-5 space-y-4">{children}</div>}
        <div className="mt-5">
          <Label htmlFor={id}>{optional ? "Reason (optional)" : "Reason"}</Label>
          <textarea
            id={id}
            className="field min-h-24 resize-y"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`At least ${MIN_REASON} characters. This is saved in the audit log.`}
            autoFocus
          />
        </div>
        {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button type="button" kind="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} kind={danger ? "danger" : "primary"} className={danger ? "!bg-danger !text-on-accent !border-danger hover:!bg-danger-deep" : ""}>{confirmLabel}</Button>
        </div>
      </form>
    </dialog>
  );
}

// The query's place in the workflow as a stepper. Returned loops back into In Progress.
const RAIL: Status[] = ["Imported", "Assigned", "In Progress", "Proposed for Closure", "Closed"];

export function StatusRail({ status }: { status: Status }) {
  const returned = status === "Returned";
  const idx = returned ? 2 : RAIL.indexOf(status);
  return (
    <div className="card rounded-xl px-4 py-5 sm:px-6">
      <ol className="grid grid-cols-5" aria-label="Workflow position">
        {RAIL.map((s, i) => {
          const done = i < idx || (i === idx && s === "Closed");
          const current = i === idx && s !== "Closed";
          return (
            <li key={s} className="relative flex flex-col items-center text-center" aria-current={current ? "step" : undefined}>
              {i > 0 && <span className={cx("absolute left-[-50%] right-1/2 top-[11px] h-0.5", i <= idx ? "bg-lake" : "bg-line")} aria-hidden />}
              <span
                className={cx(
                  "relative z-10 grid size-6 place-items-center rounded-full",
                  done && "bg-lake text-on-accent",
                  current && (returned ? "bg-danger-wash ring-2 ring-danger" : "bg-lake-wash ring-2 ring-lake"),
                  !done && !current && "bg-sheet ring-2 ring-line",
                )}
              >
                {done ? <Icon name="check" className="size-3.5" /> : <span className={cx("size-2 rounded-full", current ? (returned ? "bg-danger" : "bg-lake") : "bg-line")} />}
              </span>
              <span className={cx("mt-2 px-1 text-xs leading-tight sm:text-[0.8125rem]", current ? (returned ? "font-medium text-danger" : "font-medium text-lake-deep") : done ? "font-medium text-ink" : "text-faint")}>
                {current && returned ? "Returned" : s}
              </span>
            </li>
          );
        })}
      </ol>
      {returned && <p className="mt-4 text-center text-sm text-danger">Returned by the CIA. It moves back to In Progress when work resumes.</p>}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "danger" | "warn" }) {
  return (
    <div className="card rounded-xl px-5 py-4">
      <p className="eyebrow">{label}</p>
      <p className={cx("mt-2 text-3xl font-medium tracking-[-0.03em]", tone === "danger" && "text-danger", tone === "warn" && "text-warn")}>{value}</p>
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto border-t border-line sm:-mx-6">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-subtle text-faint">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2.5 font-normal first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0 [&>tr]:transition-colors [&>tr:hover]:bg-subtle [&_td]:px-3 [&_td]:py-3.5 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 sm:[&_td:first-child]:pl-6 sm:[&_td:last-child]:pr-6">
          {children}
        </tbody>
      </table>
      {empty}
    </div>
  );
}

export function Wordmark({ onSpine }: { onSpine?: boolean }) {
  return (
    <p className={cx("flex items-center gap-2 text-[1.125rem] font-medium tracking-[-0.03em]", onSpine ? "text-on-ink" : "text-ink")}>
      <span className={cx("grid size-7 place-items-center rounded-[6px]", onSpine ? "bg-on-ink text-ink" : "bg-ink text-on-ink")}>
        <Icon name="chain" className="size-4" />
      </span>
      AuditLogs
    </p>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return <span className={cx("grid size-9 shrink-0 place-items-center rounded-full bg-lake-wash text-sm font-medium text-lake-deep", className)} aria-hidden>{initials}</span>;
}

// Switches light and dark. The icon shows the theme a press moves to.
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className={cx("grid size-9 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink", className)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <Icon name={next === "dark" ? "moon" : "sun"} className="size-[18px]" />
    </button>
  );
}

// Hosted test copies (Vercel/Render) hold dummy data only (architecture.md 9). The sign-in page says so.
export const IS_STAGING = import.meta.env.VITE_DEPLOY_ENV === "staging" || window.location.hostname.endsWith(".vercel.app");
