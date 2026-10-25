"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface BarDatum {
  label: string;
  value: number;
  /** Optional sample size shown in the tooltip. */
  n?: number;
}

type Fmt = "int" | "aed" | "aedCompact";

function format(v: number, fmt: Fmt): string {
  if (fmt === "aed") return `AED ${Math.round(v).toLocaleString("en-US")}`;
  if (fmt === "aedCompact") return `AED ${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;
  return Math.round(v).toLocaleString("en-US");
}

function TooltipBox({ active, payload, fmt, valueLabel }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }>; fmt: Fmt; valueLabel: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as BarDatum;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="tabular text-sm font-semibold text-ink">{format(d.value, fmt)}</p>
      <p className="text-ink-2">
        {d.label} · {valueLabel}
      </p>
      {d.n != null ? <p className="text-muted">n = {d.n.toLocaleString("en-US")}</p> : null}
    </div>
  );
}

/** Horizontal bars for ranking categories (single series: the title names it, no legend). */
export function HBarChart({ data, fmt = "int", valueLabel, ariaLabel }: { data: BarDatum[]; fmt?: Fmt; valueLabel: string; ariaLabel: string }) {
  const height = Math.max(120, data.length * 28 + 40);
  return (
    <div className="viz w-full" style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap={4}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" tickFormatter={(v: number) => format(v, fmt === "aed" ? "aedCompact" : fmt)} tickLine={false} />
          <YAxis type="category" dataKey="label" width={130} tickLine={false} axisLine={false} interval={0} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={(p) => <TooltipBox {...p} fmt={fmt} valueLabel={valueLabel} />} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical bars over time (months). */
export function TimeBarChart({ data, fmt = "int", valueLabel, ariaLabel }: { data: BarDatum[]; fmt?: Fmt; valueLabel: string; ariaLabel: string }) {
  return (
    <div className="viz h-64 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} minTickGap={12} />
          <YAxis tickFormatter={(v: number) => format(v, fmt === "aed" ? "aedCompact" : fmt)} tickLine={false} axisLine={false} width={88} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={(p) => <TooltipBox {...p} fmt={fmt} valueLabel={valueLabel} />} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
