import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Check, Empty, Notice, PageHeader, Panel, Ref, Table, cx } from "../components";
import { fmtDateTime } from "../lib/rules";
import { sha256 } from "../lib/sha256";
import { useStore } from "../store";
import type { ImportRow } from "../types";

// Column mapping is configurable until the client supplies a template (design.md 4, system.md open items).
const COLUMNS = ["reference", "title", "description", "risk_rating", "deadline", "responsible_officer", "department"] as const;

const SAMPLE = `reference,title,description,risk_rating,deadline,responsible_officer,department
IA/2026/041,Stock count differences not investigated,Differences from the June stock count were written off without investigation.,Medium,2026-12-15,Stores Supervisor,Stores
IA/2026/042,Overtime paid without approval forms,Overtime for 14 staff was paid in August without signed approval forms.,High,2026-11-30,HR Manager,Human Resources
IA/2026/043,Insurance cover lapsed on two vehicles,Comprehensive cover for two pool vehicles lapsed in July and was not renewed.,High,2026-11-20,Transport Officer,Fleet
,Website content not reviewed,Public website lists staff who left more than a year ago.,Low,2026-12-31,Communications Officer,Communications
IA/2026/042,Duplicate supplier records,The supplier master file has 37 suppliers recorded twice.,Medium,2026-12-10,Financial Controller,Finance
IA/2026/046,Unused software licences,Forty licences for the design suite have not been used in six months.,Severe,2026-12-01,ICT Manager,ICT
IA/2026/047,Board minutes not signed,Minutes for three board meetings are unsigned in the company file.,Low,31/11/2026,Company Secretary,Legal`;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function validate(text: string, existing: Set<string>): { rows: ImportRow[]; error?: string } {
  const [head, ...body] = parseCsv(text);
  if (!head) return { rows: [], error: "The file is empty." };
  const idx = COLUMNS.map((c) => head.findIndex((h) => h.trim().toLowerCase() === c));
  const missing = COLUMNS.filter((_, i) => idx[i] < 0);
  if (missing.length) return { rows: [], error: `The file is missing these columns: ${missing.join(", ")}.` };
  const seen = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);
  const rows = body.map<ImportRow>((cells, n) => {
    const get = (c: (typeof COLUMNS)[number]) => (cells[idx[COLUMNS.indexOf(c)]] ?? "").trim();
    const r: ImportRow = {
      line: n + 2,
      reference: get("reference"),
      title: get("title"),
      description: get("description"),
      riskRating: get("risk_rating"),
      deadline: get("deadline"),
      responsibleOfficer: get("responsible_officer"),
      department: get("department"),
      errors: [],
    };
    if (!r.reference) r.errors.push("Missing reference");
    else if (r.reference.length > 50) r.errors.push("Reference over 50 characters");
    else if (existing.has(r.reference)) r.errors.push("Reference already imported");
    else if (seen.has(r.reference)) r.errors.push("Duplicate reference in this file");
    seen.add(r.reference);
    if (!r.title) r.errors.push("Missing title");
    if (!["High", "Medium", "Low"].includes(r.riskRating)) r.errors.push(`Unknown rating "${r.riskRating || "blank"}"`);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(r.deadline) ? new Date(r.deadline + "T00:00:00Z") : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== r.deadline) r.errors.push(`Bad date "${r.deadline || "blank"}", use YYYY-MM-DD`);
    else if (r.deadline < today) r.errors.push("Deadline is before today");
    return r;
  });
  return { rows };
}

interface Preview {
  filename: string;
  hash: string;
  rows: ImportRow[];
}

export function ImportPage() {
  const { state, confirmImport, cancelImport } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);

  const load = (filename: string, text: string) => {
    setDone(null);
    const res = validate(text, new Set(state.queries.map((q) => q.reference)));
    if (res.error) {
      setPreview(null);
      return setError(res.error);
    }
    setError(null);
    setPreview({ filename, hash: sha256(text), rows: res.rows });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx") return setError("Excel files are read on the server. This preview reads CSV only; save the sheet as CSV or load the sample.");
    if (ext !== "csv") return setError("Upload the final queries as an Excel (.xlsx) or CSV file.");
    load(f.name, await f.text());
    if (input.current) input.current.value = "";
  };

  const blocking = preview?.rows.filter((r) => r.errors.length).length ?? 0;
  const shown = preview ? (problemsOnly ? preview.rows.filter((r) => r.errors.length) : preview.rows) : [];

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    onFile(e.dataTransfer.files?.[0]);
  };

  return (
    <>
      <PageHeader
        title="Import final queries"
        lede="Upload the final queries file, check every line, then confirm. Confirmed queries are locked. After that, only the CIA can correct them."
      />
      {done && <div className="mb-4"><Notice tone="ok">{done} <Link to="/queries" className="font-medium underline">View all queries</Link></Notice></div>}

      {!preview ? (
        <Panel>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx(
              "flex flex-col items-center rounded-md border-2 border-dashed px-6 py-12 text-center transition-colors",
              dragging ? "border-spine bg-lake-wash" : "border-rule",
            )}
          >
            <svg viewBox="0 0 40 48" className="h-12 w-10 text-spine" aria-hidden>
              <path d="M6 2h20l12 12v30a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill="#fafbf7" stroke="currentColor" strokeWidth="2" />
              <path d="M26 2v12h12" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M11 24h18M11 30h18M11 36h12" stroke="currentColor" strokeWidth="2" strokeOpacity=".35" />
            </svg>
            <p className="mt-4 text-lg font-semibold tracking-[-0.01em]">{dragging ? "Drop to check the file" : "Drop the final queries file here"}</p>
            <p className="mt-1 text-sm text-muted">Excel or CSV. Nothing is imported until you confirm.</p>
            <input ref={input} id="import-file" type="file" accept=".csv,.xlsx" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button kind="primary" onClick={() => input.current?.click()}>Choose file</Button>
              <Button kind="secondary" onClick={() => load("sample-final-queries.csv", SAMPLE)}>Load sample file</Button>
            </div>
            {error && <div className="mt-5 w-full max-w-lg text-left"><Notice tone="error">{error}</Notice></div>}
          </div>

          {/* The template the file must follow, drawn as the header row it should start with. */}
          <p className="mt-6 text-sm font-medium">The first row must have these columns, in any order</p>
          <div className="mt-2 overflow-x-auto">
            <ol className="flex min-w-max border border-rule bg-white font-mono text-xs">
              {COLUMNS.map((c) => <li key={c} className="border-l border-rule px-3 py-2 first:border-l-0">{c}</li>)}
            </ol>
          </div>
          <p className="mt-2 text-[0.8125rem] text-muted">Risk is High, Medium or Low. Deadlines are written YYYY-MM-DD. The file and its fingerprint are kept with the batch.</p>
        </Panel>
      ) : (
        <section className="sheet rounded-xl">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 className="truncate text-[1.0625rem] font-semibold">{preview.filename}</h2>
              <p className="mt-0.5 font-mono text-xs text-faint" title={preview.hash}>sha256 {preview.hash.slice(0, 24)}</p>
            </div>
            <dl className="flex gap-6 text-sm">
              <div className="flex items-center gap-1.5"><Check ok /><dt className="sr-only">Ready</dt><dd><span className="font-semibold">{preview.rows.length - blocking}</span> ready</dd></div>
              <div className="flex items-center gap-1.5"><Check ok={false} /><dt className="sr-only">Problems</dt><dd className={cx(blocking > 0 && "text-danger")}><span className="font-semibold">{blocking}</span> with problems</dd></div>
            </dl>
          </header>

          <div className="px-5 pt-4 sm:px-6">
            {blocking ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Notice tone="error">Fix the lines marked with a cross in the file, then upload it again. The file is imported whole or not at all.</Notice>
                <label className="flex min-h-10 items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-[#256abf]" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
                  Show only lines with problems
                </label>
              </div>
            ) : (
              <Notice tone="ok">Every line is valid. Confirming creates {preview.rows.length} queries with the status Imported.</Notice>
            )}
          </div>

          <div className="px-5 pt-4 sm:px-6">
            <Table head={["Line", "Reference", "Title", "Risk", "Deadline", "Department", "Problems"]}>
              {shown.map((r) => (
                <tr key={r.line} className={cx("align-top", r.errors.length > 0 && "bg-danger-wash/55")}>
                  <td className="w-[4.5rem]">
                    <span className="flex items-center gap-2">
                      <Check ok={!r.errors.length} label={r.errors.length ? "Has problems" : "Valid"} />
                      <span className="font-mono text-xs text-muted">{r.line}</span>
                    </span>
                  </td>
                  <td>{r.reference ? <Ref>{r.reference}</Ref> : <span className="text-danger">blank</span>}</td>
                  <td className="min-w-[14rem]">{r.title}</td>
                  <td>{r.riskRating}</td>
                  <td className="whitespace-nowrap">{r.deadline}</td>
                  <td>{r.department}</td>
                  <td className="min-w-[12rem]">
                    {r.errors.length ? <ul className="space-y-0.5 text-danger">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul> : <span className="text-faint">None</span>}
                  </td>
                </tr>
              ))}
            </Table>
          </div>

          {/* Stays in view while scrolling a long file. */}
          <footer className="sticky bottom-0 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-b-[10px] border-t border-line bg-sheet/95 px-5 py-4 backdrop-blur-sm sm:px-6">
            <p className="text-sm text-muted">
              {blocking ? `${blocking} ${blocking === 1 ? "line needs" : "lines need"} fixing before you can confirm.` : "Once confirmed, you cannot edit these queries."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button kind="quiet" onClick={() => { cancelImport(preview.filename, preview.hash, preview.rows.length); setPreview(null); setProblemsOnly(false); }}>Cancel import</Button>
              <Button
                kind="primary"
                disabled={blocking > 0}
                onClick={() => {
                  const r = confirmImport(preview.filename, preview.hash, preview.rows);
                  if (!r.ok) return setError(r.error);
                  setDone(`Imported ${preview.rows.length} queries from ${preview.filename}.`);
                  setPreview(null);
                }}
              >
                Confirm {preview.rows.length} queries
              </Button>
            </div>
            {error && <div className="w-full"><Notice tone="error">{error}</Notice></div>}
          </footer>
        </section>
      )}
    </>
  );
}

const BATCH_MARK: Record<string, { ok?: boolean; pending?: boolean }> = {
  Confirmed: { ok: true },
  Previewed: { pending: true },
  Cancelled: { ok: false },
};

export function BatchesPage() {
  const { state, userName } = useStore();
  const batches = [...state.batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <PageHeader title="Import batches" lede="Every upload, newest first, with the file's fingerprint so the source can be checked later." />
      <Panel>
        <Table
          head={["File", "Queries", "Status", "Imported by", "When"]}
          empty={!batches.length && <div className="px-5 pb-2 sm:px-6"><Empty title="No imports yet">Files the PIA confirms appear here.</Empty></div>}
        >
          {batches.map((b) => (
            <tr key={b.id} className={cx(b.status === "Cancelled" && "text-muted")}>
              <td>
                <span className="font-medium">{b.sourceFilename}</span>
                <span className="mt-0.5 block font-mono text-xs text-faint" title={b.sourceSha256}>sha256 {b.sourceSha256.slice(0, 24)}</span>
              </td>
              <td className="font-semibold">{b.rowCount}</td>
              <td>
                <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium">
                  <Check {...BATCH_MARK[b.status]} />
                  {b.status}
                </span>
              </td>
              <td>{userName(b.importedBy)}</td>
              <td className="whitespace-nowrap">{fmtDateTime(b.confirmedAt ?? b.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
