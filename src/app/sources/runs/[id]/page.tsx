import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card, DataError, EmptyState, Kpi, loadDb, PageHeader, Skeleton, StatusPill, td, th } from "@/components/ui";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { getRun } from "@/server/queries/catalog";

export const metadata: Metadata = { title: "Import run" };

export default function RunPage(props: PageProps<"/sources/runs/[id]">) {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
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
        title={`Import run · ${run.sourceKey}`}
        description={
          <>
            {run.filename ?? "no file"} · started {fmtDateTime(run.startedAt)} · finished {fmtDateTime(run.completedAt)} · via {run.trigger} ·{" "}
            <Link className="text-accent underline" href="/sources">All sources</Link>
          </>
        }
        actions={<StatusPill status={run.status} />}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Discovered" value={fmtInt(run.recordsDiscovered)} />
        <Kpi label="New records" value={fmtInt(run.recordsCreated)} />
        <Kpi label="Already stored" value={fmtInt(run.recordsSkipped)} />
        <Kpi label="Updated" value={fmtInt(run.recordsUpdated)} />
        <Kpi label="Rejected / unplaced" value={fmtInt(run.recordsRejected)} />
      </div>
      {doc ? (
        <p className="text-sm text-ink-2">
          Document: {doc.filename} · SHA-256 <span className="font-mono text-xs">{doc.sha256}</span> · {doc.pageCount ?? "—"} pages · extraction {doc.extractionVersion} ({doc.extractionStatus.replace(/_/g, " ")})
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={`Errors (${run.errors.length})`}>
          {run.errors.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-crit">{run.errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : <p className="text-sm text-muted">None.</p>}
        </Card>
        <Card title={`Warnings (${run.warnings.length})`}>
          {run.warnings.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{run.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : <p className="text-sm text-muted">None.</p>}
        </Card>
      </div>
      <Card title={`Rejected records for this document (${fmtInt(rejectedTotal)})`} subtitle="Kept for review; nothing is dropped silently. Fix the source or extraction and re-run — accepted records are not duplicated.">
        {rejected.length === 0 ? (
          <EmptyState title="No rejected records" />
        ) : (
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Location</th>
                  <th className={th}>Reasons</th>
                  <th className={th}>Raw values</th>
                </tr>
              </thead>
              <tbody>
                {rejected.map((x) => (
                  <tr key={String(x._id)}>
                    <td className={`${td} whitespace-nowrap font-mono text-xs`}>{x.locator}</td>
                    <td className={`${td} text-xs`}>{x.reasons.join(", ")}</td>
                    <td className={`${td} font-mono text-xs break-all`}>{JSON.stringify(x.raw).slice(0, 400)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
