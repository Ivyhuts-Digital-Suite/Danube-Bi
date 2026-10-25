import { X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { href, type Params } from "@/lib/url";

export interface Chip {
  key: string;
  label: ReactNode;
}

/** Applied filters as removable chips, plus a reset link. */
export function FilterChips({ path, params, chips, resetParams = {} }: { path: string; params: Params; chips: Chip[]; resetParams?: Params }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Applied filters">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Applied</span>
      {chips.map((c) => (
        <Link
          key={c.key}
          href={href(path, params, { [c.key]: null, page: null })}
          className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface-2 py-0.5 pl-2.5 pr-1.5 text-xs text-ink hover:border-crit/50"
          aria-label={`Remove filter: ${typeof c.label === "string" ? c.label : c.key}`}
        >
          {c.label}
          <X aria-hidden className="size-3 text-muted" />
        </Link>
      ))}
      <Link href={href(path, resetParams)} className="text-xs text-link hover:underline">
        Reset all
      </Link>
    </div>
  );
}

/** One-click toggles that set (or clear) a single URL parameter. */
export function QuickFilters({ path, params, items }: { path: string; params: Params; items: Array<{ key: string; value: string; label: string; count?: number }> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick filters">
      {items.map((it) => {
        const active = params[it.key] === it.value;
        return (
          <Link
            key={`${it.key}-${it.value}`}
            href={href(path, params, { [it.key]: active ? null : it.value, page: null })}
            aria-pressed={active}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
              active ? "border-ink bg-ink text-bg" : "border-line-strong text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {it.label}
            {it.count != null ? <span className={`tabular ${active ? "opacity-80" : "text-muted"}`}>{it.count.toLocaleString("en-US")}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}
