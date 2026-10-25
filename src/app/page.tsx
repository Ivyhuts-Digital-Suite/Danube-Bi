import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChartFrame } from "@/components/chart-frame";
import { HBarChart } from "@/components/charts";
import { Card, DataError, EmptyState, Kpi, loadDb, Notice, PageHeader, Skeleton, StatusPill, td, th } from "@/components/ui";
import { fmtAgo, fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import { UNAVAILABLE_METRICS } from "@/lib/metrics";
import { getOverview } from "@/server/queries/overview";

export default function CommandCenter() {
  return (
    <>
      <PageHeader
        title="Executive Command Center"
        description="Summary of what the imported evidence supports. Every figure is computed from stored records; nothing is estimated or filled in."
      />
      <Suspense fallback={<Skeleton rows={4} />}>
        <Overview />
      </Suspense>
    </>
  );
}

function snapshotLabel(s: { snapshotDate?: Date | null; snapshotDateStatus: string }) {
  return s.snapshotDateStatus === "from_document" && s.snapshotDate ? `as of ${fmtDate(s.snapshotDate)}` : "snapshot date unknown";
}

async function Overview() {
  await connection();
  const now = new Date();
  const r = await loadDb(getOverview);
  if (!r.ok) return <DataError error={r.error} />;
  const o = r.data;
  const nothing = o.snapshots.length === 0 && !o.tx && o.projectCount === 0 && o.eventCount === 0;
  const latestDated = o.snapshots.find((s) => s.snapshotDateStatus === "from_document");
  const projectBars = o.byProject.slice(0, 20);
  const psfBars = o.byProject.filter((g) => g.psf.n > 0).sort((a, b) => (b.psf.median ?? 0) - (a.psf.median ?? 0)).slice(0, 20);

  return (
    <div className="space-y-6">
      {nothing ? (
        <EmptyState title="No data has been imported yet">
          Put <code>Merge1.pdf</code> and <code>Merge2.pdf</code> in <code>data/incoming/</code> and import them on{" "}
          <Link className="text-accent underline" href="/sources">Sources &amp; Imports</Link> (or run <code>npm run ingest -- pdf</code>). DLD exports can be added there too.
        </EmptyState>
      ) : null}

      {o.failedRuns.length > 0 ? (
        <Notice tone="crit">
          <strong>Latest import failed for {o.failedRuns.length} source(s):</strong>{" "}
          {o.failedRuns.map((f, i) => (
            <span key={f._id}>
              {i > 0 ? "; " : ""}
              <Link className="underline" href={`/sources/runs/${f.runId}`}>{f._id}</Link> — {f.error ?? f.status}
            </span>
          ))}
        </Notice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi label="Projects identified" value={fmtInt(o.projectCount)} sub="From names found in imported documents" metric="projects_identified" />
        <Kpi
          label="Inventory rows (current snapshots)"
          value={fmtInt(o.totals.rows)}
          sub={`${fmtInt(o.totals.units)} distinct units · ${fmtInt(o.totals.withWarnings)} rows with validation warnings`}
          metric="inventory_observations"
        />
        <Kpi
          label="Units recorded as available"
          value={fmtInt(o.totals.available)}
          sub={o.snapshots.length ? `In the source document, ${latestDated ? snapshotLabel(latestDated) : "snapshot date unknown"} — not proof of current availability` : "No inventory imported"}
          metric="status_available"
          tone={o.snapshots.length && !latestDated ? "warn" : undefined}
        />
        <Kpi
          label="Registered DLD transactions"
          value={o.tx ? fmtInt(o.tx.n) : "—"}
          sub={o.tx ? `${fmtDate(o.tx.min)} – ${fmtDate(o.tx.max)} (imported exports only)` : "No DLD export imported yet"}
          metric="registered_tx_count"
        />
        <Kpi label="Public announcements recorded" value={fmtInt(o.eventCount)} sub="Entered manually with source URL and date" />
        <Kpi
          label="Open data-quality issues"
          value={fmtInt((o.issues.error ?? 0) + (o.issues.warning ?? 0) + (o.issues.info ?? 0))}
          sub={`${fmtInt(o.issues.error ?? 0)} errors · ${fmtInt(o.issues.warning ?? 0)} warnings · ${fmtInt(o.issues.info ?? 0)} for review`}
          tone={(o.issues.error ?? 0) > 0 ? "warn" : undefined}
        />
      </div>

      {o.snapshots.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartFrame
            title="Inventory rows by project"
            metric="inventory_observations"
            period={o.snapshots.map((s) => `${s.sourceDocumentId?.filename ?? "document"} (${snapshotLabel(s)})`).join("; ")}
            source="Inventory PDF rows accepted by extraction"
            table={{ head: ["Project", "Rows", "Distinct units"], rows: o.byProject.map((g) => [g.label, g.rows, g.distinctUnits]) }}
          >
            <HBarChart data={projectBars.map((g) => ({ label: g.label, value: g.rows, n: g.rows }))} valueLabel="inventory rows" ariaLabel="Inventory rows by project, horizontal bar chart" />
          </ChartFrame>
          <ChartFrame
            title="Median listed price per sq ft by project"
            metric="listed_psf_median"
            period="Current inventory snapshots"
            source="Listed prices and sizes printed in the inventory document (not transaction prices)"
            table={{
              head: ["Project", "Median AED/sq ft", "P25", "P75", "n"],
              rows: psfBars.map((g) => [g.label, Math.round(g.psf.median ?? 0), Math.round(g.psf.p25 ?? 0), Math.round(g.psf.p75 ?? 0), g.psf.n]),
            }}
          >
            {psfBars.length ? (
              <HBarChart data={psfBars.map((g) => ({ label: g.label, value: g.psf.median ?? 0, n: g.psf.n }))} fmt="aed" valueLabel="median listed AED per sq ft" ariaLabel="Median listed price per square foot by project" />
            ) : (
              <EmptyState title="No rows with both price and size">Price per sq ft needs a listed price and a positive size on the same row.</EmptyState>
            )}
          </ChartFrame>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Data freshness" subtitle="Last successful import per source; source publication date where known">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Source</th>
                  <th className={th}>Status</th>
                  <th className={th}>Last successful import</th>
                  <th className={th}>Latest source date</th>
                </tr>
              </thead>
              <tbody>
                {o.sources.map((s) => (
                  <tr key={s.key}>
                    <td className={td}>{s.name}</td>
                    <td className={td}><StatusPill status={s.status} /></td>
                    <td className={td}>
                      {s.lastSuccessfulFetchAt ? (
                        <span title={fmtDateTime(s.lastSuccessfulFetchAt)}>{fmtAgo(s.lastSuccessfulFetchAt, now)}</span>
                      ) : (
                        <span className="text-muted">never</span>
                      )}
                    </td>
                    <td className={td}>{s.lastPublishedDate ? fmtDate(s.lastPublishedDate) : <span className="text-muted">unknown</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Recent public announcements" subtitle="Recorded from public sources with URL and publication date" actions={<Link href="/timeline" className="text-xs text-accent underline">All announcements</Link>}>
          {o.events.length === 0 ? (
            <EmptyState title="No announcements recorded">Add them on the Announcements page from Danube&apos;s news page or press coverage.</EmptyState>
          ) : (
            <ul className="space-y-3 text-sm">
              {o.events.map((e) => (
                <li key={String(e._id)}>
                  <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:underline">{e.title}</a>
                  <p className="text-xs text-muted">{e.publisher} · {e.publicationDate ? fmtDate(e.publicationDate) : "publication date not recorded"}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Not available from public research data" subtitle="Shown as unavailable rather than estimated">
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {UNAVAILABLE_METRICS.map((m) => (
            <li key={m.name}>
              <span className="font-medium">{m.name}</span> <span className="text-muted">— requires {m.requires.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
