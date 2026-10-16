import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MIN_REASON, reasonError } from "./lib/rules";
import type { Risk, Status } from "./types";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

// A sheet on the paper. The title sits on a ruled header line, like the heading row of a working paper.
export function Panel({ title, aside, children, className }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("sheet rounded-[10px] px-5 pb-5 sm:px-6 sm:pb-6", title || aside ? "pt-0" : "pt-5 sm:pt-6", className)}>
      {(title || aside) && (
        <header className="-mx-5 mb-5 flex min-h-[3.25rem] items-center justify-between gap-3 border-b border-line px-5 sm:-mx-6 sm:px-6">
          {title && <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

// Page titles carry the accountant's double rule: this is the heading of the sheet.
export function PageHeader({ title, lede, actions }: { title: string; lede?: string; actions?: ReactNode }) {
  return (
    <header className="mb-7 border-b-[3px] border-double border-ink/60 pb-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[62ch]">
          <h1 className="text-balance text-[2rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[2.5rem]">{title}</h1>
          {lede && <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-muted">{lede}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
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
    primary: "bg-spine text-sheet hover:bg-lake border border-spine",
    secondary: "bg-sheet text-ink border border-rule hover:border-ink/50 hover:bg-white",
    quiet: "text-lake hover:bg-lake-wash border border-transparent",
    danger: "bg-sheet text-danger border border-danger/40 hover:bg-danger-wash hover:border-danger/70",
  };
  return (
    <button
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        styles[kind],
        className,
      )}
      {...rest}
    />
  );
}

/*
  Auditor's tick marks. Each status has its own mark so it reads without colour:
  open circle (imported), half circle (assigned), pencil stroke (in progress),
  tick (proposed), tick and bar (closed and agreed), cross (returned).
*/
const MARK_TONE: Record<Status, string> = {
  Imported: "text-faint",
  Assigned: "text-assign",
  "In Progress": "text-lake",
  "Proposed for Closure": "text-warn",
  Closed: "text-good",
  Returned: "text-danger",
};

export function StatusMark({ status, className }: { status: Status; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 16 16" className={cx("size-4 shrink-0", MARK_TONE[status], className)} aria-hidden>
      {status === "Imported" && <circle cx="8" cy="8" r="5" {...common} strokeWidth={1.5} />}
      {status === "Assigned" && (
        <>
          <circle cx="8" cy="8" r="5" {...common} strokeWidth={1.5} />
          <path d="M8 3a5 5 0 0 1 0 10Z" fill="currentColor" />
        </>
      )}
      {status === "In Progress" && <path d="M4 12.5 12 3.5" {...common} />}
      {status === "Proposed for Closure" && <path d="M3 8.5 6.3 12 13 3.5" {...common} />}
      {status === "Closed" && (
        <>
          <path d="M2.5 8 5.6 11.4 12 3.2" {...common} />
          <path d="M7.5 9.2h7" {...common} />
        </>
      )}
      {status === "Returned" && <path d="m4 4 8 8M12 4l-8 8" {...common} />}
    </svg>
  );
}

// The plain tick and cross, for checks that are not query statuses: validation, health, approvals.
export function Check({ ok, pending, label }: { ok?: boolean; pending?: boolean; label?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 16 16" className={cx("size-4 shrink-0", pending ? "text-warn" : ok ? "text-good" : "text-danger")} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {pending ? <circle cx="8" cy="8" r="5" {...common} strokeWidth={1.5} strokeDasharray="2.4 2.2" /> : ok ? <path d="M3 8.5 6.3 12 13 3.5" {...common} /> : <path d="m4 4 8 8M12 4l-8 8" {...common} />}
    </svg>
  );
}

const DOT: Record<Status, string> = {
  Imported: "bg-faint",
  Assigned: "bg-assign",
  "In Progress": "bg-lake",
  "Proposed for Closure": "bg-warn",
  Closed: "bg-good",
  Returned: "bg-danger",
};

export function statusDot(s: Status): string {
  return DOT[s];
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap text-[0.8125rem] font-medium", status === "Returned" ? "text-danger" : "text-ink")}>
      <StatusMark status={status} />
      {status}
    </span>
  );
}

export function RiskTag({ risk }: { risk: Risk }) {
  const bars = risk === "High" ? 3 : risk === "Medium" ? 2 : 1;
  const tone = risk === "High" ? "bg-danger" : risk === "Medium" ? "bg-warn" : "bg-faint";
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.8125rem]" title={`${risk} risk`}>
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cx("w-[3px]", i <= bars ? tone : "bg-ink/12")} style={{ height: 3 + i * 3 }} />
        ))}
      </span>
      {risk}
    </span>
  );
}

export function Ref({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[0.8125rem] text-muted">{children}</span>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "ok" | "warn"; children: ReactNode }) {
  const t = {
    info: "bg-lake-wash/70 text-lake-deep border-lake",
    error: "bg-danger-wash text-danger border-danger",
    ok: "bg-good-wash text-good border-good",
    warn: "bg-warn-wash text-warn border-warn",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-r-md border-l-[3px] px-3.5 py-2.5 text-sm leading-snug", t)}>
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-rule px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-[46ch] text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[0.8125rem] font-medium text-muted">
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
  onConfirm: (reason: string) => string | null;
  onClose: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const pre = optional && reason.trim() === "" ? null : reasonError(reason);
    if (pre) return setError(pre);
    const err = onConfirm(reason.trim());
    if (err) setError(err);
    else onClose();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-[10px] bg-transparent p-0 text-ink backdrop:bg-spine/45"
    >
      <form onSubmit={submit} className="sheet rounded-[10px] p-6">
        <h2 className="border-b-[3px] border-double border-ink/50 pb-3 text-xl font-semibold tracking-[-0.015em]">{title}</h2>
        {description && <p className="mt-3 text-sm leading-relaxed text-muted">{description}</p>}
        {children && <div className="mt-4 space-y-3">{children}</div>}
        <div className="mt-4">
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
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" kind="quiet" onClick={onClose}>Cancel</Button>
          <Button type="submit" kind={danger ? "danger" : "primary"}>{confirmLabel}</Button>
        </div>
      </form>
    </dialog>
  );
}

// The query's place in the workflow, as a ruled row of cells. Returned sits off the line because it loops back into In Progress.
const RAIL: Status[] = ["Imported", "Assigned", "In Progress", "Proposed for Closure", "Closed"];

export function StatusRail({ status }: { status: Status }) {
  const returned = status === "Returned";
  const idx = returned ? 2 : RAIL.indexOf(status);
  return (
    <div>
      <ol className="grid grid-cols-5 overflow-hidden rounded-[10px] border border-line bg-sheet" aria-label="Workflow position">
        {RAIL.map((s, i) => {
          const done = i < idx || (i === idx && s === "Closed");
          const current = i === idx && s !== "Closed";
          return (
            <li
              key={s}
              aria-current={current ? "step" : undefined}
              className={cx(
                "flex min-h-[4.25rem] flex-col justify-between gap-2 border-l border-line px-2.5 py-2.5 first:border-l-0 sm:px-3.5",
                current && (returned ? "bg-danger text-sheet" : "bg-spine text-sheet"),
              )}
            >
              <span className="flex h-4 items-center">
                {done ? <StatusMark status={s === "Closed" ? "Closed" : "Proposed for Closure"} className={s === "Closed" ? "" : "!text-lake"} /> : current ? <StatusMark status={returned ? "Returned" : s} className="!text-sheet" /> : <span className="size-1.5 rounded-full bg-rule" />}
              </span>
              <span className={cx("text-[0.75rem] leading-tight sm:text-[0.8125rem]", current ? "font-semibold" : done ? "text-ink" : "text-faint")}>
                {current && returned ? "Returned" : s}
              </span>
            </li>
          );
        })}
      </ol>
      {returned && (
        <p className="mt-2 text-sm text-danger">Returned by the CIA. It moves back to In Progress when work resumes.</p>
      )}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "danger" | "warn" }) {
  return (
    <div className={cx("sheet rounded-[10px] border-t-[3px] px-5 pb-4 pt-3.5", tone === "danger" ? "border-t-danger" : tone === "warn" ? "border-t-warn" : "border-t-spine")}>
      <p className={cx("text-[2.5rem] font-semibold leading-none tracking-[-0.04em]", tone === "danger" && "text-danger", tone === "warn" && "text-warn")}>{value}</p>
      <p className="mt-2 text-sm text-muted">{label}</p>
    </div>
  );
}

// A ledger: column headings sit on a heavy rule, rows on light ones.
export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto sm:-mx-6">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b-[1.5px] border-ink/70 text-[0.8125rem] text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-3 pb-2 pt-0.5 font-medium first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0 [&_td]:px-3 [&_td]:py-3 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 sm:[&_td:first-child]:pl-6 sm:[&_td:last-child]:pr-6">
          {children}
        </tbody>
      </table>
      {empty}
    </div>
  );
}

export function Wordmark({ onSpine }: { onSpine?: boolean }) {
  return (
    <p className={cx("flex items-center gap-2.5 text-[1.125rem] font-semibold tracking-[-0.02em]", onSpine ? "text-sheet" : "text-ink")}>
      <ChainMark onSpine={onSpine} />
      AuditLogs
    </p>
  );
}

// Three interlocked links: the hash chain that makes the log tamper-evident.
function ChainMark({ onSpine }: { onSpine?: boolean }) {
  const c = onSpine ? "#cfdfd4" : "#1a3a2f";
  return (
    <svg viewBox="0 0 34 14" className="h-3.5 w-[2.125rem]" aria-hidden>
      <rect x="1" y="2" width="13" height="10" rx="5" fill="none" stroke={c} strokeWidth="1.8" />
      <rect x="10.5" y="2" width="13" height="10" rx="5" fill="none" stroke={c} strokeWidth="1.8" />
      <rect x="20" y="2" width="13" height="10" rx="5" fill={c} stroke={c} strokeWidth="1.8" />
    </svg>
  );
}
