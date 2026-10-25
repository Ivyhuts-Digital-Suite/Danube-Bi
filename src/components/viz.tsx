// Server-rendered chart primitives (plain HTML/CSS): ranked bars, part-to-whole bars and
// interquartile ranges. They need no client JavaScript, so values are visible before hydration,
// readable by screen readers, and printable.

import Link from "next/link";
import type { ReactNode } from "react";
import { niceStep } from "@/lib/inventory-analytics";
import { MetricInfo, Panel } from "./ui";

const fmt0 = (v: number) => Math.round(v).toLocaleString("en-US");

// ---------------------------------------------------------------------------
// Chart panel: title, definition, scope, source and an equivalent data table.
// ---------------------------------------------------------------------------

export interface DataTable {
  head: string[];
  rows: Array<Array<string | number | null>>;
  /** Column indexes that are numeric (right-aligned). Defaults to number-typed cells. */
}

export function ChartPanel({
  title,
  subtitle,
  metric,
  info,
  source,
  table,
  actions,
  children,
  className = "",
  summary,
}: {
  title: string;
  subtitle?: ReactNode;
  metric?: string;
  info?: ReactNode;
  source?: ReactNode;
  table?: DataTable;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** One-sentence plain-language reading of the chart, for screen readers and skimmers. */
  summary?: string;
}) {
  return (
    <Panel
      className={className}
      title={
        <>
          {title}
          {metric ? <MetricInfo id={metric} /> : null}
        </>
      }
      info={metric ? undefined : info}
      subtitle={subtitle}
      actions={actions}
      footer={
        source || table ? (
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            {source ? <span>Source: {source}</span> : <span />}
            {table ? <TableToggle table={table} title={title} /> : null}
          </div>
        ) : undefined
      }
    >
      <figure className="m-0">
        {summary ? <figcaption className="sr-only">{summary}</figcaption> : null}
        {children}
      </figure>
    </Panel>
  );
}

function TableToggle({ table, title }: { table: DataTable; title: string }) {
  return (
    <details className="group w-full text-[11px] sm:w-auto">
      <summary className="cursor-pointer list-none text-link hover:underline">
        <span className="group-open:hidden">Show data table</span>
        <span className="hidden group-open:inline">Hide data table</span>
      </summary>
      <div className="scroll-thin mt-2 max-h-72 overflow-auto rounded border border-line">
        <table className="w-full text-xs">
          <caption className="sr-only">{title} — data</caption>
          <thead>
            <tr>
              {table.head.map((h) => (
                <th key={h} scope="col" className="sticky top-0 border-b border-line bg-surface-2 px-2 py-1.5 text-left font-medium text-ink-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={`border-b border-line px-2 py-1 text-ink-2 ${typeof c === "number" ? "tabular text-right" : ""}`}>
                    {c == null ? "—" : typeof c === "number" ? c.toLocaleString("en-US", { maximumFractionDigits: 1 }) : c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Ranked horizontal bars
// ---------------------------------------------------------------------------

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** Formatted value shown at the end of the row. */
  display?: string;
  /** Secondary text under the label (e.g. sample size). */
  secondary?: ReactNode;
  href?: string;
  /** Extra lines in the hover/focus card. */
  details?: Array<[string, string]>;
  muted?: boolean;
}

export function BarList({ items, ariaLabel, max, color = "var(--series-1)", emptyText = "No data" }: { items: BarItem[]; ariaLabel: string; max?: number; color?: string; emptyText?: string }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  const top = max ?? Math.max(...items.map((i) => i.value), 0);
  return (
    <ul aria-label={ariaLabel} className="space-y-0.5">
      {items.map((it) => {
        const pct = top > 0 ? Math.max(0.6, (it.value / top) * 100) : 0;
        const inner = (
          <>
            <div className="flex min-w-0 items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-ink" title={it.label}>
                {it.label}
              </span>
              <span className="tabular shrink-0 font-medium text-ink">{it.display ?? fmt0(it.value)}</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-[3px] bg-track" aria-hidden>
              <div className="h-full rounded-r-[4px] transition-[filter] group-hover/bar:brightness-125" style={{ width: `${pct}%`, background: it.muted ? "var(--series-muted)" : color }} />
            </div>
            {it.secondary ? <div className="mt-0.5 text-[11px] text-muted">{it.secondary}</div> : null}
            {it.details?.length ? (
              <span role="tooltip" className="pointer-events-none invisible absolute right-2 top-full z-20 mt-1 w-60 rounded-md border border-line-strong bg-surface-3 p-2.5 text-[11px] opacity-0 shadow-panel transition-opacity group-hover/bar:visible group-hover/bar:opacity-100 group-focus-visible/bar:visible group-focus-visible/bar:opacity-100">
                <span className="mb-1 block font-medium text-ink">{it.label}</span>
                {it.details.map(([k, v]) => (
                  <span key={k} className="flex justify-between gap-3 text-ink-2">
                    <span>{k}</span>
                    <span className="tabular text-ink">{v}</span>
                  </span>
                ))}
              </span>
            ) : null}
          </>
        );
        const cls = "group/bar relative block rounded-md px-2 py-1.5";
        return (
          <li key={it.key}>
            {it.href ? (
              <Link href={it.href} className={`${cls} hover:bg-surface-2`}>
                {inner}
              </Link>
            ) : (
              <div tabIndex={it.details?.length ? 0 : undefined} className={`${cls} hover:bg-surface-2`}>
                {inner}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Part-to-whole bar with legend (≤ 6 segments)
// ---------------------------------------------------------------------------

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
  href?: string;
}

export function StackedBar({ segments, ariaLabel, unit = "records" }: { segments: Segment[]; ariaLabel: string; unit?: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const visible = segments.filter((s) => s.value > 0);
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  return (
    <div>
      <div role="img" aria-label={`${ariaLabel}: ${visible.map((s) => `${s.label} ${fmt0(s.value)}`).join(", ")}`} className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-[4px] bg-track">
        {visible.map((s) => (
          <div key={s.key} title={`${s.label}: ${fmt0(s.value)} (${pct(s.value).toFixed(1)}%)`} className="h-full first:rounded-l-[4px] last:rounded-r-[4px]" style={{ width: `${pct(s.value)}%`, minWidth: 3, background: s.color }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {segments.map((s) => {
          const body = (
            <>
              <span aria-hidden className="mt-1 size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
              <span className="min-w-0">
                <span className="block truncate text-xs text-ink-2">{s.label}</span>
                <span className="tabular block text-sm font-semibold text-ink">
                  {fmt0(s.value)} <span className="text-xs font-normal text-muted">{pct(s.value).toFixed(1)}%</span>
                </span>
              </span>
            </>
          );
          return (
            <li key={s.key}>
              {s.href && s.value > 0 ? (
                <Link href={s.href} className="-m-1 flex gap-2 rounded-md p-1 hover:bg-surface-2">
                  {body}
                </Link>
              ) : (
                <div className="flex gap-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="sr-only">
        Total {fmt0(total)} {unit}.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interquartile ranges per group (box-plot without the box clutter)
// ---------------------------------------------------------------------------

export interface RangeItem {
  key: string;
  label: string;
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  href?: string;
  /** Rendered de-emphasised with a "small sample" note. */
  small?: boolean;
}

function ticks(lo: number, hi: number, target = 5) {
  const step = niceStep(lo, hi, target);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

export function RangeList({ items, ariaLabel, format = fmt0, unitLabel }: { items: RangeItem[]; ariaLabel: string; format?: (v: number) => string; unitLabel: string }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted">No groups with enough data</p>;
  const lo = Math.min(...items.map((i) => i.min));
  const hi = Math.max(...items.map((i) => i.max));
  const span = hi - lo || 1;
  const x = (v: number) => ((v - lo) / span) * 100;
  const axis = ticks(lo, hi);
  return (
    <div role="group" aria-label={ariaLabel}>
      <ul className="space-y-1">
        {items.map((it) => {
          const row = (
            <div className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
              <div className="min-w-0">
                <p className={`truncate text-xs ${it.small ? "text-muted" : "text-ink"}`} title={it.label}>
                  {it.label}
                </p>
                <p className="tabular text-[11px] text-muted">
                  n = {fmt0(it.n)}
                  {it.small ? " · small sample" : ""}
                </p>
              </div>
              <div className="relative h-6" aria-label={`${it.label}: median ${format(it.median)}, middle half ${format(it.p25)} to ${format(it.p75)}, range ${format(it.min)} to ${format(it.max)} ${unitLabel}`}>
                {axis.map((t) => (
                  <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-grid" style={{ left: `${x(t)}%`, background: "var(--grid)" }} />
                ))}
                <span aria-hidden className="absolute top-1/2 h-px -translate-y-1/2 bg-muted/70" style={{ left: `${x(it.min)}%`, width: `${Math.max(0.3, x(it.max) - x(it.min))}%` }} />
                <span
                  aria-hidden
                  className="absolute top-1/2 h-3 -translate-y-1/2 rounded-[3px]"
                  style={{ left: `${x(it.p25)}%`, width: `${Math.max(0.6, x(it.p75) - x(it.p25))}%`, background: it.small ? "var(--series-muted)" : "color-mix(in oklab, var(--series-1) 55%, transparent)" }}
                />
                <span aria-hidden className="absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: `${x(it.median)}%` }} />
                <span
                  role="tooltip"
                  className="pointer-events-none invisible absolute bottom-full right-0 z-20 mb-1 w-56 rounded-md border border-line-strong bg-surface-3 p-2.5 text-[11px] opacity-0 shadow-panel transition-opacity group-hover/rng:visible group-hover/rng:opacity-100 group-focus-visible/rng:visible group-focus-visible/rng:opacity-100"
                >
                  <span className="mb-1 block font-medium text-ink">{it.label}</span>
                  {(
                    [
                      ["Median", it.median],
                      ["25th–75th pct", null],
                      ["Min – max", null],
                    ] as const
                  ).map(([k]) => (
                    <span key={k} className="flex justify-between gap-3 text-ink-2">
                      <span>{k}</span>
                      <span className="tabular text-ink">{k === "Median" ? format(it.median) : k === "25th–75th pct" ? `${format(it.p25)} – ${format(it.p75)}` : `${format(it.min)} – ${format(it.max)}`}</span>
                    </span>
                  ))}
                  <span className="mt-1 block text-muted">n = {fmt0(it.n)} {unitLabel}</span>
                </span>
              </div>
            </div>
          );
          const cls = "group/rng relative block rounded-md px-2 py-1 hover:bg-surface-2";
          return (
            <li key={it.key}>
              {it.href ? (
                <Link href={it.href} className={cls}>
                  {row}
                </Link>
              ) : (
                <div tabIndex={0} className={cls}>
                  {row}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div aria-hidden className="mt-1 grid grid-cols-[minmax(0,9rem)_1fr] gap-3 px-2 sm:grid-cols-[minmax(0,12rem)_1fr]">
        <span />
        <div className="relative h-4">
          {axis.map((t) => (
            <span key={t} className="tabular absolute -translate-x-1/2 text-[10px] text-muted" style={{ left: `${x(t)}%` }}>
              {format(t)}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-5 rounded-[2px]" style={{ background: "color-mix(in oklab, var(--series-1) 55%, transparent)" }} />
          Middle 50% (25th–75th percentile)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-[3px] rounded-full bg-ink" />
          Median
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-px w-5 bg-muted/70" />
          Min – max
        </span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small inline meter (coverage %, completeness)
// ---------------------------------------------------------------------------

export function Meter({ value, total, label, tone }: { value: number; total: number; label: string; tone?: "warn" | "good" }) {
  const p = total > 0 ? value / total : 0;
  const color = tone === "warn" ? "var(--warn)" : tone === "good" ? "var(--good)" : "var(--series-1)";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-2">{label}</span>
        <span className="tabular text-ink">
          {(p * 100).toFixed(1)}% <span className="text-muted">({fmt0(value)} / {fmt0(total)})</span>
        </span>
      </div>
      <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full" style={{ width: `${p * 100}%`, background: color }} />
      </div>
    </div>
  );
}
