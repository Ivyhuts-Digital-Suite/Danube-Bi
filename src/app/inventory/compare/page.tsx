import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, DataError, Kpi, loadDb, Notice, PageHeader, Skeleton, td, th } from "@/components/ui";
import { fmtAED, fmtDate, fmtInt } from "@/lib/format";
import { compareSnapshots } from "@/server/queries/inventory";

export const metadata: Metadata = { title: "Compare snapshots" };

export default function ComparePage(props: PageProps<"/inventory/compare">) {
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Inventory Explorer", href: "/inventory" }, { label: "Compare snapshots" }]} eyebrow="Portfolio" title="Compare inventory snapshots" description="Units are matched by project and normalized unit number. Only documents with a printed snapshot date can be compared." />
      <Suspense fallback={<Skeleton />}>
        <Comparison searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Comparison({ searchParams }: { searchParams: PageProps<"/inventory/compare">["searchParams"] }) {
  const sp = await searchParams;
  const a = typeof sp.a === "string" ? sp.a : "";
  const b = typeof sp.b === "string" ? sp.b : "";
  const r = await loadDb(() => compareSnapshots(a, b));
  if (!r.ok) return <DataError error={r.error} />;
  const c = r.data;
  if (!c) return <Notice tone="warn">Choose two different snapshots from the <Link className="underline" href="/inventory">Inventory Explorer</Link>.</Notice>;
  if (!c.comparable) return <Notice tone="warn">{c.reason}</Notice>;
  const fmt = (field: string, v: unknown) => (field === "listed price" ? fmtAED(v as number | null) : String(v ?? "—"));
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">
        Older: {fmtDate(c.older.snapshotDate)} → Newer: {fmtDate(c.newer.snapshotDate)}. A unit missing from the newer document is not evidence of a sale; it may have been withdrawn or omitted.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Units in both" value={fmtInt(c.inBoth)} />
        <Kpi label="Only in older" value={fmtInt(c.onlyOld)} />
        <Kpi label="Only in newer" value={fmtInt(c.onlyNew)} />
        <Kpi label="Listed price changed" value={fmtInt(c.priceChanged)} />
        <Kpi label="Recorded status changed" value={fmtInt(c.statusChanged)} />
      </div>
      <Card title="Changes" subtitle={c.changes.length >= 200 ? "First 200 changes" : undefined}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>Unit</th>
              <th className={th}>Field</th>
              <th className={th}>Older</th>
              <th className={th}>Newer</th>
            </tr>
          </thead>
          <tbody>
            {c.changes.map((ch, i) => (
              <tr key={i}>
                <td className={td}>{ch.unitNumber}</td>
                <td className={td}>{ch.field}</td>
                <td className={td}>{fmt(ch.field, ch.from)}</td>
                <td className={td}>{fmt(ch.field, ch.to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
