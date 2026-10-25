import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { METRICS } from "@/lib/metrics";
import { DatabaseUnavailableError, requireDb } from "@/server/db";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function Card({ title, subtitle, children, className = "", actions }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-lg border border-line bg-surface p-4 ${className}`}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
            {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Definition, formula and limitations of a metric, available next to every KPI and chart. */
export function MetricInfo({ id }: { id: string }) {
  const m = METRICS[id];
  if (!m) return null;
  return (
    <details className="group mt-2 text-xs text-ink-2">
      <summary className="cursor-pointer select-none text-muted hover:text-ink">Definition</summary>
      <dl className="mt-2 space-y-1.5 rounded-md bg-surface-2 p-2.5">
        <div><dt className="font-medium text-ink">Definition</dt><dd>{m.definition}</dd></div>
        <div><dt className="font-medium text-ink">Formula</dt><dd className="font-mono text-[11px]">{m.formula}</dd></div>
        <div><dt className="font-medium text-ink">Source</dt><dd>{m.source}</dd></div>
        <div><dt className="font-medium text-ink">Date basis</dt><dd>{m.dateBasis}</dd></div>
        <div><dt className="font-medium text-ink">Duplicates</dt><dd>{m.duplicates}</dd></div>
        <div><dt className="font-medium text-ink">Limitations</dt><dd>{m.limitations}</dd></div>
      </dl>
    </details>
  );
}

export function Kpi({ label, value, sub, metric, tone }: { label: string; value: ReactNode; sub?: ReactNode; metric?: string; tone?: "warn" }) {
  return (
    <div className={`rounded-lg border bg-surface p-4 ${tone === "warn" ? "border-warn/50" : "border-line"}`}>
      <p className="text-xs font-medium text-ink-2">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted">{sub}</p> : null}
      {metric ? <MetricInfo id={metric} /> : null}
    </div>
  );
}

const CLAIM_LABELS: Record<string, { label: string; cls: string }> = {
  documented: { label: "Documented", cls: "bg-surface-2 text-ink-2" },
  marketing_claim: { label: "Marketing claim", cls: "bg-warn-soft text-ink" },
  official_public: { label: "Official (company)", cls: "bg-accent-soft text-accent" },
  reported_public: { label: "Reported (public)", cls: "bg-accent-soft text-accent" },
  listed_price: { label: "Listed price", cls: "bg-surface-2 text-ink-2" },
  registered_transaction: { label: "Registered (DLD)", cls: "bg-good-soft text-ink" },
  calculated: { label: "Calculated", cls: "bg-surface-2 text-ink-2" },
  estimated: { label: "Estimated", cls: "bg-warn-soft text-ink" },
  unverified: { label: "Unverified", cls: "bg-warn-soft text-ink" },
  unavailable: { label: "Unavailable", cls: "bg-surface-2 text-muted" },
};

export function ClaimBadge({ type }: { type: string }) {
  const c = CLAIM_LABELS[type] ?? { label: type, cls: "bg-surface-2 text-ink-2" };
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${c.cls}`}>{c.label}</span>;
}

const STATUS_STYLE: Record<string, { icon: string; cls: string }> = {
  completed: { icon: "✓", cls: "text-good" },
  ok: { icon: "✓", cls: "text-good" },
  completed_with_errors: { icon: "!", cls: "text-warn" },
  completed_with_warnings: { icon: "!", cls: "text-warn" },
  skipped: { icon: "=", cls: "text-muted" },
  running: { icon: "…", cls: "text-accent" },
  failed: { icon: "✕", cls: "text-crit" },
  error: { icon: "✕", cls: "text-crit" },
  interrupted: { icon: "✕", cls: "text-crit" },
  blocked: { icon: "✕", cls: "text-crit" },
  manual_only: { icon: "✎", cls: "text-ink-2" },
  not_yet_imported: { icon: "○", cls: "text-muted" },
  error_severity: { icon: "✕", cls: "text-crit" },
  warning: { icon: "!", cls: "text-warn" },
  info: { icon: "i", cls: "text-accent" },
};

/** Status always shows an icon and a text label, never colour alone. */
export function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { icon: "•", cls: "text-ink-2" };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${s.cls}`}>
      <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-full border border-current text-[10px]">{s.icon}</span>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function SeverityPill({ severity }: { severity: string }) {
  return <StatusPill status={severity === "error" ? "error_severity" : severity} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-sm">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-ink-2">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "crit"; children: ReactNode }) {
  const cls = tone === "crit" ? "border-crit/40 bg-crit-soft" : tone === "warn" ? "border-warn/50 bg-warn-soft" : "border-line bg-surface-2";
  return <div className={`rounded-md border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

/** Rendered when a data section cannot load. Never shows stack traces or connection strings. */
export function DataError({ error }: { error: unknown }) {
  if (error instanceof DatabaseUnavailableError || (error instanceof Error && error.message.startsWith("Invalid environment"))) {
    return (
      <Notice tone="crit">
        <strong>No data: MongoDB is unavailable.</strong> Start MongoDB (e.g. <code>net start MongoDB</code> in an administrator terminal) and check <code>MONGODB_URI</code> in <code>.env.local</code>, then reload.
      </Notice>
    );
  }
  console.error(error);
  return <Notice tone="crit">This section failed to load. Details were written to the server log.</Notice>;
}

/**
 * Connect, run a data loader, and turn failures into a renderable error instead of crashing the
 * page. Database reads always happen at request time: `connection()` is awaited first, outside
 * the try, so Next's prerender/prefetch signal is never swallowed.
 */
export async function loadDb<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: unknown }> {
  await connection();
  try {
    await requireDb();
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

export function Pagination({ page, pageCount, href }: { page: number; pageCount: number; href: (page: number) => string }) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm">
      <span className="text-ink-2">
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="rounded-md border border-line px-3 py-1 hover:bg-surface-2" href={href(page - 1)}>Previous</Link> : null}
        {page < pageCount ? <Link className="rounded-md border border-line px-3 py-1 hover:bg-surface-2" href={href(page + 1)}>Next</Link> : null}
      </div>
    </nav>
  );
}

export { btn, btnPrimary, input, td, tdNum, th } from "./styles";
