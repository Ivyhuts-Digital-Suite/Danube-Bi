import { CalendarX2, Scale, Upload } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { Histogram, PriceSizeScatter } from "@/components/charts";
import { FilterChips, type Chip } from "@/components/filters";
import { ScopeBar } from "@/components/scope";
import { btn, btnPrimary, DataError, EmptyState, input, KpiCard, label, link, loadDb, Notice, PageHeader, Panel, SectionHeading, Skeleton, td, tdNum, th } from "@/components/ui";
import { ChartPanel, RangeList, type RangeItem } from "@/components/viz";
import { fmtAED, fmtAEDCompact, fmtDate, fmtInt, fmtPct } from "@/lib/format";
import {
  bandFor,
  COMPARISON_MIN_SAMPLE,
  computeInventoryAnalytics,
  dedupeUnits,
  OUTLIER_K,
  OUTLIER_MIN_SAMPLE,
  rowPsf,
  SIZE_BANDS,
  validPositive,
  type GroupSummary,
} from "@/lib/inventory-analytics";
import { flatParams, href } from "@/lib/url";
import { scopedAnalytics } from "@/server/queries/analytics";
import { unitFacets } from "@/server/queries/inventory";

export const metadata: Metadata = { title: "Pricing Intelligence" };

export default function PricingPage(props: PageProps<"/pricing">) {
  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Pricing Intelligence"
        description="Listed (asking) prices and AED per sq ft from the inventory document, by project, typology, unit type and size. Every figure states its sample. Listed prices are not transaction prices, and nothing here infers appreciation or depreciation."
      />
      <Suspense fallback={<Skeleton rows={4} />}>
        <Pricing searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

const STATUSES = ["available", "sold", "reserved", "other", "missing"] as const;

function ranges(groups: GroupSummary[], min = 3): RangeItem[] {
  return groups
    .filter((g) => g.psf.n >= min && g.psf.min != null)
    .sort((a, b) => (b.psf.median ?? 0) - (a.psf.median ?? 0))
    .map((g) => ({ key: g.key, label: g.label, n: g.psf.n, min: g.psf.min!, p25: g.psf.p25!, median: g.psf.median!, p75: g.psf.p75!, max: g.psf.max!, small: g.psf.n < COMPARISON_MIN_SAMPLE }));
}

function rangeTable(items: RangeItem[]) {
  return { head: ["Group", "n", "Min", "P25", "Median", "P75", "Max"], rows: items.map((g) => [g.label, g.n, Math.round(g.min), Math.round(g.p25), Math.round(g.median), Math.round(g.p75), Math.round(g.max)]) };
}

async function Pricing({ searchParams }: { searchParams: PageProps<"/pricing">["searchParams"] }) {
  const sp = flatParams(await searchParams);
  const filter = {
    snapshot: sp.snapshot,
    project: sp.project?.slice(0, 40),
    typology: sp.typology?.slice(0, 100),
    status: STATUSES.find((s) => s === sp.status),
    warnings: "any" as const,
  };
  const sizeBand = SIZE_BANDS.find((b) => b[2] === sp.size)?.[2];
  const r = await loadDb(async () => {
    const scoped = await scopedAnalytics(filter);
    const facets = scoped.scope.current ? await unitFacets([scoped.scope.current.oid]) : null;
    // Comparison across snapshots only when at least two carry a printed date.
    const dated = scoped.scope.snapshots.filter((s) => s.dateKnown);
    const bySnapshot =
      dated.length >= 2
        ? await Promise.all(dated.map(async (s) => ({ s, a: (await scopedAnalytics({ ...filter, snapshot: s.id })).analytics })))
        : [];
    return { scoped, facets, bySnapshot };
  });
  if (!r.ok) return <DataError error={r.error} />;
  const { scoped, facets, bySnapshot } = r.data;
  const scope = scoped.scope.current;
  if (!scope || !facets) {
    return (
      <EmptyState icon={Upload} title="No inventory has been imported" action={<Link className={btn} href="/sources">Open Sources &amp; Imports</Link>}>
        Pricing analysis needs an inventory document such as <code>Merge2.pdf</code>.
      </EmptyState>
    );
  }
  const rows = sizeBand ? scoped.rows.filter((x) => validPositive(x.areaSqFt) && bandFor(x.areaSqFt, SIZE_BANDS) === sizeBand) : scoped.rows;
  const a = sizeBand ? computeInventoryAnalytics(rows) : scoped.analytics;
  const params = { snapshot: sp.snapshot, project: filter.project, typology: filter.typology, status: filter.status, size: sizeBand };
  const projectName = (id?: string) => facets.projects.find((p) => p.id === id)?.name ?? (id === "none" ? "No project recorded" : "Unknown project");

  const chips: Chip[] = [];
  if (filter.project) chips.push({ key: "project", label: `Project: ${projectName(filter.project)}` });
  if (filter.typology) chips.push({ key: "typology", label: `Typology: ${filter.typology}` });
  if (filter.status) chips.push({ key: "status", label: `Status: ${filter.status}` });
  if (sizeBand) chips.push({ key: "size", label: `Size: ${sizeBand} sq ft` });

  const analysisSet = dedupeUnits(rows).analysisSet;
  const outlierIds = new Set(a.psfOutliers.ids);
  const scatter = analysisSet.flatMap((x) => {
    const psf = rowPsf(x);
    return psf == null ? [] : [{ id: x.id, x: x.areaSqFt!, y: x.listedPriceAED!, label: `${x.unitNumber ?? "Unit"} · ${x.projectName ?? "No project"}`, outlier: outlierIds.has(x.id) }];
  });
  const outlierRows = analysisSet.filter((x) => outlierIds.has(x.id)).sort((x, y) => (rowPsf(y) ?? 0) - (rowPsf(x) ?? 0));
  const projRanges = ranges(a.projects);
  const typRanges = ranges(a.typologies);
  const sizeRanges = ranges(a.sizeBandGroups, 2).sort((x, y) => SIZE_BANDS.findIndex((b) => b[2] === x.key) - SIZE_BANDS.findIndex((b) => b[2] === y.key));
  const priceCoverage = a.records ? a.coverage.withPrice / a.records : null;
  const psfCoverage = a.records ? a.coverage.withPsf / a.records : null;

  return (
    <div className="space-y-6">
      <ScopeBar scope={scoped.scope} path="/pricing" params={params} filteredRecords={a.records} />

      <section aria-label="Filters" className="space-y-3 rounded-panel border border-line bg-surface p-4 shadow-panel">
        <Form action="/pricing" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          {sp.snapshot ? <input type="hidden" name="snapshot" value={sp.snapshot} /> : null}
          <label className={label}>
            Project
            <select name="project" defaultValue={filter.project ?? ""} className={`${input} w-full normal-case tracking-normal`}>
              <option value="">All projects</option>
              {facets.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Typology
            <select name="typology" defaultValue={filter.typology ?? ""} className={`${input} w-full normal-case tracking-normal`}>
              <option value="">All typologies</option>
              {facets.typologies.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Size band (sq ft)
            <select name="size" defaultValue={sizeBand ?? ""} className={`${input} w-full normal-case tracking-normal`}>
              <option value="">All sizes</option>
              {SIZE_BANDS.map((b) => (
                <option key={b[2]} value={b[2]}>
                  {b[2]}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Status in document
            <select name="status" defaultValue={filter.status ?? ""} className={`${input} w-full normal-case tracking-normal`}>
              <option value="">Any status</option>
              <option value="available">Available</option>
              <option value="sold">Sold</option>
              <option value="reserved">Reserved</option>
              <option value="other">Unrecognized label</option>
              <option value="missing">No status</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className={btnPrimary}>
              Apply
            </button>
            <Link href={href("/pricing", { snapshot: sp.snapshot })} className={btn}>
              Reset
            </Link>
          </div>
        </Form>
        <FilterChips path="/pricing" params={params} chips={chips} resetParams={{ snapshot: sp.snapshot }} />
      </section>

      {a.price.n === 0 ? (
        <EmptyState icon={Scale} title="No priced units match these filters">
          {fmtInt(a.records)} record(s) match, but none has a valid listed price.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Median listed price" value={fmtAEDCompact(a.price.median)} sub={`Mean ${fmtAEDCompact(a.price.mean)} · mean above median signals a long upper tail`} source={`n = ${fmtInt(a.price.n)} priced units`} metric="listed_price_median" />
            <KpiCard label="Listed price quartiles" value={`${fmtAEDCompact(a.price.p25).replace("AED ", "")} – ${fmtAEDCompact(a.price.p75).replace("AED ", "")}`} sub={`Range ${fmtAEDCompact(a.price.min)} – ${fmtAEDCompact(a.price.max)}`} source="25th–75th percentile, AED" info="Exact quartiles (linear interpolation, as Excel PERCENTILE.INC) over the analysis set." />
            <KpiCard label="Median AED / sq ft" value={a.psf.median != null ? fmtInt(a.psf.median) : "—"} sub={`Mean ${fmtInt(a.psf.mean)} · IQR ${fmtInt(a.psf.p25)} – ${fmtInt(a.psf.p75)}`} source={`n = ${fmtInt(a.psf.n)} units with price and size`} metric="listed_psf_median" />
            <KpiCard
              label="Sample coverage"
              value={fmtPct(priceCoverage)}
              sub={`of ${fmtInt(a.records)} matching records have a valid price; ${fmtPct(psfCoverage)} have price and size`}
              source={`Excluded: ${fmtInt(a.records - a.coverage.withPrice)} without price · ${fmtInt(a.dedup.duplicateRowsCollapsed)} duplicate rows · ${fmtInt(a.dedup.conflictingUnits)} conflicting units`}
              info="Records without a valid value are excluded from each statistic and counted here; nothing is imputed."
              tone={priceCoverage != null && priceCoverage < 0.8 ? "warn" : undefined}
            />
          </div>

          {!filter.project && !filter.typology && !sizeBand ? (
            <Notice title="Compare like with like">
              Projects mix studios, offices, apartments and villas, so a project&apos;s median mostly reflects its unit mix. Filter by typology or size band before comparing projects.
            </Notice>
          ) : null}

          <SectionHeading>Distributions</SectionHeading>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartPanel title="Listed price distribution" metric="listed_price_median" subtitle={`${fmtInt(a.price.n)} priced units in AED bands`} table={{ head: ["Band (AED)", "Units"], rows: a.priceBands.map((b) => [b.label, b.count]) }}>
              <Histogram data={a.priceBands.map((b) => ({ label: b.label, count: b.count }))} xLabel="Listed price (AED)" ariaLabel="Listed price distribution" />
            </ChartPanel>
            <ChartPanel title="AED / sq ft distribution" metric="listed_psf_median" subtitle={`${fmtInt(a.psf.n)} units · equal-width bins`} table={{ head: ["AED / sq ft", "Units"], rows: a.psfHistogram.map((b) => [b.label, b.count]) }}>
              <Histogram data={a.psfHistogram.map((b) => ({ label: b.label, count: b.count }))} xLabel="Listed AED per sq ft" ariaLabel="AED per square foot distribution" />
            </ChartPanel>
          </div>

          <ChartPanel
            title="Listed price against size"
            metric="listed_psf_median"
            subtitle={`${fmtInt(scatter.length)} units with price and size · AED/sq ft outliers highlighted`}
            table={{ head: ["Unit", "Size (sq ft)", "Listed price (AED)", "AED/sq ft", "Outlier"], rows: scatter.slice(0, 2000).map((d) => [d.label, Math.round(d.x), Math.round(d.y), Math.round(d.y / d.x), d.outlier ? "yes" : ""]) }}
            summary="Scatter of listed price versus size; points far from the main band are AED per square foot outliers."
          >
            <PriceSizeScatter data={scatter} ariaLabel="Scatter plot of listed price versus unit size" />
            <p className="mt-2 flex flex-wrap gap-4 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-full bg-series-1 opacity-60" /> Unit
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-full bg-series-2 ring-2 ring-surface" /> AED/sq ft outlier ({fmtInt(outlierRows.length)})
              </span>
            </p>
          </ChartPanel>

          <SectionHeading description={`Groups with fewer than ${COMPARISON_MIN_SAMPLE} units are shown greyed as small samples`}>Comparisons (AED / sq ft)</SectionHeading>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartPanel title="By project" metric="listed_psf_median" subtitle="Projects with ≥ 3 units" table={rangeTable(projRanges)}>
              <RangeList items={projRanges.map((g) => ({ ...g, href: href("/pricing", params, { project: g.key }) }))} ariaLabel="AED per sq ft by project" unitLabel="units" />
            </ChartPanel>
            <ChartPanel title="By typology" metric="listed_psf_median" subtitle="Typology as printed · ≥ 3 units" table={rangeTable(typRanges)}>
              <RangeList items={typRanges.slice(0, 14).map((g) => ({ ...g, href: href("/pricing", params, { typology: g.key }) }))} ariaLabel="AED per sq ft by typology" unitLabel="units" />
            </ChartPanel>
            <ChartPanel title="By size band" metric="listed_psf_median" subtitle="sq ft bands · ≥ 2 units" table={rangeTable(sizeRanges)}>
              <RangeList items={sizeRanges.map((g) => ({ ...g, href: href("/pricing", params, { size: g.key }) }))} ariaLabel="AED per sq ft by size band" unitLabel="units" />
            </ChartPanel>
            <Panel title="By unit type" subtitle="Unit type as printed · top 15 by records" bodyClassName="p-0">
              <div className="scroll-thin max-h-[420px] overflow-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>Unit type</th>
                      <th className={`${th} text-right`}>n priced</th>
                      <th className={`${th} text-right`}>Median price</th>
                      <th className={`${th} text-right`}>Median AED/sq ft</th>
                      <th className={`${th} text-right`}>Median size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.unitTypes.slice(0, 15).map((g) => (
                      <tr key={g.key} className={g.price.n < COMPARISON_MIN_SAMPLE ? "text-ink-2" : ""}>
                        <td className={td}>
                          <span className="block max-w-[16rem] truncate" title={g.label}>
                            {g.label}
                          </span>
                        </td>
                        <td className={tdNum}>{fmtInt(g.price.n)}</td>
                        <td className={tdNum}>{fmtAED(g.price.median)}</td>
                        <td className={tdNum}>{g.psf.median != null ? fmtInt(g.psf.median) : "—"}</td>
                        <td className={tdNum}>{g.area.median != null ? fmtInt(g.area.median) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <SectionHeading>Outlier review</SectionHeading>
          <Panel
            title="AED / sq ft outliers"
            subtitle={
              a.psfOutliers.lower != null
                ? `Tukey fences: below Q1 − ${OUTLIER_K}×IQR (${fmtInt(a.psfOutliers.lower)}) or above Q3 + ${OUTLIER_K}×IQR (${fmtInt(a.psfOutliers.upper)}) AED/sq ft, over the ${fmtInt(a.psfOutliers.n)} units in this selection`
                : `Needs at least ${OUTLIER_MIN_SAMPLE} units with price and size (this selection has ${fmtInt(a.psfOutliers.n)}).`
            }
            footer="An outlier is a value to check against the source page — often a premium unit (sky villa, penthouse, retail) or an extraction error — not a pricing mistake by itself. The criteria depend on the current filters."
            bodyClassName="p-0"
          >
            {outlierRows.length === 0 ? (
              <p className="p-4 text-sm text-muted">No outliers under these criteria.</p>
            ) : (
              <div className="scroll-thin max-h-[420px] overflow-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>Unit</th>
                      <th className={th}>Project</th>
                      <th className={th}>Typology</th>
                      <th className={`${th} text-right`}>Size (sq ft)</th>
                      <th className={`${th} text-right`}>Listed price</th>
                      <th className={`${th} text-right`}>AED / sq ft</th>
                      <th className={th}>Side</th>
                      <th className={th}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outlierRows.map((x) => {
                      const psf = rowPsf(x)!;
                      return (
                        <tr key={x.id} className="hover:bg-surface-2">
                          <td className={td}>
                            <Link className={link} href={`/inventory/${x.id}`}>
                              {x.unitNumber}
                            </Link>
                          </td>
                          <td className={`${td} text-ink-2`}>{x.projectName ?? "—"}</td>
                          <td className={`${td} text-ink-2`}>{x.typology ?? "—"}</td>
                          <td className={tdNum}>{fmtInt(x.areaSqFt)}</td>
                          <td className={tdNum}>{fmtAED(x.listedPriceAED)}</td>
                          <td className={tdNum}>{fmtInt(psf)}</td>
                          <td className={td}>{psf > (a.psfOutliers.upper ?? Infinity) ? "High" : "Low"}</td>
                          <td className={`${td} text-xs text-muted`}>
                            {scope.filename} p.{x.sourcePage}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <SectionHeading>Snapshot comparison</SectionHeading>
          {bySnapshot.length >= 2 ? (
            <Panel title="Medians by dated snapshot" subtitle="Same filters applied to each dated snapshot" footer="A change in median can come from a different unit mix (units added, withdrawn or sold) rather than repricing. Compare individual units on the snapshot comparison page." bodyClassName="p-0">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>Snapshot</th>
                    <th className={`${th} text-right`}>Priced units</th>
                    <th className={`${th} text-right`}>Median listed price</th>
                    <th className={`${th} text-right`}>Median AED/sq ft</th>
                  </tr>
                </thead>
                <tbody>
                  {bySnapshot.map(({ s, a: x }) => (
                    <tr key={s.id}>
                      <td className={td}>
                        {s.filename} · {fmtDate(s.snapshotDate)}
                      </td>
                      <td className={tdNum}>{fmtInt(x.price.n)}</td>
                      <td className={tdNum}>{fmtAED(x.price.median)}</td>
                      <td className={tdNum}>{x.psf.median != null ? fmtInt(x.psf.median) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-3">
                <Link className={link} href={`/inventory/compare?a=${bySnapshot[1].s.id}&b=${bySnapshot[0].s.id}`}>
                  Compare units between the two latest dated snapshots →
                </Link>
              </div>
            </Panel>
          ) : (
            <EmptyState compact icon={CalendarX2} title="Snapshot comparison unavailable">
              Comparing prices over time needs at least two inventory documents with a printed snapshot date. {fmtInt(scoped.scope.snapshots.length)} snapshot(s) imported,{" "}
              {fmtInt(scoped.scope.snapshots.filter((s) => s.dateKnown).length)} dated. Undated documents are never ordered in time by their import date, and no appreciation or depreciation is inferred.
            </EmptyState>
          )}
        </>
      )}
    </div>
  );
}
