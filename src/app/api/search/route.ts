import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { escapeRegex } from "@/lib/normalize";
import { requireDb } from "@/server/db";
import { InventoryUnitObservation, Project } from "@/server/models";
import { listScopeSnapshots } from "@/server/queries/analytics";

/** Typeahead for the global search box: projects (name/alias) and unit numbers in current snapshots. */
export async function GET(request: NextRequest) {
  await connection();
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return Response.json({ items: [] });
  try {
    await requireDb();
  } catch {
    return Response.json({ items: [], error: "database unavailable" }, { status: 503 });
  }
  const re = { $regex: escapeRegex(q), $options: "i" };
  const snapshots = await listScopeSnapshots();
  const [projects, units] = await Promise.all([
    Project.find({ $or: [{ name: re }, { "aliases.name": re }] }).select("name aliases").sort({ name: 1 }).limit(6).lean(),
    InventoryUnitObservation.find({ snapshotId: { $in: snapshots.map((s) => s.oid) }, unitNumber: re })
      .select("unitNumber projectNameAsListed listedPriceAED status")
      .sort({ unitNumber: 1 })
      .limit(8)
      .lean(),
  ]);
  const items = [
    ...projects.map((p) => {
      const alias = p.aliases.find((a) => a.name && new RegExp(escapeRegex(q), "i").test(a.name))?.name;
      return { kind: "project" as const, id: String(p._id), title: p.name, subtitle: alias ? `Project · alias “${alias}”` : "Project", href: `/projects/${p._id}` };
    }),
    ...units.map((u) => ({
      kind: "unit" as const,
      id: String(u._id),
      title: u.unitNumber ?? "—",
      subtitle: [u.projectNameAsListed ?? "No project", u.listedPriceAED != null ? `AED ${Math.round(u.listedPriceAED).toLocaleString("en-US")} listed` : "no price", u.status ?? "no status"].join(" · "),
      href: `/inventory/${u._id}`,
    })),
  ];
  return Response.json({ items });
}
