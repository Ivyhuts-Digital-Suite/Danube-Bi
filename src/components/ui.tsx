import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, OctagonAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { METRICS } from "@/lib/metrics";
import { DatabaseUnavailableError, requireDb } from "@/server/db";
import { panel } from "./styles";

// ---------------------------------------------------------------------------
// Page structure
// ---------------------------------------------------------------------------

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  breadcrumbs,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}) {
  return (
    <header className="mb-6">
      {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          {eyebrow ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">{eyebrow}</p> : null}
          <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-ink md:text-[28px]">{title}</h1>
          {description ? <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
    </header>
  );
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-xs text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((it, i) => (
          <li key={`${it.label}-${i}`} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight aria-hidden className="size-3" /> : null}
            {it.href ? (
              <Link href={it.href} className="hover:text-ink">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink-2">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Panel({
  title,
  subtitle,
  info,
  actions,
  footer,
  children,
  className = "",
  bodyClassName = "p-4",
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  info?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`${panel} flex min-w-0 flex-col ${className}`}>
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title ? (
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                {title}
                {info ? <InfoTip label="About this panel">{info}</InfoTip> : null}
              </h2>
            ) : null}
            {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 text-xs">{actions}</div> : null}
        </div>
      ) : null}
      <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
      {footer ? <div className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-muted">{footer}</div> : null}
    </section>
  );
}

/** Backwards-compatible alias used by forms and detail pages. */
export function Card({ title, subtitle, children, className = "", actions }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <Panel title={title} subtitle={subtitle} actions={actions} className={className}>
      {children}
    </Panel>
  );
}

export function SectionHeading({ children, description, id }: { children: ReactNode; description?: ReactNode; id?: string }) {
  return (
    <div id={id} className="mb-3 mt-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{children}</h2>
      {description ? <p className="text-xs text-muted">{description}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Definitions and tooltips
// ---------------------------------------------------------------------------

/** Accessible tooltip: opens on hover and on keyboard focus of its trigger. */
export function InfoTip({ children, label = "More information", align = "start" }: { children: ReactNode; label?: string; align?: "start" | "end" }) {
  return (
    <span className="group/tip relative inline-flex align-middle">
      <button type="button" aria-label={label} className="inline-flex size-4 items-center justify-center rounded-full text-muted hover:text-ink focus-visible:text-ink">
        <Info aria-hidden className="size-3.5" />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute top-6 z-30 w-72 rounded-md border border-line-strong bg-surface-3 p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink-2 opacity-0 shadow-panel transition-opacity group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100 ${align === "end" ? "right-0" : "left-0"}`}
      >
        {children}
      </span>
    </span>
  );
}

export function MetricDefinition({ id }: { id: string }) {
  const m = METRICS[id];
  if (!m) return null;
  return (
    <>
      <span className="block font-medium text-ink">{m.name}</span>
      <span className="mt-1 block">{m.definition}</span>
      <span className="mt-1.5 block font-mono text-[10.5px] text-muted">{m.formula}</span>
      <span className="mt-1.5 block">
        <span className="text-ink">Limits: </span>
        {m.limitations}
      </span>
    </>
  );
}

/** Definition, formula and limitations of a metric, as a tooltip with a link to Methodology. */
export function MetricInfo({ id, align }: { id: string; align?: "start" | "end" }) {
  if (!METRICS[id]) return null;
  return (
    <InfoTip label={`Definition of ${METRICS[id].name}`} align={align}>
      <MetricDefinition id={id} />
    </InfoTip>
  );
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export function KpiCard({
  label,
  value,
  sub,
  metric,
  info,
  tone,
  source,
  href,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  metric?: string;
  info?: ReactNode;
  tone?: "warn" | "crit" | "muted";
  source?: ReactNode;
  href?: string;
  icon?: LucideIcon;
}) {
  const border = tone === "warn" ? "border-warn/40" : tone === "crit" ? "border-crit/40" : "border-line";
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
          {Icon ? <Icon aria-hidden className="size-3.5 text-muted" /> : null}
          {label}
        </p>
        {metric ? <MetricInfo id={metric} align="end" /> : info ? <InfoTip align="end" label={`About ${label}`}>{info}</InfoTip> : null}
      </div>
      <p className={`tabular mt-2 text-[26px] font-semibold leading-none tracking-tight ${tone === "muted" ? "text-muted" : "text-ink"}`}>{value}</p>
      {sub ? <p className="mt-2 text-xs leading-snug text-ink-2">{sub}</p> : null}
      {source ? <p className="mt-auto pt-3 text-[11px] leading-snug text-muted">{source}</p> : null}
    </>
  );
  const cls = `flex min-w-0 flex-col rounded-panel border ${border} bg-surface p-4 shadow-panel`;
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-line-strong hover:bg-surface-2`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Backwards-compatible KPI used on detail pages. */
export function Kpi({ label, value, sub, metric, tone }: { label: string; value: ReactNode; sub?: ReactNode; metric?: string; tone?: "warn" }) {
  return <KpiCard label={label} value={value} sub={sub} metric={metric} tone={tone} />;
}

// ---------------------------------------------------------------------------
// Badges and pills
// ---------------------------------------------------------------------------

const BADGE_TONES = {
  neutral: "border-line-strong bg-surface-2 text-ink-2",
  brand: "border-brand/30 bg-brand-soft text-brand",
  accent: "border-accent/30 bg-accent-soft text-accent",
  good: "border-good/30 bg-good-soft text-good",
  warn: "border-warn/35 bg-warn-soft text-warn",
  crit: "border-crit/35 bg-crit-soft text-crit",
} as const;

export function Badge({ tone = "neutral", children, icon: Icon, title }: { tone?: keyof typeof BADGE_TONES; children: ReactNode; icon?: LucideIcon; title?: string }) {
  return (
    <span title={title} className={`inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4 ${BADGE_TONES[tone]}`}>
      {Icon ? <Icon aria-hidden className="size-3 shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

const CLAIM_LABELS: Record<string, { label: string; tone: keyof typeof BADGE_TONES }> = {
  documented: { label: "Documented", tone: "neutral" },
  marketing_claim: { label: "Marketing claim", tone: "warn" },
  official_public: { label: "Official (company)", tone: "accent" },
  reported_public: { label: "Reported (public)", tone: "accent" },
  listed_price: { label: "Listed price", tone: "neutral" },
  registered_transaction: { label: "Registered (DLD)", tone: "good" },
  calculated: { label: "Calculated", tone: "neutral" },
  estimated: { label: "Estimated", tone: "warn" },
  unverified: { label: "Unverified", tone: "warn" },
  unavailable: { label: "Unavailable", tone: "neutral" },
};

export function ClaimBadge({ type }: { type: string }) {
  const c = CLAIM_LABELS[type] ?? { label: type, tone: "neutral" as const };
  return <Badge tone={c.tone}>{c.label}</Badge>;
}

const STATUS_STYLE: Record<string, { icon: string; cls: string; label?: string }> = {
  completed: { icon: "✓", cls: "text-good" },
  ok: { icon: "✓", cls: "text-good", label: "ok" },
  completed_with_errors: { icon: "!", cls: "text-warn", label: "completed with issues" },
  completed_with_warnings: { icon: "!", cls: "text-warn", label: "completed with warnings" },
  skipped: { icon: "=", cls: "text-muted", label: "skipped (unchanged)" },
  running: { icon: "…", cls: "text-accent" },
  failed: { icon: "✕", cls: "text-crit" },
  error: { icon: "✕", cls: "text-crit" },
  interrupted: { icon: "✕", cls: "text-crit" },
  blocked: { icon: "✕", cls: "text-crit" },
  manual_only: { icon: "✎", cls: "text-ink-2", label: "manual only" },
  not_yet_imported: { icon: "○", cls: "text-muted", label: "not yet imported" },
  error_severity: { icon: "✕", cls: "text-crit", label: "error" },
  warning: { icon: "!", cls: "text-warn" },
  info: { icon: "i", cls: "text-accent", label: "review" },
  pending: { icon: "○", cls: "text-muted" },
};

/** Status always shows an icon and a text label, never colour alone. */
export function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { icon: "•", cls: "text-ink-2" };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${s.cls}`}>
      <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-full border border-current text-[9px] leading-none">
        {s.icon}
      </span>
      {s.label ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function SeverityPill({ severity }: { severity: string }) {
  return <StatusPill status={severity === "error" ? "error_severity" : severity} />;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function EmptyState({ title, children, icon: Icon, action, compact }: { title: string; children?: ReactNode; icon?: LucideIcon; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-start gap-2 rounded-panel border border-dashed border-line-strong bg-surface/60 text-sm ${compact ? "p-4" : "p-6"}`}>
      {Icon ? (
        <span className="mb-1 inline-flex size-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-muted">
          <Icon aria-hidden className="size-4.5" />
        </span>
      ) : null}
      <p className="font-medium text-ink">{title}</p>
      {children ? <div className="max-w-2xl leading-relaxed text-ink-2">{children}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** A metric that cannot be computed from the available records. */
export function Unavailable({ reason }: { reason: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-muted" title={reason}>
      Unavailable
      <InfoTip label="Why unavailable">{reason}</InfoTip>
    </span>
  );
}

const NOTICE = {
  info: { cls: "border-line-strong bg-surface-2", icon: Info, iconCls: "text-accent" },
  warn: { cls: "border-warn/35 bg-warn-soft", icon: AlertTriangle, iconCls: "text-warn" },
  crit: { cls: "border-crit/40 bg-crit-soft", icon: OctagonAlert, iconCls: "text-crit" },
  good: { cls: "border-good/35 bg-good-soft", icon: CheckCircle2, iconCls: "text-good" },
} as const;

export function Notice({ tone = "info", children, title, action }: { tone?: keyof typeof NOTICE; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  const n = NOTICE[tone];
  const Icon = n.icon;
  return (
    <div role={tone === "crit" ? "alert" : undefined} className={`flex gap-3 rounded-lg border px-3.5 py-3 text-sm ${n.cls}`}>
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${n.iconCls}`} />
      <div className="min-w-0 flex-1 leading-relaxed text-ink-2">
        {title ? <p className="font-medium text-ink">{title}</p> : null}
        {children}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-panel border border-line bg-surface" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-48 animate-pulse rounded-panel border border-line bg-surface" />
      ))}
    </div>
  );
}

/** Rendered when a data section cannot load. Never shows stack traces or connection strings. */
export function DataError({ error }: { error: unknown }) {
  if (isDbUnavailable(error) || (error instanceof Error && error.message.startsWith("Invalid environment"))) {
    return (
      <Notice tone="crit" title="No data: MongoDB is unavailable">
        Check that the database is reachable and that <code>MONGODB_URI</code> in <code>.env.local</code> is correct, then reload. See{" "}
        <Link className="underline" href="/system">
          System Health
        </Link>
        .
      </Notice>
    );
  }
  // Log a plain string: raw driver errors hold Maps/topology objects that the dev server cannot
  // forward to the browser console, and they can contain host names.
  console.error(`[data] ${error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)}`);
  return <Notice tone="crit">This section failed to load. Details were written to the server log.</Notice>;
}

/** Connection, server-selection and network failures from the MongoDB driver mean "database unavailable". */
function isDbUnavailable(error: unknown): boolean {
  if (error instanceof DatabaseUnavailableError) return true;
  return error instanceof Error && /^Mongo(ServerSelection|NetworkTimeout|Network|TopologyClosed|NotConnected)Error$/.test(error.name);
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

export function Pagination({ page, pageCount, href, total, pageSize }: { page: number; pageCount: number; href: (page: number) => string; total?: number; pageSize?: number }) {
  if (pageCount <= 1 && total == null) return null;
  const from = total != null && pageSize ? Math.min(total, (page - 1) * pageSize + 1) : null;
  const to = total != null && pageSize ? Math.min(total, page * pageSize) : null;
  const pages = [...new Set([1, page - 1, page, page + 1, pageCount])].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const cls = "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-line px-2 text-xs";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="tabular text-xs text-muted">
        {from != null && to != null ? `${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")} of ${total!.toLocaleString("en-US")}` : `Page ${page} of ${pageCount}`}
      </span>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          {page > 1 ? (
            <Link aria-label="Previous page" className={`${cls} hover:bg-surface-2`} href={href(page - 1)}>
              <ChevronLeft aria-hidden className="size-3.5" />
            </Link>
          ) : null}
          {pages.map((p, i) => (
            <span key={p} className="flex items-center gap-1">
              {i > 0 && p - pages[i - 1] > 1 ? <span className="px-1 text-muted">…</span> : null}
              <Link aria-current={p === page ? "page" : undefined} className={`${cls} tabular ${p === page ? "border-line-strong bg-surface-3 font-semibold text-ink" : "text-ink-2 hover:bg-surface-2"}`} href={href(p)}>
                {p}
              </Link>
            </span>
          ))}
          {page < pageCount ? (
            <Link aria-label="Next page" className={`${cls} hover:bg-surface-2`} href={href(page + 1)}>
              <ChevronRight aria-hidden className="size-3.5" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

export { btn, btnGhost, btnPrimary, input, label, link, panel, td, tdNum, th } from "./styles";
