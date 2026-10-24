// Audit reports and their criteria (auditlogs-additions_final.md 8.1). Kept by the server: the demo store
// has none. The CIA creates and corrects them and exports a report as PDF; a PIA asks for the PDF through
// an export request; everyone else reads.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { Button, Empty, Label, Notice, PageHeader, Panel, Ref, RiskTag, StatusBadge, Table } from "../components";
import { fmtDate, statusSummary } from "../lib/rules";
import { useMe, useStore } from "../storeTypes";
import type { AuditReport, Criterion, Risk, Status } from "../types";
import { ExportRequestDialog } from "./Cia";
import { StatusPieCard } from "../widgets";

type Raw = Record<string, unknown>;

const toReport = (r: Raw): AuditReport => ({
  id: String(r.id),
  title: String(r.title ?? ""),
  auditPeriod: String(r.audit_period ?? ""),
  reportDate: (r.report_date as string) ?? null,
  preparedBy: String(r.prepared_by ?? ""),
  criteriaCount: Number(r.criteria_count ?? 0),
  createdAt: String(r.created_at ?? ""),
});

const message = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");

/** Every criterion of every report, for the CIA's "Criterion" field. Loads only when asked. */
export function useCriterionOptions(enabled: boolean): { id: string; label: string }[] {
  const { mode } = useStore();
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    if (!enabled || mode !== "api") return;
    let live = true;
    (async () => {
      const reports = (await api.get<Raw[]>("/reports")).map(toReport);
      const lists = await Promise.all(reports.map((r) => api.get<Raw[]>(`/reports/${r.id}/criteria`).then((cs) => cs.map((c) => ({ id: String(c.id), label: `${r.title}: ${c.title}` })))));
      if (live) setOptions(lists.flat());
    })().catch(() => undefined);
    return () => { live = false; };
  }, [enabled, mode]);
  return options;
}

function ApiOnly() {
  return (
    <Notice tone="info">Audit reports and criteria are kept by the server. Connect the app to the API to see them.</Notice>
  );
}

export function AuditReportsPage() {
  const me = useMe();
  const { mode } = useStore();
  const [reports, setReports] = useState<AuditReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", audit_period: "", report_date: "", prepared_by: "" });
  const isCia = me.role === "CIA";

  const load = () => api.get<Raw[]>("/reports").then((rs) => setReports(rs.map(toReport))).catch((e) => setError(message(e)));
  useEffect(() => { if (mode === "api") load(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/reports", { ...form, report_date: form.report_date || null });
      setForm({ title: "", audit_period: "", report_date: "", prepared_by: "" });
      setCreating(false);
      setError(null);
      await load();
    } catch (err) {
      setError(message(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Audit reports"
        lede="Each report lists the criteria the audit was measured against and the queries raised under each. Word reports create theirs on import."
        actions={
          isCia && (
            <>
              <Link to="/status-report" className="inline-flex min-h-10 items-center rounded-[5px] border border-rule px-4 text-sm font-medium hover:bg-hover">Status report</Link>
              {mode === "api" && <Button kind="primary" onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New report"}</Button>}
            </>
          )
        }
      />
      {mode !== "api" && <ApiOnly />}
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
      {creating && (
        <Panel title="New audit report" className="mb-5">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="r-title">Report title</Label>
              <input id="r-title" className="field" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="r-period">Audit period</Label>
              <input id="r-period" className="field" placeholder="July 2025 to June 2026" value={form.audit_period} onChange={(e) => setForm({ ...form, audit_period: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="r-date">Report date</Label>
              <input id="r-date" type="date" className="field" value={form.report_date} onChange={(e) => setForm({ ...form, report_date: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="r-by">Prepared by</Label>
              <input id="r-by" className="field" value={form.prepared_by} onChange={(e) => setForm({ ...form, prepared_by: e.target.value })} />
            </div>
            <div className="sm:col-span-2"><Button kind="primary" type="submit">Create report</Button></div>
          </form>
        </Panel>
      )}
      {mode === "api" && (
        <Panel>
          <Table
            head={["Report", "Audit period", "Report date", "Criteria"]}
            empty={reports && !reports.length && <div className="px-5 pb-2 sm:px-6"><Empty title="No audit reports yet">{isCia ? "Import a Word report, or create one and add its criteria." : "Reports appear here once the CIA adds them."}</Empty></div>}
          >
            {(reports ?? []).map((r) => (
              <tr key={r.id}>
                <td className="min-w-[16rem]"><Link to={`/reports/${r.id}`} className="font-medium hover:text-lake hover:underline">{r.title}</Link>{r.preparedBy && <span className="block text-[0.8125rem] text-muted">Prepared by {r.preparedBy}</span>}</td>
                <td>{r.auditPeriod || <span className="text-faint">Not given</span>}</td>
                <td className="whitespace-nowrap">{r.reportDate ? fmtDate(r.reportDate) : <span className="text-faint">Not given</span>}</td>
                <td className="font-medium tabular-nums">{r.criteriaCount}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </>
  );
}

type Item = { id: string; reference: string; title: string; status: Status; risk_rating_current: Risk; assignee_name: string | null };
type CriterionWithItems = Criterion & { items: Item[] };

export function AuditReportPage() {
  const { id } = useParams();
  const me = useMe();
  const { mode } = useStore();
  const [report, setReport] = useState<(AuditReport & { criteria: CriterionWithItems[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [criterion, setCriterion] = useState({ title: "", description: "" });
  const [exportOpen, setExportOpen] = useState(false);
  const isCia = me.role === "CIA";

  const load = () =>
    api
      .get<Raw>(`/reports/${id}`)
      .then((r) =>
        setReport({
          ...toReport(r),
          criteria: ((r.criteria as Raw[]) ?? []).map((c) => ({
            id: String(c.id),
            title: String(c.title),
            description: String(c.description ?? ""),
            position: Number(c.position),
            queries: Number(c.queries),
            items: (c.items as Item[]) ?? [],
          })),
        }),
      )
      .catch((e) => setError(message(e)));
  useEffect(() => { if (mode === "api") load(); }, [id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (mode !== "api") return <><PageHeader title="Audit report" /><ApiOnly /></>;
  if (!report) return error ? <div className="mx-auto max-w-lg pt-16"><Empty title="Report not found">{error}</Empty></div> : <p className="text-sm text-muted" role="status">Loading</p>;

  const addCriterion = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/reports/${id}/criteria`, criterion);
      setCriterion({ title: "", description: "" });
      setAdding(false);
      setError(null);
      await load();
    } catch (err) {
      setError(message(err));
    }
  };

  const pdf = async () => {
    try {
      await api.download(`/reports/${id}/pdf`, `audit-report-${new Date().toISOString().slice(0, 10)}.pdf`);
      setFlash("Downloaded the PDF. The export is recorded in the audit log.");
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  };

  return (
    <>
      <Link to="/reports" className="inline-flex min-h-10 items-center text-sm font-medium text-lake hover:underline">Audit reports</Link>
      <PageHeader
        eyebrow="Audit report"
        title={report.title}
        lede={[report.auditPeriod && `Audit period ${report.auditPeriod}`, report.reportDate && `dated ${fmtDate(report.reportDate)}`, report.preparedBy && `prepared by ${report.preparedBy}`].filter(Boolean).join(", ") || undefined}
        actions={
          isCia ? (
            <>
              <Button kind="secondary" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Add criterion"}</Button>
              <Button kind="primary" onClick={pdf}>Download PDF</Button>
            </>
          ) : me.role === "PIA" ? (
            <Button kind="secondary" onClick={() => setExportOpen(true)}>Request PDF</Button>
          ) : undefined
        }
      />
      {flash && <div className="mb-4"><Notice tone="ok">{flash}</Notice></div>}
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
      {adding && (
        <Panel title="Add a criterion" subtitle="The standard, policy, law or benchmark the audit is measured against" className="mb-5">
          <form onSubmit={addCriterion} className="grid gap-3">
            <div>
              <Label htmlFor="c-title">Title</Label>
              <input id="c-title" className="field" required value={criterion.title} onChange={(e) => setCriterion({ ...criterion, title: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="c-desc">Description</Label>
              <textarea id="c-desc" className="field min-h-20" value={criterion.description} onChange={(e) => setCriterion({ ...criterion, description: e.target.value })} />
            </div>
            <div><Button kind="primary" type="submit">Add criterion</Button></div>
          </form>
        </Panel>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-5">
          {report.criteria.length ? (
            report.criteria.map((c, i) => (
              <Panel key={c.id} title={`Criterion ${i + 1}: ${c.title}`} subtitle={c.description || undefined}>
                {c.items.length ? (
                  <Table head={["Query", "Risk", "Status", "Auditor"]}>
                    {c.items.map((q) => (
                      <tr key={q.id}>
                        <td className="min-w-[16rem]"><Link to={`/queries/${q.id}`} className="group block"><Ref>{q.reference}</Ref><span className="block font-medium group-hover:text-lake">{q.title}</span></Link></td>
                        <td><RiskTag risk={q.risk_rating_current} /></td>
                        <td><StatusBadge status={q.status} /></td>
                        <td className={q.assignee_name ? undefined : "text-faint"}>{q.assignee_name ?? "Not assigned"}</td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <p className="text-sm text-faint">No queries you can see are raised against this criterion.</p>
                )}
              </Panel>
            ))
          ) : (
            <Panel><Empty title="No criteria yet">{isCia ? "Add the criteria this audit was measured against, then link queries to them from each query's Edit." : "The CIA has not added criteria yet."}</Empty></Panel>
          )}
        </div>
        <ReportSummary id={report.id} />
      </div>
      <ExportRequestDialog open={exportOpen} filters={{ report: report.id }} format="pdf" onClose={() => setExportOpen(false)} onDone={() => setFlash("PDF request sent to the CIA. Download it from Reviews once approved.")} />
    </>
  );
}

/** The summary of section 8.1: counts by status and the pie chart, for the queries in this report. */
function ReportSummary({ id }: { id: string }) {
  const { visibleQueries, state } = useStore();
  const mine = visibleQueries.filter((q) => q.reportId === id);
  const counts = new Map<string, number>();
  mine.forEach((q) => counts.set(q.status, (counts.get(q.status) ?? 0) + 1));
  return (
    <div className="space-y-5">
      <StatusPieCard summary={statusSummary(mine, state.reassignments)} subtitle="The queries in this report" />
      <Panel title="By status" subtitle={`${mine.length} ${mine.length === 1 ? "query" : "queries"} in this report`}>
        <ul className="divide-y divide-line text-sm">
          {[...counts.entries()].map(([s, n]) => (
            <li key={s} className="flex items-center justify-between py-2"><StatusBadge status={s as Status} /><span className="font-medium tabular-nums">{n}</span></li>
          ))}
          {!mine.length && <li className="py-2 text-faint">No queries yet</li>}
        </ul>
      </Panel>
    </div>
  );
}
