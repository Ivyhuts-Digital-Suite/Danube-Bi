import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { InventoryTable, type UnitRow } from "@/components/inventory-table";
import { btn, btnPrimary, DataError, EmptyState, input, loadDb, Notice, PageHeader, Pagination, Skeleton } from "@/components/ui";
import { fmtDate, fmtInt } from "@/lib/format";
import { currentSnapshots } from "@/server/queries/common";
import { listUnits, parseUnitQuery, resolveSnapshotIds, unitFacets } from "@/server/queries/inventory";

export const metadata: Metadata = { title: "Inventory Explorer" };

export default function InventoryPage(props: PageProps<"/inventory">) {
  return (
    <>
      <PageHeader
        title="Inventory Explorer"
        description="Unit rows exactly as extracted from inventory documents. Status and price are as recorded on the document's own date; a listed price is not a transaction price."
      />
      <Suspense fallback={<Skeleton rows={6} />}>
        <Explorer searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Explorer({ searchParams }: { searchParams: PageProps<"/inventory">["searchParams"] }) {
  const sp = await searchParams;
  const q = parseUnitQuery(sp);
  const r = await loadDb(async () => {
    const snapshots = await currentSnapshots();
    const ids = await resolveSnapshotIds(q.snapshot);
    const [page, facets] = await Promise.all([listUnits(q), unitFacets(ids)]);
    return { snapshots, page, facets };
  });
  if (!r.ok) return <DataError error={r.error} />;
  const { snapshots, page, facets } = r.data;
  if (snapshots.length === 0) {
    return (
      <EmptyState title="No inventory has been imported">
        Place <code>Merge2.pdf</code> in <code>data/incoming/</code> and import it on <Link className="text-accent underline" href="/sources">Sources &amp; Imports</Link>.
      </EmptyState>
    );
  }

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "" && !["page"].includes(k)) params.set(k, String(v));
  const query = params.toString();
  const rows: UnitRow[] = page.rows.map((o) => ({
    id: String(o._id),
    unitNumber: o.unitNumber ?? "",
    project: o.projectNameAsListed ?? "—",
    projectId: o.projectId ? String(o.projectId) : null,
    unitType: o.unitType ?? "—",
    typology: o.typology ?? "—",
    areaSqFt: o.areaSqFt ?? null,
    view: o.view ?? "—",
    listedPriceAED: o.listedPriceAED ?? null,
    pricePerSqFt: o.pricePerSqFt ?? null,
    status: o.status ?? "—",
    sourcePage: o.sourcePage,
    warnings: o.validationWarnings ?? [],
  }));
  const dated = snapshots.filter((s) => s.snapshotDateStatus === "from_document");

  return (
    <div className="space-y-4">
      {snapshots.some((s) => s.snapshotDateStatus !== "from_document") ? (
        <Notice tone="warn">
          At least one inventory document has no printed snapshot date, so its statuses and prices cannot be placed in time. The import date is never used as a substitute.
        </Notice>
      ) : null}

      <Form action="/inventory" className="grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <label className="text-xs text-ink-2">
          Snapshot
          <select name="snapshot" defaultValue={q.snapshot ?? ""} className={`${input} mt-1 w-full`}>
            <option value="">All current snapshots</option>
            {snapshots.map((s) => (
              <option key={String(s._id)} value={String(s._id)}>
                {s.sourceDocumentId?.filename} — {s.snapshotDateStatus === "from_document" ? fmtDate(s.snapshotDate) : "date unknown"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-2">
          Project
          <select name="project" defaultValue={q.project ?? ""} className={`${input} mt-1 w-full`}>
            <option value="">All projects</option>
            {facets.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {facets.hasUnassigned ? <option value="none">No project recorded</option> : null}
          </select>
        </label>
        <label className="text-xs text-ink-2">
          Status in document
          <select name="status" defaultValue={q.status ?? ""} className={`${input} mt-1 w-full`}>
            <option value="">Any</option>
            <option value="available">Available</option>
            <option value="reserved">Reserved / booked / hold</option>
            <option value="sold">Sold</option>
            <option value="other">Other / unrecognized</option>
          </select>
        </label>
        <label className="text-xs text-ink-2">
          Typology
          <select name="typology" defaultValue={q.typology ?? ""} className={`${input} mt-1 w-full`}>
            <option value="">Any</option>
            {facets.typologies.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-2">
          Unit type
          <select name="unitType" defaultValue={q.unitType ?? ""} className={`${input} mt-1 w-full`}>
            <option value="">Any</option>
            {facets.unitTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-2">
          Unit number contains
          <input name="q" defaultValue={q.q ?? ""} maxLength={100} className={`${input} mt-1 w-full`} />
        </label>
        <label className="text-xs text-ink-2">
          Min listed price (AED)
          <input name="minPrice" type="number" min={0} defaultValue={q.minPrice ?? ""} className={`${input} mt-1 w-full`} />
        </label>
        <label className="text-xs text-ink-2">
          Max listed price (AED)
          <input name="maxPrice" type="number" min={0} defaultValue={q.maxPrice ?? ""} className={`${input} mt-1 w-full`} />
        </label>
        <label className="text-xs text-ink-2">
          Validation warnings
          <select name="warnings" defaultValue={q.warnings} className={`${input} mt-1 w-full`}>
            <option value="any">Any</option>
            <option value="with">Rows with warnings</option>
            <option value="without">Rows without warnings</option>
          </select>
        </label>
        <input type="hidden" name="sort" value={q.sort} />
        <input type="hidden" name="dir" value={q.dir} />
        <div className="flex items-end gap-2">
          <button type="submit" className={btnPrimary}>Apply</button>
          <Link href="/inventory" className={btn}>Reset</Link>
        </div>
      </Form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
        <span>
          <span className="tabular font-medium text-ink">{fmtInt(page.total)}</span> rows match
        </span>
        {dated.length >= 2 ? (
          <Link className="text-accent underline" href={`/inventory/compare?a=${dated[1]._id}&b=${dated[0]._id}`}>Compare dated snapshots</Link>
        ) : (
          <span className="text-xs text-muted">Snapshot comparison needs two documents with printed dates.</span>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No rows match these filters" />
      ) : (
        <InventoryTable rows={rows} query={query} sort={q.sort} dir={q.dir} />
      )}
      <Pagination page={q.page} pageCount={page.pageCount} href={(p) => `/inventory?${query}${query ? "&" : ""}page=${p}`} />
    </div>
  );
}
