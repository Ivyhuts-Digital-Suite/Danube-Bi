import { Download, GitCompareArrows, SearchX, SlidersHorizontal, Upload } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { Histogram } from "@/components/charts";
import { FilterChips, QuickFilters, type Chip } from "@/components/filters";
import { InventoryTable } from "@/components/inventory-table";
import { ScopeBar } from "@/components/scope";
import { STATUS_COLORS } from "@/components/status-colors";
import { btn, btnPrimary, DataError, EmptyState, input, label, loadDb, Notice, PageHeader, Pagination, Skeleton } from "@/components/ui";
import { BarList, ChartPanel, StackedBar } from "@/components/viz";
import { fmtAEDCompact, fmtInt } from "@/lib/format";
import { STATUS_KEYS, STATUS_LABELS, warningInfo } from "@/lib/inventory-analytics";
import { flatParams, href } from "@/lib/url";
import { scopedAnalytics } from "@/server/queries/analytics";
import { listUnits, parseUnitQuery, unitFacets, type UnitQuery } from "@/server/queries/inventory";
import { toUnitRows } from "@/server/queries/unit-rows";

export const metadata: Metadata = { title: "Inventory Explorer" };

export default function InventoryPage(props: PageProps<"/inventory">) {
  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Inventory Explorer"
        description="Explore every accepted unit record. Filters update the charts and the table together. Status and price are as printed in the source document on its own date — a listed price is not a transaction price."
      />
      <Suspense fallback={<Skeleton rows={3} />}>
        <Explorer searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

const STATUS_OPTIONS = [
  ["available", "Available"],
  ["sold", "Sold"],
  ["reserved", "Reserved / booked / hold"],
  ["other", "Unrecognized label"],
  ["missing", "No status"],
] as const;

const FLAG_LABELS: Record<string, string> = { missing_price: "Missing price", missing_area: "Missing size", review: "Review required" };

/** Parameters that define the filter (not sort/paging), as plain strings for URLs. */
function filterParams(q: UnitQuery): Record<string, string | undefined> {
  return {
    snapshot: q.snapshot,
    project: q.project,
    status: q.status,
    typology: q.typology,
    unitType: q.unitType,
    q: q.q,
    minPrice: q.minPrice != null ? String(q.minPrice) : undefined,
    maxPrice: q.maxPrice != null ? String(q.maxPrice) : undefined,
    warnings: q.warnings !== "any" ? q.warnings : undefined,
    flag: q.flag,
    warn: q.warn,
  };
}

async function Explorer({ searchParams }: { searchParams: PageProps<"/inventory">["searchParams"] }) {
  const sp = flatParams(await searchParams);
  const q = parseUnitQuery(sp);
  const r = await loadDb(async () => {
    const whole = await scopedAnalytics({ snapshot: q.snapshot, warnings: "any" });
    const scope = whole.scope.current;
    if (!scope) return { whole, filtered: null, page: null, facets: null };
    const scoped = { ...q, snapshot: scope.id };
    const [filtered, page, facets] = await Promise.all([scopedAnalytics(scoped), listUnits(scoped), unitFacets([scope.oid])]);
    return { whole, filtered, page, facets };
  });
  if (!r.ok) return <DataError error={r.error} />;
  const { whole, filtered, page, facets } = r.data;
  const scope = whole.scope.current;
  if (!scope || !filtered || !page || !facets) {
    return (
      <EmptyState icon={Upload} title="No inventory has been imported" action={<Link className={btn} href="/sources">Open Sources &amp; Imports</Link>}>
        Place <code>Merge2.pdf</code> in <code>data/incoming/</code> and import it. The explorer lists every accepted unit row with its source page.
      </EmptyState>
    );
  }

  const fp = filterParams(q);
  const base = { ...fp, sort: q.sort !== "sourcePage" ? q.sort : undefined, dir: q.dir !== "asc" ? q.dir : undefined, pageSize: q.pageSize !== 50 ? String(q.pageSize) : undefined };
  const query = new URLSearchParams(Object.entries(base).filter((e): e is [string, string] => !!e[1])).toString();
  const a = filtered.analytics;
  const w = whole.analytics;
  const projectName = (id?: string) => (id === "none" ? "No project recorded" : facets.projects.find((p) => p.id === id)?.name ?? "Unknown project");

  const chips: Chip[] = [];
  if (q.q) chips.push({ key: "q", label: `Search: “${q.q}”` });
  if (q.project) chips.push({ key: "project", label: `Project: ${projectName(q.project)}` });
  if (q.status) chips.push({ key: "status", label: `Status: ${STATUS_OPTIONS.find((s) => s[0] === q.status)?.[1]}` });
  if (q.typology) chips.push({ key: "typology", label: `Typology: ${q.typology}` });
  if (q.unitType) chips.push({ key: "unitType", label: `Unit type: ${q.unitType}` });
  if (q.minPrice != null) chips.push({ key: "minPrice", label: `Price ≥ AED ${fmtInt(q.minPrice)}` });
  if (q.maxPrice != null) chips.push({ key: "maxPrice", label: `Price ≤ AED ${fmtInt(q.maxPrice)}` });
  if (q.warnings !== "any") chips.push({ key: "warnings", label: q.warnings === "with" ? "With validation notes" : "Without validation notes" });
  if (q.flag) chips.push({ key: "flag", label: FLAG_LABELS[q.flag] });
  if (q.warn) chips.push({ key: "warn", label: `Check: ${warningInfo(q.warn).label}` });

  const rows = toUnitRows(page.rows, new Map(facets.projects.map((p) => [p.id, p.name])), scope);

  const projectBars = a.projects.slice(0, 8).map((g) => ({
    key: g.key,
    label: g.label,
    value: g.records,
    display: fmtInt(g.records),
    href: href("/inventory", fp, { project: g.key, page: null }),
    muted: g.key === "none",
  }));
  const advancedOpen = !!(q.typology || q.unitType || q.minPrice != null || q.maxPrice != null || q.warnings !== "any");

  return (
    <div className="space-y-5">
      <ScopeBar scope={whole.scope} path="/inventory" params={fp} filteredRecords={a.records} />

      {!scope.dateKnown ? (
        <Notice tone="warn" title="Snapshot date unknown">
          {scope.filename} does not print a date, so its statuses and prices cannot be placed in time. The import date is never used instead; each row shows “Unknown date”.
        </Notice>
      ) : null}

      {/* Filters */}
      <section aria-label="Filters" className="space-y-3 rounded-panel border border-line bg-surface p-4 shadow-panel">
        <Form action="/inventory" className="space-y-3">
          {q.snapshot ? <input type="hidden" name="snapshot" value={q.snapshot} /> : null}
          <input type="hidden" name="sort" value={q.sort} />
          <input type="hidden" name="dir" value={q.dir} />
          {q.flag ? <input type="hidden" name="flag" value={q.flag} /> : null}
          {q.warn ? <input type="hidden" name="warn" value={q.warn} /> : null}
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto]">
            <label className={label}>
              Search unit number or project
              <input name="q" defaultValue={q.q ?? ""} maxLength={100} placeholder="e.g. SRKZ-F38 or Bayz" className={`${input} w-full normal-case tracking-normal`} />
            </label>
            <label className={label}>
              Project
              <select name="project" defaultValue={q.project ?? ""} className={`${input} w-full normal-case tracking-normal`}>
                <option value="">All projects</option>
                {facets.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {facets.hasUnassigned ? <option value="none">No project recorded</option> : null}
              </select>
            </label>
            <label className={label}>
              Status in document
              <select name="status" defaultValue={q.status ?? ""} className={`${input} w-full normal-case tracking-normal`}>
                <option value="">Any status</option>
                {STATUS_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button type="submit" className={btnPrimary}>
                Apply
              </button>
              <Link href={href("/inventory", { snapshot: q.snapshot })} className={btn}>
                Reset
              </Link>
            </div>
          </div>
          <details open={advancedOpen} className="group">
            <summary className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-link">
              <SlidersHorizontal aria-hidden className="size-3.5" /> Advanced filters
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className={label}>
                Typology
                <select name="typology" defaultValue={q.typology ?? ""} className={`${input} w-full normal-case tracking-normal`}>
                  <option value="">Any typology</option>
                  {facets.typologies.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Unit type
                <select name="unitType" defaultValue={q.unitType ?? ""} className={`${input} w-full normal-case tracking-normal`}>
                  <option value="">Any unit type</option>
                  {facets.unitTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Min listed price (AED)
                <input name="minPrice" type="number" min={0} step={1000} defaultValue={q.minPrice ?? ""} className={`${input} w-full`} />
              </label>
              <label className={label}>
                Max listed price (AED)
                <input name="maxPrice" type="number" min={0} step={1000} defaultValue={q.maxPrice ?? ""} className={`${input} w-full`} />
              </label>
              <label className={label}>
                Validation notes
                <select name="warnings" defaultValue={q.warnings} className={`${input} w-full normal-case tracking-normal`}>
                  <option value="any">Any</option>
                  <option value="with">With any note</option>
                  <option value="without">Without notes</option>
                </select>
              </label>
            </div>
          </details>
        </Form>
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <QuickFilters
            path="/inventory"
            params={fp}
            items={[
              { key: "status", value: "available", label: "Available", count: w.status.available },
              { key: "status", value: "sold", label: "Sold", count: w.status.sold },
              { key: "flag", value: "review", label: "Review required", count: w.coverage.reviewRequired },
              { key: "flag", value: "missing_price", label: "Missing price", count: w.records - w.coverage.withPrice },
              { key: "flag", value: "missing_area", label: "Missing size", count: w.records - w.coverage.withArea },
            ]}
          />
          <FilterChips path="/inventory" params={fp} chips={chips} resetParams={{ snapshot: q.snapshot }} />
        </div>
      </section>

      {/* Summary of the filtered set */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-2">
            <span className="tabular text-2xl font-semibold text-ink">{fmtInt(page.total)}</span> records match
            {page.total !== w.records ? <span className="text-muted"> of {fmtInt(w.records)}</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {fmtInt(a.dedup.distinctUnits)} distinct units · median listed price {a.price.median != null ? fmtAEDCompact(a.price.median) : "—"} (n = {fmtInt(a.price.n)}) · listed value {fmtAEDCompact(a.listedValue.sum)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {whole.scope.snapshots.filter((s) => s.dateKnown).length >= 2 ? (
            <Link className={btn} href={`/inventory/compare?a=${whole.scope.snapshots.filter((s) => s.dateKnown)[1].id}&b=${whole.scope.snapshots.filter((s) => s.dateKnown)[0].id}`}>
              <GitCompareArrows aria-hidden className="size-4" /> Compare dated snapshots
            </Link>
          ) : null}
          {page.total > 0 ? (
            <a className={btn} href={href("/api/export/inventory", { ...fp, snapshot: scope.id, sort: q.sort, dir: q.dir })} download>
              <Download aria-hidden className="size-4" /> Export CSV ({fmtInt(page.total)})
            </a>
          ) : null}
        </div>
      </div>

      {page.total === 0 ? (
        <EmptyState icon={SearchX} title="No records match these filters" action={<Link className={btn} href={href("/inventory", { snapshot: q.snapshot })}>Reset filters</Link>}>
          Remove a filter above, or search for part of a unit number.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            <ChartPanel
              title="Status labels"
              metric="status_available"
              subtitle={`${fmtInt(a.records)} matching records`}
              table={{ head: ["Status", "Records"], rows: STATUS_KEYS.map((k) => [STATUS_LABELS[k], a.status[k]]) }}
            >
              <StackedBar ariaLabel="Matching records by status" segments={STATUS_KEYS.map((k) => ({ key: k, label: STATUS_LABELS[k], value: a.status[k], color: STATUS_COLORS[k], href: href("/inventory", fp, { status: k, page: null }) }))} />
            </ChartPanel>
            <ChartPanel title="Listed price bands" metric="listed_price_median" subtitle={`${fmtInt(a.price.n)} priced units (AED)`} table={{ head: ["Band (AED)", "Units"], rows: a.priceBands.map((b) => [b.label, b.count]) }}>
              <Histogram height={190} data={a.priceBands.map((b) => ({ label: b.label, count: b.count }))} xLabel="Listed price (AED)" ariaLabel="Listed price bands for matching records" />
            </ChartPanel>
            <ChartPanel title="Unit sizes" info="Distinct units with a valid size, in sq ft bands." subtitle={`${fmtInt(a.area.n)} units (sq ft)`} table={{ head: ["Band (sq ft)", "Units"], rows: a.sizeBands.map((b) => [b.label, b.count]) }}>
              <Histogram height={190} data={a.sizeBands.map((b) => ({ label: b.label, count: b.count }))} xLabel="Size (sq ft)" ariaLabel="Unit size bands for matching records" />
            </ChartPanel>
            <ChartPanel title="By project" metric="accepted_records" subtitle="Matching records, top 8 — select to filter" table={{ head: ["Project", "Records"], rows: a.projects.map((g) => [g.label, g.records]) }}>
              <BarList ariaLabel="Matching records by project" items={projectBars} />
            </ChartPanel>
          </div>

          <InventoryTable rows={rows} query={query} sort={q.sort} dir={q.dir} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Pagination page={q.page} pageCount={page.pageCount} total={page.total} pageSize={q.pageSize} href={(p) => href("/inventory", base, { page: p })} />
            <nav aria-label="Rows per page" className="flex items-center gap-1 text-xs text-muted">
              Rows per page
              {[25, 50, 100].map((n) => (
                <Link key={n} href={href("/inventory", base, { pageSize: n === 50 ? null : n, page: null })} aria-current={q.pageSize === n ? "true" : undefined} className={`rounded px-2 py-1 ${q.pageSize === n ? "bg-surface-3 text-ink" : "hover:bg-surface-2"}`}>
                  {n}
                </Link>
              ))}
            </nav>
          </div>
        </>
      )}
    </div>
  );
}
