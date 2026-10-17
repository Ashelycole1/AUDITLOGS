import { useState } from "react";
import { Button, Empty, PageHeader, Panel, Ref, Table, cx } from "../components";
import { fmtDateTime } from "../lib/rules";
import { useStore } from "../storeTypes";

const CIA_ACTIONS: Record<string, string> = {
  "status.direct": "Changed status without a proposal",
  "query.edit": "Edited a query",
  "query.reassign": "Reassigned",
  "status.approve": "Closed a query",
};

// The control on the person who both edits and approves (design.md 11).
export function CiaActivityPage() {
  const { state, userName } = useStore();
  const [kind, setKind] = useState<string | null>(null);
  const all = state.audit.filter((e) => e.actorRole === "CIA" && e.action in CIA_ACTIONS).reverse();
  const rows = kind ? all.filter((e) => e.action === kind) : all;
  const ref = (id: string) => state.queries.find((q) => q.id === id)?.reference ?? "";

  const change = (o: unknown, n: unknown) => {
    const pick = (v: unknown) => (v && typeof v === "object" ? Object.values(v as Record<string, unknown>).map((x) => (typeof x === "string" && state.users.some((u) => u.id === x) ? userName(x) : String(x ?? "none"))).join(", ") : "");
    const a = pick(o);
    const b = pick(n);
    return a ? `${a} to ${b}` : b;
  };

  return (
    <>
      <PageHeader
        title="CIA activity"
        lede="Every change the Chief Internal Auditor made directly: edits, reassignments, closures and status changes made without an auditor's proposal. Read-only."
      />

      {/* One cell per kind of change. Each cell filters the register below. */}
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4" role="group" aria-label="Filter by kind of change">
        {Object.entries(CIA_ACTIONS).map(([action, label]) => {
          const n = all.filter((e) => e.action === action).length;
          const on = kind === action;
          return (
            <button
              key={action}
              type="button"
              aria-pressed={on}
              onClick={() => setKind(on ? null : action)}
              className={cx(
                "px-5 py-4 text-left transition-colors",
                on ? "bg-lake text-white" : "bg-sheet hover:bg-white",
              )}
            >
              <span className={cx("block text-[2rem] font-medium leading-none tracking-[-0.03em]", !on && action === "status.direct" && n > 0 && "text-warn")}>{n}</span>
              <span className={cx("mt-2 block text-sm", on ? "text-white/80" : "text-muted")}>{label}</span>
            </button>
          );
        })}
      </div>

      <Panel
        title={kind ? CIA_ACTIONS[kind] : "All direct changes"}
        aside={kind && <Button kind="quiet" onClick={() => setKind(null)}>Show all changes</Button>}
      >
        <Table head={["When", "What", "Query", "Change", "Reason"]} empty={!rows.length && <div className="px-5 sm:px-6"><Empty title="No direct CIA changes">Changes the CIA makes without a proposal appear here as they happen.</Empty></div>}>
          {rows.map((e) => {
            const direct = e.action === "status.direct";
            return (
              <tr key={e.seq} className={cx("align-top", direct && "bg-warn-wash/50")}>
                <td className="whitespace-nowrap">{fmtDateTime(e.timestamp)}<span className="block text-[0.8125rem] text-muted">{userName(e.actor)}</span></td>
                <td className="min-w-[11rem]">
                  <span className={cx(direct && "font-medium text-warn")}>{CIA_ACTIONS[e.action]}</span>
                </td>
                <td><Ref>{ref(e.objectId)}</Ref></td>
                <td className="min-w-[10rem] text-muted">{change(e.oldValue, e.newValue)}</td>
                <td className="min-w-[14rem] max-w-[26rem]">
                  {/* A reason is optional when approving a closure; for every other direct change it is required. */}
                  {e.reason || (e.action === "status.approve" ? <span className="text-faint">None given</span> : <span className="font-medium text-danger">No reason given</span>)}
                </td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </>
  );
}
