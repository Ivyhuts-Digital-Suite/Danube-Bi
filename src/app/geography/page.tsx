import { MapPin, MapPinned, MapPinOff } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { GeoWorkspace } from "@/components/geo-workspace";
import { DataError, KpiCard, loadDb, Notice, PageHeader, Skeleton } from "@/components/ui";
import { fmtInt } from "@/lib/format";
import { getGeography } from "@/server/queries/geography";

export const metadata: Metadata = { title: "Geographic Intelligence" };

export default function GeographyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Geographic Intelligence"
        description="Where projects are, using only positions recorded by an analyst with their source. Marker size reflects accepted unit records; select a marker or a list entry for the project summary."
      />
      <Suspense fallback={<Skeleton rows={2} />}>
        <Geography />
      </Suspense>
    </>
  );
}

async function Geography() {
  const r = await loadDb(getGeography);
  if (!r.ok) return <DataError error={r.error} />;
  const { items } = r.data;
  const verified = items.filter((p) => p.geo?.precision === "verified").length;
  const approximate = items.filter((p) => p.geo?.precision === "approximate").length;
  const withInventory = items.filter((p) => p.units > 0);
  const unlocatedWithInventory = withInventory.filter((p) => !p.geo);
  const unitsLocated = withInventory.filter((p) => p.geo).reduce((s, p) => s + p.units, 0);
  const unitsTotal = withInventory.reduce((s, p) => s + p.units, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={MapPinned} label="Verified positions" value={fmtInt(verified)} sub="Building-level, checked against a named source" metric="location_coverage" />
        <KpiCard icon={MapPin} label="Approximate positions" value={fmtInt(approximate)} sub="Community or district level" metric="location_coverage" />
        <KpiCard
          icon={MapPinOff}
          label="Projects without a position"
          value={fmtInt(items.length - verified - approximate)}
          sub={`${fmtInt(unlocatedWithInventory.length)} of them have inventory records`}
          tone={unlocatedWithInventory.length ? "warn" : undefined}
        />
        <KpiCard label="Records on the map" value={unitsTotal ? `${Math.round((unitsLocated / unitsTotal) * 100)}%` : "—"} sub={`${fmtInt(unitsLocated)} of ${fmtInt(unitsTotal)} accepted records belong to a positioned project`} />
      </div>
      <Notice title="How locations are resolved">
        The supplied PDFs contain no coordinates, and only {fmtInt(items.filter((p) => p.hints.length).length)} project(s) have a brochure location statement (text such as a community name). To place a project, open
        it and record the position with its source and precision. Every change is kept in the project&apos;s location history. Map tiles © OpenStreetMap contributors are loaded from openstreetmap.org by your
        browser.
      </Notice>
      <GeoWorkspace items={items} />
    </div>
  );
}
