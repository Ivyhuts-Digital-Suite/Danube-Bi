import { CalendarClock, CalendarX2, FileText } from "lucide-react";
import Link from "next/link";
import { fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import { href, type Params } from "@/lib/url";
import type { AnalysisScope, ScopeSnapshot } from "@/server/queries/analytics";
import { Badge, InfoTip } from "./ui";

export function snapshotDateText(s: Pick<ScopeSnapshot, "dateKnown" | "snapshotDate">): string {
  return s.dateKnown && s.snapshotDate ? `as of ${fmtDate(s.snapshotDate)}` : "Unknown date";
}

/** Snapshot date, or an explicit unknown-date warning. Never shows the import date in its place. */
export function SnapshotDateBadge({ snapshot }: { snapshot: Pick<ScopeSnapshot, "dateKnown" | "snapshotDate" | "dateEvidence"> }) {
  return snapshot.dateKnown ? (
    <Badge tone="good" icon={CalendarClock} title={snapshot.dateEvidence ? `Printed in the document: “${snapshot.dateEvidence}”` : undefined}>
      Snapshot {fmtDate(snapshot.snapshotDate)}
    </Badge>
  ) : (
    <Badge tone="warn" icon={CalendarX2} title="No date is printed in the document. The import date is never used instead.">
      Snapshot date unknown
    </Badge>
  );
}

export function SourceBadge({ filename, page, sha256 }: { filename: string; page?: number | null; sha256?: string }) {
  return (
    <Badge icon={FileText} title={sha256 ? `SHA-256 ${sha256}` : undefined}>
      {filename}
      {page != null ? ` · p.${page}` : ""}
    </Badge>
  );
}

/** Age of the latest successful import, as a badge with the exact timestamp on hover. */
export function FreshnessBadge({ at, now, label = "Imported" }: { at: Date | null | undefined; now: Date; label?: string }) {
  if (!at) return <Badge tone="warn">{label}: never</Badge>;
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  const age = days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  return (
    <Badge tone={days > 90 ? "warn" : "neutral"} title={fmtDateTime(at)}>
      {label} {age}
    </Badge>
  );
}

/**
 * States which records a page analyses: always one inventory snapshot. Lets the analyst pick
 * another current snapshot when more than one exists.
 */
export function ScopeBar({ scope, path, params = {}, filteredRecords }: { scope: AnalysisScope; path: string; params?: Params; filteredRecords?: number }) {
  const s = scope.current;
  if (!s) return null;
  return (
    <div className="mb-5 flex flex-col gap-2 rounded-panel border border-line bg-surface px-4 py-3 text-xs sm:flex-row sm:flex-wrap sm:items-center">
      <span className="font-semibold uppercase tracking-[0.12em] text-muted">Analysis scope</span>
      <span className="flex flex-wrap items-center gap-2">
        <SourceBadge filename={s.filename} sha256={s.sha256} />
        <SnapshotDateBadge snapshot={s} />
        <span className="tabular text-ink-2">
          {filteredRecords != null && filteredRecords !== s.recordCount ? `${fmtInt(filteredRecords)} of ` : ""}
          {fmtInt(s.recordCount)} accepted records · {fmtInt(s.rejectedCount)} rejected/unplaced lines
        </span>
        <InfoTip label="About the analysis scope">
          Every figure on this page describes one inventory document (snapshot), so a unit listed in two documents is never counted twice.
          {scope.basis === "latest_imported_undated"
            ? " No imported document has a printed date, so the most recently imported one is used by default. Its import time is not a snapshot date."
            : scope.basis === "latest_dated"
              ? " By default the snapshot with the latest printed date is used."
              : ""}{" "}
          Status labels and prices are as printed in that document, not live availability.
        </InfoTip>
      </span>
      {scope.snapshots.length > 1 ? (
        <details className="relative sm:ml-auto">
          <summary className="cursor-pointer text-link hover:underline">Change snapshot ({scope.snapshots.length})</summary>
          <ul className="absolute right-0 z-30 mt-2 w-80 rounded-md border border-line-strong bg-surface-3 p-1 shadow-panel">
            {scope.snapshots.map((o) => (
              <li key={o.id}>
                <Link
                  href={href(path, params, { snapshot: o.id, page: null })}
                  aria-current={o.id === s.id ? "true" : undefined}
                  className={`block rounded px-2 py-1.5 hover:bg-surface-2 ${o.id === s.id ? "text-ink" : "text-ink-2"}`}
                >
                  {o.filename} — {snapshotDateText(o)} <span className="text-muted">· {fmtInt(o.recordCount)} records</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
