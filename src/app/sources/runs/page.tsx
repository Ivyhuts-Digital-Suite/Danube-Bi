import { History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DataError, EmptyState, link, loadDb, PageHeader, Pagination, Skeleton, StatusPill, td, tdNum, th } from "@/components/ui";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { flatParams, href } from "@/lib/url";
import { IngestionRun, RUN_STATUSES } from "@/server/models";

export const metadata: Metadata = { title: "Ingestion History" };

export default function RunsPage(props: PageProps<"/sources/runs">) {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Sources & Imports", href: "/sources" }, { label: "Ingestion History" }]}
        eyebrow="Data management"
        title="Ingestion History"
        description="Every import attempt with its trigger, duration, outcome and counts. Select a run for its errors, warnings and rejected records."
      />
      <Suspense fallback={<Skeleton rows={2} />}>
        <Runs searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

const PAGE_SIZE = 25;

function duration(a: Date, b?: Date | null) {
  if (!b) return "—";
  const s = Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function Runs({ searchParams }: { searchParams: PageProps<"/sources/runs">["searchParams"] }) {
  const sp = flatParams(await searchParams);
  const status = (RUN_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const source = sp.source?.slice(0, 60);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const r = await loadDb(async () => {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (source) filter.sourceKey = source;
    const [runs, total, sources, byStatus] = await Promise.all([
      IngestionRun.find(filter).sort({ startedAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
      IngestionRun.countDocuments(filter),
      IngestionRun.distinct("sourceKey"),
      IngestionRun.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    ]);
    return { runs, total, sources: (sources as string[]).sort(), byStatus };
  });
  if (!r.ok) return <DataError error={r.error} />;
  const { runs, total, sources, byStatus } = r.data;
  const params = { status, source };
  const pill = (active: boolean) => `rounded-full border px-3 py-1 text-xs ${active ? "border-ink bg-ink text-bg" : "border-line-strong text-ink-2 hover:bg-surface-2"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href("/sources/runs", { source })} className={pill(!status)}>
          All statuses
        </Link>
        {byStatus.map((s) => (
          <Link key={s._id} href={href("/sources/runs", { source, status: s._id })} className={pill(status === s._id)}>
            {s._id.replace(/_/g, " ")} <span className="tabular opacity-70">{s.n}</span>
          </Link>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <Link href={href("/sources/runs", { status })} className={pill(!source)}>
          All sources
        </Link>
        {sources.map((s) => (
          <Link key={s} href={href("/sources/runs", { status, source: s })} className={pill(source === s)}>
            {s}
          </Link>
        ))}
      </div>
      {runs.length === 0 ? (
        <EmptyState icon={History} title="No import runs match" />
      ) : (
        <div className="scroll-thin overflow-x-auto rounded-panel border border-line bg-surface shadow-panel">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={th}>Started</th>
                <th className={th}>Source</th>
                <th className={th}>File</th>
                <th className={th}>Trigger</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Duration</th>
                <th className={`${th} text-right`}>Found</th>
                <th className={`${th} text-right`}>New</th>
                <th className={`${th} text-right`}>Already stored</th>
                <th className={`${th} text-right`}>Rejected</th>
                <th className={`${th} text-right`}>Warnings</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={String(run._id)} className="hover:bg-surface-2">
                  <td className={`${td} whitespace-nowrap`}>
                    <Link className={link} href={`/sources/runs/${run._id}`}>
                      {fmtDateTime(run.startedAt)}
                    </Link>
                  </td>
                  <td className={td}>{run.sourceKey}</td>
                  <td className={`${td} text-ink-2`}>{run.filename ?? "—"}</td>
                  <td className={`${td} text-ink-2`}>{run.trigger}</td>
                  <td className={td}>
                    <StatusPill status={run.status} />
                    {run.errors[0] ? <span className="mt-0.5 block max-w-72 truncate text-xs text-crit">{run.errors[0]}</span> : null}
                  </td>
                  <td className={tdNum}>{duration(run.startedAt, run.completedAt)}</td>
                  <td className={tdNum}>{fmtInt(run.recordsDiscovered)}</td>
                  <td className={tdNum}>{fmtInt(run.recordsCreated)}</td>
                  <td className={tdNum}>{fmtInt(run.recordsSkipped)}</td>
                  <td className={tdNum}>{fmtInt(run.recordsRejected)}</td>
                  <td className={tdNum}>{fmtInt(run.warnings.length)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} href={(p) => href("/sources/runs", params, { page: p })} />
    </div>
  );
}
