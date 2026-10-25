import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ChartFrame } from "@/components/chart-frame";
import { HBarChart } from "@/components/charts";
import { btnPrimary, Card, DataError, EmptyState, input, loadDb, Notice, PageHeader, Skeleton, td, tdNum, th } from "@/components/ui";
import { fmtAED, fmtDate, fmtInt, fmtNum1 } from "@/lib/format";
import { currentSnapshots } from "@/server/queries/common";
import { groupStats, type GroupStats } from "@/server/queries/inventory";

export const metadata: Metadata = { title: "Pricing Intelligence" };

export default function PricingPage(props: PageProps<"/pricing">) {
  return (
    <>
      <PageHeader
        title="Pricing Intelligence"
        description="Listed (asking) prices from inventory documents, compared by project, typology and unit type. Sample sizes are shown for every figure; small samples are not reliable comparisons."
      />
      <Suspense fallback={<Skeleton rows={5} />}>
        <Pricing searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

const SMALL_SAMPLE = 5;

function StatsTable({ title, subtitle, groups }: { title: string; subtitle: string; groups: GroupStats[] }) {
  return (
    <Card title={title} subtitle={subtitle}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>Group</th>
              <th className={`${th} text-right`}>Rows</th>
              <th className={`${th} text-right`}>n priced</th>
              <th className={`${th} text-right`}>Median price</th>
              <th className={`${th} text-right`}>Min – max price</th>
              <th className={`${th} text-right`}>n AED/sq ft</th>
              <th className={`${th} text-right`}>P25 AED/sq ft</th>
              <th className={`${th} text-right`}>Median AED/sq ft</th>
              <th className={`${th} text-right`}>P75 AED/sq ft</th>
              <th className={`${th} text-right`}>Median size (sq ft)</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className={g.psf.n < SMALL_SAMPLE ? "text-ink-2" : ""}>
                <td className={td}>
                  {g.label}
                  {g.psf.n < SMALL_SAMPLE ? <span className="ml-1 text-xs text-warn">small sample</span> : null}
                </td>
                <td className={tdNum}>{fmtInt(g.rows)}</td>
                <td className={tdNum}>{fmtInt(g.price.n)}</td>
                <td className={tdNum}>{fmtAED(g.price.median)}</td>
                <td className={tdNum}>{g.price.n ? `${fmtAED(g.price.min)} – ${fmtInt(g.price.max)}` : "—"}</td>
                <td className={tdNum}>{fmtInt(g.psf.n)}</td>
                <td className={tdNum}>{fmtNum1(g.psf.p25)}</td>
                <td className={tdNum}>{fmtNum1(g.psf.median)}</td>
                <td className={tdNum}>{fmtNum1(g.psf.p75)}</td>
                <td className={tdNum}>{fmtNum1(g.area.median)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function Pricing({ searchParams }: { searchParams: PageProps<"/pricing">["searchParams"] }) {
  const sp = await searchParams;
  const snapshot = typeof sp.snapshot === "string" ? sp.snapshot : undefined;
  const status = typeof sp.status === "string" && ["available", "sold", "reserved", "other"].includes(sp.status) ? sp.status : undefined;
  const r = await loadDb(async () => {
    const [snapshots, byProject, byTypology, byUnitType] = await Promise.all([
      currentSnapshots(),
      groupStats("project", { snapshot, status }),
      groupStats("typology", { snapshot, status }),
      groupStats("unitType", { snapshot, status }),
    ]);
    return { snapshots, byProject, byTypology, byUnitType };
  });
  if (!r.ok) return <DataError error={r.error} />;
  const { snapshots, byProject, byTypology, byUnitType } = r.data;
  if (snapshots.length === 0) {
    return (
      <EmptyState title="No inventory has been imported">
        Pricing analysis needs an inventory document. Import <code>Merge2.pdf</code> on <Link className="text-accent underline" href="/sources">Sources &amp; Imports</Link>.
      </EmptyState>
    );
  }
  const chosen = snapshots.find((s) => String(s._id) === snapshot);
  const period = chosen
    ? `${chosen.sourceDocumentId?.filename} (${chosen.snapshotDateStatus === "from_document" ? fmtDate(chosen.snapshotDate) : "date unknown"})`
    : `All current snapshots (${snapshots.length})`;
  const psf = byProject.filter((g) => g.psf.n > 0).sort((a, b) => (b.psf.median ?? 0) - (a.psf.median ?? 0));

  return (
    <div className="space-y-6">
      <Form action="/pricing" className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3">
        <label className="text-xs text-ink-2">
          Snapshot
          <select name="snapshot" defaultValue={snapshot ?? ""} className={`${input} mt-1 block`}>
            <option value="">All current snapshots</option>
            {snapshots.map((s) => (
              <option key={String(s._id)} value={String(s._id)}>
                {s.sourceDocumentId?.filename} — {s.snapshotDateStatus === "from_document" ? fmtDate(s.snapshotDate) : "date unknown"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-2">
          Status in document
          <select name="status" defaultValue={status ?? ""} className={`${input} mt-1 block`}>
            <option value="">Any</option>
            <option value="available">Available</option>
            <option value="reserved">Reserved / booked</option>
            <option value="sold">Sold</option>
          </select>
        </label>
        <button className={btnPrimary} type="submit">Apply</button>
      </Form>

      {snapshots.length > 1 && !snapshot ? (
        <Notice tone="warn">Several snapshots are combined. Pick one snapshot to compare prices at a single point in time.</Notice>
      ) : null}

      {psf.length ? (
        <ChartFrame
          title="Median listed price per sq ft by project"
          metric="listed_psf_median"
          period={`${period}${status ? ` · status: ${status}` : ""}`}
          source="Listed prices and sizes in inventory documents"
          table={{ head: ["Project", "Median AED/sq ft", "n"], rows: psf.map((g) => [g.label, Math.round(g.psf.median ?? 0), g.psf.n]) }}
        >
          <HBarChart data={psf.slice(0, 25).map((g) => ({ label: g.label, value: g.psf.median ?? 0, n: g.psf.n }))} fmt="aed" valueLabel="median listed AED per sq ft" ariaLabel="Median listed price per square foot by project" />
        </ChartFrame>
      ) : (
        <EmptyState title="No rows have both a listed price and a size" />
      )}

      <StatsTable title="By project" subtitle={period} groups={byProject} />
      <StatsTable title="By typology" subtitle={`${period} · typology as written in the document`} groups={byTypology} />
      <StatsTable title="By unit type" subtitle={`${period} · unit type as written in the document`} groups={byUnitType} />
    </div>
  );
}
