import type { ReactNode } from "react";
import { MetricInfo } from "./ui";

/**
 * Every chart carries a title, the metric definition, its period and its source, plus a table
 * view so no value depends on hovering.
 */
export function ChartFrame({
  title,
  metric,
  period,
  source,
  table,
  children,
}: {
  title: string;
  metric: string;
  period: string;
  source: string;
  table: { head: string[]; rows: Array<Array<string | number>> };
  children: ReactNode;
}) {
  return (
    <figure className="rounded-lg border border-line bg-surface p-4">
      <figcaption className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted">
          {period} · Source: {source}
        </p>
      </figcaption>
      {children}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted hover:text-ink">Data table</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {table.head.map((h) => (
                  <th key={h} className="border-b border-line px-2 py-1 text-left font-medium text-ink-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={`border-b border-line px-2 py-1 ${typeof c === "number" ? "tabular text-right" : ""}`}>
                      {typeof c === "number" ? c.toLocaleString("en-US", { maximumFractionDigits: 1 }) : c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <MetricInfo id={metric} />
    </figure>
  );
}
