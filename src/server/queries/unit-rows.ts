import type { UnitRow } from "@/components/inventory-table";
import type { ScopeSnapshot } from "./analytics";
import type { listUnits } from "./inventory";

type Listed = Awaited<ReturnType<typeof listUnits>>["rows"][number];

/** Map stored observations to table rows, with canonical project names and the scope's source/date. */
export function toUnitRows(rows: Listed[], projectNames: Map<string, string>, scope: ScopeSnapshot): UnitRow[] {
  const date = scope.dateKnown && scope.snapshotDate ? `as of ${scope.snapshotDate.toISOString().slice(0, 10)}` : null;
  return rows.map((o) => ({
    id: String(o._id),
    unitNumber: o.unitNumber ?? "",
    project: (o.projectId ? projectNames.get(String(o.projectId)) : undefined) ?? o.projectNameAsListed ?? "No project",
    projectAsListed: o.projectNameAsListed ?? "",
    projectId: o.projectId ? String(o.projectId) : null,
    unitType: o.unitType ?? null,
    typology: o.typology ?? null,
    areaSqFt: o.areaSqFt ?? null,
    view: o.view ?? null,
    listedPriceAED: o.listedPriceAED ?? null,
    pricePerSqFt: o.pricePerSqFt ?? null,
    status: o.status ?? null,
    statusNormalized: o.statusNormalized ?? null,
    sourcePage: o.sourcePage,
    lineIndex: o.lineIndex,
    filename: scope.filename,
    snapshotDate: date,
    warnings: o.validationWarnings ?? [],
    original: (o.originalValues ?? {}) as Record<string, string>,
  }));
}
