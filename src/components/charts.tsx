"use client";

import { useSyncExternalStore } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";

// ---------------------------------------------------------------------------
// Theme colors: Recharts writes SVG attributes, so read the CSS tokens and re-read on theme change.
// ---------------------------------------------------------------------------

const TOKENS = ["--series-1", "--series-2", "--series-3", "--series-muted", "--ink", "--muted", "--surface", "--surface-2", "--border-strong"] as const;
type Palette = Record<(typeof TOKENS)[number], string>;

const FALLBACK: Palette = {
  "--series-1": "#3987e5",
  "--series-2": "#d95926",
  "--series-3": "#199e70",
  "--series-muted": "#4b5a77",
  "--ink": "#e8edf6",
  "--muted": "#8592ab",
  "--surface": "#0f1829",
  "--surface-2": "#142036",
  "--border-strong": "#2c3c5c",
};

let cache: { theme: string | null; palette: Palette } | null = null;

function read(): Palette {
  const theme = document.documentElement.getAttribute("data-theme");
  if (cache && cache.theme === theme) return cache.palette;
  const cs = getComputedStyle(document.documentElement);
  const palette = Object.fromEntries(TOKENS.map((t) => [t, cs.getPropertyValue(t).trim() || FALLBACK[t]])) as Palette;
  cache = { theme, palette };
  return palette;
}

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

export function useChartPalette(): Palette {
  return useSyncExternalStore(subscribe, read, () => FALLBACK);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export type Fmt = "int" | "aed" | "aedCompact" | "psf";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatValue(v: number, fmt: Fmt): string {
  if (fmt === "aed") return `AED ${Math.round(v).toLocaleString("en-US")}`;
  if (fmt === "aedCompact") return `AED ${compact.format(v)}`;
  if (fmt === "psf") return `AED ${Math.round(v).toLocaleString("en-US")}/sq ft`;
  return Math.round(v).toLocaleString("en-US");
}

function TooltipCard({ title, lines }: { title: string; lines: Array<[string, string]> }) {
  return (
    <div className="rounded-md border border-line-strong bg-surface-3 px-3 py-2 text-xs shadow-panel">
      <p className="mb-1 font-medium text-ink">{title}</p>
      {lines.map(([k, v]) => (
        <p key={k} className="flex justify-between gap-4 text-ink-2">
          <span>{k}</span>
          <span className="tabular font-medium text-ink">{v}</span>
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Histogram / ordered bands (vertical bars, one series)
// ---------------------------------------------------------------------------

export interface BinDatum {
  label: string;
  count: number;
}

export function Histogram({ data, xLabel, countLabel = "units", ariaLabel, height = 220 }: { data: BinDatum[]; xLabel: string; countLabel?: string; ariaLabel: string; height?: number }) {
  const p = useChartPalette();
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="viz w-full" style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 22, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} interval={data.length <= 8 ? 0 : "preserveStartEnd"} minTickGap={2} tick={{ fontSize: 10.5 }} label={{ value: xLabel, position: "insideBottom", offset: -14 }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
          <Tooltip
            cursor={{ fill: p["--surface-2"] }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as BinDatum;
              return <TooltipCard title={`${xLabel}: ${d.label}`} lines={[[countLabel, d.count.toLocaleString("en-US")], ["Share", total ? `${((d.count / total) * 100).toFixed(1)}%` : "—"]]} />;
            }}
          />
          <Bar dataKey="count" fill={p["--series-1"]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scatter: listed price vs size (one series, optional highlighted outliers)
// ---------------------------------------------------------------------------

export interface ScatterDatum {
  id: string;
  x: number;
  y: number;
  label: string;
  outlier?: boolean;
}

export function PriceSizeScatter({ data, ariaLabel, height = 300 }: { data: ScatterDatum[]; ariaLabel: string; height?: number }) {
  const p = useChartPalette();
  const normal = data.filter((d) => !d.outlier);
  const outliers = data.filter((d) => d.outlier);
  return (
    <div className="viz w-full" style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 22, left: 4 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" name="Size" tickLine={false} tickFormatter={(v: number) => v.toLocaleString("en-US")} label={{ value: "Size (sq ft)", position: "insideBottom", offset: -14 }} domain={["auto", "auto"]} />
          <YAxis type="number" dataKey="y" name="Listed price" tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => formatValue(v, "aedCompact").replace("AED ", "")} domain={["auto", "auto"]} />
          <ZAxis range={[28, 28]} />
          <Tooltip
            cursor={{ stroke: p["--border-strong"] }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as ScatterDatum;
              return (
                <TooltipCard
                  title={d.label}
                  lines={[
                    ["Listed price", formatValue(d.y, "aed")],
                    ["Size", `${Math.round(d.x).toLocaleString("en-US")} sq ft`],
                    ["AED / sq ft", Math.round(d.y / d.x).toLocaleString("en-US")],
                    ...(d.outlier ? ([["Flag", "AED/sq ft outlier"]] as Array<[string, string]>) : []),
                  ]}
                />
              );
            }}
          />
          <Scatter data={normal} fill={p["--series-1"]} fillOpacity={0.55} isAnimationActive={false} />
          {outliers.length ? <Scatter data={outliers} fill={p["--series-2"]} stroke={p["--surface"]} strokeWidth={2} isAnimationActive={false} /> : null}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vertical bars over time (months)
// ---------------------------------------------------------------------------

export interface TimeDatum {
  label: string;
  value: number;
  n?: number;
}

export function TimeBarChart({ data, fmt = "int", valueLabel, ariaLabel }: { data: TimeDatum[]; fmt?: Fmt; valueLabel: string; ariaLabel: string }) {
  const p = useChartPalette();
  return (
    <div className="viz h-64 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} minTickGap={12} />
          <YAxis tickFormatter={(v: number) => formatValue(v, fmt === "aed" ? "aedCompact" : fmt)} tickLine={false} axisLine={false} width={72} />
          <Tooltip
            cursor={{ fill: p["--surface-2"] }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as TimeDatum;
              return <TooltipCard title={d.label} lines={[[valueLabel, formatValue(d.value, fmt)], ...(d.n != null ? ([["n", d.n.toLocaleString("en-US")]] as Array<[string, string]>) : [])]} />;
            }}
          />
          <Bar dataKey="value" fill={p["--series-1"]} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
