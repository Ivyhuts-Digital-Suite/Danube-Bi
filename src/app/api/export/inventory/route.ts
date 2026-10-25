import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { csvCell } from "@/lib/csv";
import { flatParams } from "@/lib/url";
import { requireDb } from "@/server/db";
import { InventoryUnitObservation, Project } from "@/server/models";
import { ANALYTICS_ROW_CAP, resolveScope } from "@/server/queries/analytics";
import { parseUnitQuery, unitMatch } from "@/server/queries/inventory";

/** CSV of the Inventory Explorer's current filter, for one snapshot. Local use only. */
export async function GET(request: NextRequest) {
  await connection();
  try {
    await requireDb();
  } catch {
    return new Response("Database unavailable", { status: 503 });
  }
  const q = parseUnitQuery(flatParams(Object.fromEntries(request.nextUrl.searchParams)));
  const scope = await resolveScope(q.snapshot);
  if (!scope.current) return new Response("No inventory imported", { status: 404 });
  const s = scope.current;
  const docs = await InventoryUnitObservation.find(unitMatch({ ...q, snapshot: s.id }, [s.oid]))
    .sort({ [q.sort]: q.dir === "asc" ? 1 : -1, _id: 1 })
    .limit(ANALYTICS_ROW_CAP)
    .lean();
  const names = new Map(
    (await Project.find({ _id: { $in: [...new Set(docs.map((d) => d.projectId).filter(Boolean))] } }).select("name").lean()).map((p) => [String(p._id), p.name]),
  );
  const head = [
    "unit_number", "project", "project_as_listed", "typology", "unit_type", "size_sqft", "view", "listed_price_aed", "aed_per_sqft",
    "status_as_printed", "status_read_as", "validation_warnings", "source_file", "source_sha256", "source_page", "snapshot_date",
  ];
  const lines = [head.join(",")];
  for (const d of docs) {
    lines.push(
      [
        d.unitNumber, d.projectId ? names.get(String(d.projectId)) : "", d.projectNameAsListed, d.typology, d.unitType, d.areaSqFt, d.view, d.listedPriceAED,
        d.pricePerSqFt != null ? Math.round(d.pricePerSqFt * 100) / 100 : null, d.status, d.statusNormalized, (d.validationWarnings ?? []).join("; "),
        s.filename, s.sha256, d.sourcePage, s.dateKnown ? s.snapshotDate!.toISOString().slice(0, 10) : "unknown",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inventory-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
