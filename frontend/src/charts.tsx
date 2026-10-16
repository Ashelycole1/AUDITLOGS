// Small in-house chart kit (no chart library: system.md 5). Follows the dataviz mark specs:
// 2px lines, bars <= 24px with 4px rounded data-ends, 2px surface gaps, hairline grids,
// a hover layer on every chart, a legend for 2+ series, and a table view for every chart.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./components";
import { Icon } from "./icons";

export const SERIES = "#2a78d6";
export const GOOD = "#0ca30c";
export const CRITICAL = "#d03b3b";
const GRID = "#eaecf0";
const AXIS = "#c3c9d2";
const MUTED = "#667085";
// Sequential blue ramp (dataviz reference steps 100 to 600).
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

/* Tooltip: value first and strong, label second. Positioned inside the chart box and kept on screen. */
type TipState = { x: number; y: number; body: ReactNode } | null;

function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState>(null);
  const show = (e: React.PointerEvent<Element> | React.FocusEvent<Element>, body: ReactNode) => {
    const b = box.current!.getBoundingClientRect();
    const t = e.currentTarget.getBoundingClientRect();
    const x = "clientX" in e && e.clientX ? e.clientX : t.left + t.width / 2;
    setTip({ x: x - b.left, y: t.top - b.top, body });
  };
  return { box, tip, show, hide: () => setTip(null) };
}

function TipLayer({ tip, width }: { tip: TipState; width: number }) {
  if (!tip) return null;
  const shift = tip.x < 90 ? "0%" : tip.x > width - 90 ? "-100%" : "-50%";
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-30 whitespace-nowrap rounded-lg bg-[#0c111d] px-3 py-2 text-xs leading-relaxed text-white shadow-lg"
      style={{ left: tip.x, top: tip.y - 8, transform: `translate(${shift}, -100%)` }}
    >
      {tip.body}
    </div>
  );
}

export function TipRow({ color, label, value, line }: { color?: string; label: string; value: ReactNode; line?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {color && <span className={cx("shrink-0", line ? "h-0.5 w-3 rounded" : "size-2 rounded-[2px]")} style={{ background: color }} />}
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-[#cecfd2]">{label}</span>
    </div>
  );
}

/* Card that holds a chart, with a chart/table switch so no value is only reachable by hovering. */
export type TableData = { head: string[]; rows: (string | number)[][] };

export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  aside,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  table?: TableData;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={cx("card flex min-w-0 flex-col rounded-xl p-5", className)}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {aside}
          {table && (
            <button
              type="button"
              onClick={() => setAsTable(!asTable)}
              aria-pressed={asTable}
              aria-label={asTable ? `Show ${title} as a chart` : `Show ${title} as a table`}
              title={asTable ? "Show chart" : "Show as table"}
              className="grid size-9 place-items-center rounded-lg text-faint transition-colors hover:bg-subtle hover:text-ink"
            >
              <Icon name={asTable ? "chart" : "table"} className="size-4" />
            </button>
          )}
        </div>
      </header>
      {legend && !asTable && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">{legend}</div>}
      <div className="mt-4 min-w-0 flex-1">{asTable && table ? <DataTable {...table} /> : children}</div>
    </section>
  );
}

function DataTable({ head, rows }: TableData) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-line">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-subtle text-xs text-muted">
          <tr>{head.map((h, i) => <th key={h} className={cx("px-3 py-2 font-medium", i > 0 && "text-right")}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((c, j) => <td key={j} className={cx("px-3 py-2", j > 0 && "text-right tabular-nums")}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LegendKey({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx(line ? "h-0.5 w-3.5 rounded" : "size-2.5 rounded-[3px]")} style={{ background: color }} />
      {label}
    </span>
  );
}

/* Line chart over time with an area wash, a snapping crosshair and one tooltip listing every series. */
export type TrendSeries = { name: string; color: string; values: number[]; area?: boolean };

export function TrendChart({ labels, series, height = 248 }: { labels: string[]; series: TrendSeries[]; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const m = { l: 34, r: 34, t: 10, b: 28 };
  const iw = Math.max(0, w - m.l - m.r);
  const ih = height - m.t - m.b;
  const ticks = niceTicks(Math.max(1, ...series.flatMap((s) => s.values)));
  const top = ticks[ticks.length - 1];
  const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => m.t + ih - (v / top) * ih;
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 84))));

  // End labels only where they will not collide; otherwise the legend and tooltip carry the value.
  const ends = series.map((s) => ({ s, v: s.values[n - 1], y: y(s.values[n - 1]) }));
  const showEnd = ends.map((e, i) => ends.every((o, j) => j >= i || Math.abs(o.y - e.y) >= 14));

  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1)))));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
    if (e.key === "Escape") setHover(null);
  };

  const hx = hover !== null ? x(hover) : 0;
  const shift = hx < 90 ? "0%" : hx > w - 90 ? "-100%" : "-50%";

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} />
              <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={MUTED} className="tabular-nums">{t}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every * 0.6) && (
            <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill={MUTED}>{l}</text>
          ))}
          {series.map((s) => s.area && (
            <path key={`a-${s.name}`} d={`${line(s.values)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={s.color} fillOpacity={0.1} />
          ))}
          {series.map((s) => (
            <path key={s.name} d={line(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {ends.map((e, i) => (
            <g key={e.s.name}>
              <circle cx={x(n - 1)} cy={e.y} r={4} fill={e.s.color} stroke="#fff" strokeWidth={2} />
              {showEnd[i] && <text x={x(n - 1) + 9} y={e.y} dy="0.32em" fontSize={12} fontWeight={600} fill="#101828">{e.v}</text>}
            </g>
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={m.t} y2={m.t + ih} stroke="#98a2b3" />
              {series.map((s) => <circle key={s.name} cx={hx} cy={y(s.values[hover])} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} />)}
            </g>
          )}
          <rect
            x={m.l}
            y={m.t}
            width={iw}
            height={ih}
            fill="transparent"
            tabIndex={0}
            role="img"
            aria-label={`${series.map((s) => `${s.name}: ${s.values[n - 1]} on ${labels[n - 1]}`).join(", ")}. Use the arrow keys to read earlier values.`}
            className="cursor-crosshair outline-none"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
          />
        </svg>
      )}
      {hover !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-30 whitespace-nowrap rounded-lg bg-[#0c111d] px-3 py-2 text-xs leading-relaxed text-white shadow-lg"
          style={{ left: hx, top: m.t, transform: `translate(${shift}, 0)`, marginLeft: shift === "0%" ? 12 : shift === "-100%" ? -12 : 0 }}
        >
          <div className="mb-1 text-[#cecfd2]">{labels[hover]}</div>
          {series.map((s) => <TipRow key={s.name} color={s.color} line label={s.name} value={s.values[hover]} />)}
        </div>
      )}
    </div>
  );
}

/* Horizontal bars, one series. Value at the tip. */
export function BarList({ items, color = SERIES, unit = "" }: { items: { key: string; label: ReactNode; name: string; value: number }[]; color?: string; unit?: string }) {
  const { box, tip, show, hide } = useTip();
  const [ref, w] = useWidth<HTMLDivElement>();
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0) || 1;
  return (
    <div ref={box} className="relative">
      <div ref={ref}>
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.key} className="grid grid-cols-[minmax(7.5rem,10rem)_minmax(0,1fr)] items-center gap-3">
              <span className="min-w-0 truncate text-sm">{it.label}</span>
              <span
                className="group flex min-h-6 items-center gap-2 outline-none"
                tabIndex={0}
                onPointerMove={(e) => show(e, <TipRow color={color} label={`${it.name}, ${Math.round((it.value / total) * 100)}% of all`} value={`${it.value}${unit}`} />)}
                onPointerLeave={hide}
                onFocus={(e) => show(e, <TipRow color={color} label={it.name} value={`${it.value}${unit}`} />)}
                onBlur={hide}
                aria-label={`${it.name}: ${it.value}${unit}`}
              >
                <span
                  className="h-3.5 rounded-r-[4px] transition-opacity group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-lake"
                  style={{ width: `${(it.value / max) * 82}%`, minWidth: it.value ? 3 : 0, background: color }}
                />
                <span className="text-sm font-semibold tabular-nums">{it.value}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <TipLayer tip={tip} width={w} />
    </div>
  );
}

/* Rows of stacked bars: each row's parts separated by a 2px surface gap, total at the end. */
export type Part = { key: string; name: string; color: string };

export function StackedRows({ parts, rows }: { parts: Part[]; rows: { key: string; label: ReactNode; name: string; values: Record<string, number> }[] }) {
  const { box, tip, show, hide } = useTip();
  const [ref, w] = useWidth<HTMLDivElement>();
  const totals = rows.map((r) => parts.reduce((a, p) => a + (r.values[p.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div ref={box} className="relative">
      <div ref={ref}>
        <ul className="space-y-3.5">
          {rows.map((r, ri) => (
            <li key={r.key} className="grid grid-cols-[minmax(7.5rem,10rem)_minmax(0,1fr)] items-center gap-3">
              <span className="min-w-0 truncate text-sm">{r.label}</span>
              <span className="flex min-h-6 items-center gap-2">
                <span className="flex h-3.5 gap-[2px]" style={{ width: `${(totals[ri] / max) * 82}%` }}>
                  {parts.map((p, pi) => {
                    const v = r.values[p.key] ?? 0;
                    if (!v) return null;
                    const last = parts.slice(pi + 1).every((q) => !(r.values[q.key] ?? 0));
                    return (
                      <span
                        key={p.key}
                        tabIndex={0}
                        aria-label={`${r.name}, ${p.name}: ${v}`}
                        className={cx("h-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-lake", last && "rounded-r-[4px]")}
                        style={{ flexGrow: v, flexBasis: 0, minWidth: 3, background: p.color }}
                        onPointerMove={(e) => show(e, <><div className="mb-1 text-[#cecfd2]">{r.name}</div><TipRow color={p.color} label={p.name} value={v} /></>)}
                        onPointerLeave={hide}
                        onFocus={(e) => show(e, <TipRow color={p.color} label={`${r.name}, ${p.name}`} value={v} />)}
                        onBlur={hide}
                      />
                    );
                  })}
                </span>
                <span className="text-sm font-semibold tabular-nums">{totals[ri]}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <TipLayer tip={tip} width={w} />
    </div>
  );
}

/* Vertical columns, one series. Value on the cap. */
export function Columns({ items, color = SERIES, height = 180 }: { items: { key: string; label: string; value: number; note?: string }[]; color?: string; height?: number }) {
  const { box, tip, show, hide } = useTip();
  const [ref, w] = useWidth<HTMLDivElement>();
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div ref={box} className="relative">
      <div ref={ref} className="flex items-end justify-around gap-2 border-b" style={{ height, borderColor: AXIS }}>
        {items.map((it) => (
          <div
            key={it.key}
            tabIndex={0}
            aria-label={`${it.label}: ${it.value}`}
            className="group flex h-full w-full max-w-24 flex-col items-center justify-end outline-none"
            onPointerMove={(e) => show(e, <TipRow color={color} label={it.note ?? it.label} value={it.value} />)}
            onPointerLeave={hide}
            onFocus={(e) => show(e, <TipRow color={color} label={it.note ?? it.label} value={it.value} />)}
            onBlur={hide}
          >
            <span className="mb-1 text-sm font-semibold tabular-nums">{it.value}</span>
            <span
              className="w-6 rounded-t-[4px] transition-opacity group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-lake"
              style={{ height: `${(it.value / max) * (height - 28)}px`, minHeight: it.value ? 3 : 0, background: color }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-around gap-2">
        {items.map((it) => <span key={it.key} className="w-full max-w-24 text-center text-xs text-muted">{it.label}</span>)}
      </div>
      <TipLayer tip={tip} width={w} />
    </div>
  );
}

/* Matrix of counts on a sequential blue ramp; the number is printed in every cell. */
export function Heatmap({ rows, cols, value }: { rows: { key: string; label: ReactNode; name: string }[]; cols: { key: string; label: ReactNode; name: string }[]; value: (r: string, c: string) => number }) {
  const { box, tip, show, hide } = useTip();
  const [ref, w] = useWidth<HTMLDivElement>();
  const max = Math.max(1, ...rows.flatMap((r) => cols.map((c) => value(r.key, c.key))));
  const step = (v: number) => (v === 0 ? -1 : Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 1) + 0.0001)));
  return (
    <div ref={box} className="relative">
      <div ref={ref} className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-[3px] text-sm">
          <thead>
            <tr>
              <th />
              {cols.map((c) => <th key={c.key} scope="col" className="whitespace-nowrap px-0.5 pb-1 text-center text-[0.6875rem] font-medium text-muted">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="whitespace-nowrap pr-2 text-left text-sm font-normal">{r.label}</th>
                {cols.map((c) => {
                  const v = value(r.key, c.key);
                  const s = step(v);
                  return (
                    <td
                      key={c.key}
                      tabIndex={0}
                      aria-label={`${r.name} risk, ${c.name}: ${v}`}
                      className={cx("h-10 min-w-10 rounded-md text-center font-semibold tabular-nums outline-none transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ink", s >= 3 ? "text-white" : s < 0 ? "text-faint" : "text-ink")}
                      style={{ background: s < 0 ? "#f2f4f7" : RAMP[s] }}
                      onPointerMove={(e) => show(e, <><div className="mb-1 text-[#cecfd2]">{r.name} risk</div><TipRow color={s < 0 ? "#f2f4f7" : RAMP[s]} label={c.name} value={v} /></>)}
                      onPointerLeave={hide}
                      onFocus={(e) => show(e, <TipRow label={`${r.name} risk, ${c.name}`} value={v} />)}
                      onBlur={hide}
                    >
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted" aria-hidden>
        <span>Fewer</span>
        <span className="flex gap-[2px]">{RAMP.map((c) => <span key={c} className="h-2 w-5 rounded-[2px]" style={{ background: c }} />)}</span>
        <span>More</span>
      </div>
      <TipLayer tip={tip} width={w} />
    </div>
  );
}

/* Sparkline for stat tiles: de-emphasised line, current point in the accent. */
export function Sparkline({ values, color = SERIES, height = 40 }: { values: number[]; color?: string; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const n = values.length;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const x = (i: number) => 3 + (n <= 1 ? 0 : (i / (n - 1)) * (w - 6));
  const y = (v: number) => 4 + (height - 8) - ((v - min) / span) * (height - 8);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <div ref={ref} style={{ height }} aria-hidden>
      {w > 0 && n > 1 && (
        <svg width={w} height={height} className="block overflow-visible">
          <path d={`${d}L${x(n - 1)},${height}L${x(0)},${height}Z`} fill={color} fillOpacity={0.08} />
          <path d={d} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(n - 1)} cy={y(values[n - 1])} r={3.5} fill={color} stroke="#fff" strokeWidth={2} />
        </svg>
      )}
    </div>
  );
}

/* Meter: the fill carries the value; the track is a lighter step of the same hue. */
export function Meter({ value, color = SERIES, track = "#e3eefb", label }: { value: number; color?: string; track?: string; label: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="h-2 overflow-hidden rounded-full" style={{ background: track }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label={label}>
      <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: color }} />
    </div>
  );
}
