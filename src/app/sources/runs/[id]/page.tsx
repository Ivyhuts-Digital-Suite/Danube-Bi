import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DataError, EmptyState, KpiCard, link, loadDb, Notice, PageHeader, Panel, Skeleton, StatusPill, td, th } from "@/components/ui";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { rejectionInfo } from "@/server/queries/analytics";
import { getRun } from "@/server/queries/catalog";

export const metadata: Metadata = { title: "Import run" };

export default function RunPage(props: PageProps<"/sources/runs/[id]">) {
  return (
    <Suspense fallback={<Skeleton rows={3} />}>
      <RunDetail params={props.params} />
    </Suspense>
  );
}

async function RunDetail({ params }: { params: PageProps<"/sources/runs/[id]">["params"] }) {
  const { id } = await params;
  const r = await loadDb(() => getRun(id));
  if (!r.ok) return <DataError error={r.error} />;
  if (!r.data) notFound();
  const { run, doc, rejected, rejectedTotal } = r.data;
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Sources & Imports", href: "/sources" },
          { label: "Ingestion History", href: "/sources/runs" },
          { label: fmtDateTime(run.startedAt) },
        ]}
        eyebrow={`Import run · ${run.sourceKey}`}
        title={run.filename ?? "Import run"}
        description={
          <>
            Started {fmtDateTime(run.startedAt)} · finished {fmtDateTime(run.completedAt)} · triggered via {run.trigger}
          </>
        }
        actions={<StatusPill status={run.status} />}
      />
      {run.status === "failed" || run.status === "interrupted" ? (
        <Notice tone="crit" title="This run did not complete">
          {run.errors[0] ?? "No error message was recorded."} Fix the cause and run the import again from{" "}
          <Link className="underline" href="/sources">
            Sources &amp; Imports
          </Link>{" "}
          — already stored records are never duplicated.
        </Notice>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Found" value={fmtInt(run.recordsDiscovered)} sub="Rows, lines or pages read" />
        <KpiCard label="New records" value={fmtInt(run.recordsCreated)} />
        <KpiCard label="Already stored" value={fmtInt(run.recordsSkipped)} sub="Identical records from an earlier run" />
        <KpiCard label="Updated" value={fmtInt(run.recordsUpdated)} />
        <KpiCard label="Rejected / unplaced" value={fmtInt(run.recordsRejected)} tone={run.recordsRejected ? "warn" : undefined} />
      </div>
      {doc ? (
        <Panel title="Document" bodyClassName="p-4 text-sm text-ink-2">
          {doc.filename} · {doc.pageCount ?? "—"} pages · extraction {doc.extractionVersion} ({doc.extractionStatus.replace(/_/g, " ")})
          <span className="mt-1 block break-all font-mono text-xs text-muted">SHA-256 {doc.sha256}</span>
        </Panel>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Errors (${run.errors.length})`}>
          {run.errors.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-crit">
              {run.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">None.</p>
          )}
        </Panel>
        <Panel title={`Warnings (${run.warnings.length})`}>
          {run.warnings.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
              {run.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">None.</p>
          )}
        </Panel>
      </div>
      <Panel
        title={`Rejected and unplaced records for this document (${fmtInt(rejectedTotal)})`}
        subtitle={rejectedTotal > rejected.length ? `Showing the first ${rejected.length}; all are listed on Data Quality` : "Kept for review; nothing is dropped silently"}
        actions={
          <Link className={link} href="/quality?queue=rejected">
            Review on Data Quality →
          </Link>
        }
        bodyClassName="p-0"
      >
        {rejected.length === 0 ? (
          <div className="p-4">
            <EmptyState compact title="No rejected records" />
          </div>
        ) : (
          <div className="scroll-thin max-h-[520px] overflow-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Location</th>
                  <th className={th}>Reason</th>
                  <th className={th}>Original text</th>
                </tr>
              </thead>
              <tbody>
                {rejected.map((x) => (
                  <tr key={String(x._id)}>
                    <td className={`${td} whitespace-nowrap font-mono text-xs`}>{x.locator.replace(/^p(\d+):l(\d+)$/, "page $1, line $2")}</td>
                    <td className={`${td} text-xs`}>
                      {x.reasons.map((reason) => (
                        <span key={reason} className="block" title={rejectionInfo(reason).explanation}>
                          {rejectionInfo(reason).label}
                        </span>
                      ))}
                    </td>
                    <td className={`${td} break-all font-mono text-xs text-ink-2`}>{String((x.raw as Record<string, unknown> | null)?._line ?? JSON.stringify(x.raw)).slice(0, 300)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
