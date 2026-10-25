import type { PipelineStage, Types } from "mongoose";
import { z } from "zod";
import { escapeRegex } from "@/lib/normalize";
import { summarize, type Summary } from "@/lib/stats";
import { InventorySnapshot, InventoryUnitObservation, Project } from "@/server/models";
import { currentSnapshots, toObjectId } from "./common";

export const SORTABLE = ["unitNumber", "projectNameAsListed", "typology", "unitType", "areaSqFt", "listedPriceAED", "pricePerSqFt", "status", "sourcePage"] as const;

export const unitQuerySchema = z.object({
  snapshot: z.string().max(40).optional(),
  project: z.string().max(40).optional(),
  status: z.enum(["available", "sold", "reserved", "other"]).optional(),
  typology: z.string().max(100).optional(),
  unitType: z.string().max(100).optional(),
  q: z.string().trim().max(100).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  warnings: z.enum(["any", "with", "without"]).default("any"),
  sort: z.enum(SORTABLE).default("sourcePage"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n)).default(50),
});
export type UnitQuery = z.infer<typeof unitQuerySchema>;

/** Parse URL search params leniently: invalid values fall back to defaults instead of erroring. */
export function parseUnitQuery(sp: Record<string, string | string[] | undefined>): UnitQuery {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== undefined && val !== "") flat[k] = val;
  }
  const parsed = unitQuerySchema.safeParse(flat);
  if (parsed.success) return parsed.data;
  const cleaned = { ...flat };
  for (const issue of parsed.error.issues) delete cleaned[String(issue.path[0])];
  return unitQuerySchema.parse(cleaned);
}

export async function resolveSnapshotIds(snapshot?: string): Promise<Types.ObjectId[]> {
  const snaps = await currentSnapshots();
  const chosen = toObjectId(snapshot);
  if (chosen && snaps.some((s) => String(s._id) === String(chosen))) return [chosen];
  return snaps.map((s) => s._id);
}

function unitMatch(q: UnitQuery, snapshotIds: Types.ObjectId[]) {
  const match: Record<string, unknown> = { snapshotId: { $in: snapshotIds } };
  const projectId = toObjectId(q.project);
  if (q.project === "none") match.projectId = null;
  else if (projectId) match.projectId = projectId;
  if (q.status) match.statusNormalized = q.status;
  if (q.typology) match.typology = q.typology;
  if (q.unitType) match.unitType = q.unitType;
  if (q.q) match.unitNumber = { $regex: escapeRegex(q.q), $options: "i" };
  if (q.minPrice != null || q.maxPrice != null) {
    match.listedPriceAED = { ...(q.minPrice != null ? { $gte: q.minPrice } : {}), ...(q.maxPrice != null ? { $lte: q.maxPrice } : {}) };
  }
  if (q.warnings === "with") match["validationWarnings.0"] = { $exists: true };
  if (q.warnings === "without") match.validationWarnings = { $size: 0 };
  return match;
}

export async function listUnits(q: UnitQuery) {
  const snapshotIds = await resolveSnapshotIds(q.snapshot);
  const match = unitMatch(q, snapshotIds);
  const [total, rows] = await Promise.all([
    InventoryUnitObservation.countDocuments(match),
    InventoryUnitObservation.find(match)
      .sort({ [q.sort]: q.dir === "asc" ? 1 : -1, _id: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .select("projectId projectNameAsListed unitNumber unitType typology areaSqFt view listedPriceAED pricePerSqFt status statusNormalized sourcePage snapshotId validationWarnings")
      .lean(),
  ]);
  return { total, rows, pageCount: Math.max(1, Math.ceil(total / q.pageSize)) };
}

export async function unitFacets(snapshotIds: Types.ObjectId[]) {
  const [typologies, unitTypes, projects] = await Promise.all([
    InventoryUnitObservation.distinct("typology", { snapshotId: { $in: snapshotIds } }),
    InventoryUnitObservation.distinct("unitType", { snapshotId: { $in: snapshotIds } }),
    InventoryUnitObservation.distinct("projectId", { snapshotId: { $in: snapshotIds } }),
  ]);
  const projectDocs = await Project.find({ _id: { $in: projects.filter(Boolean) } }).select("name").sort({ name: 1 }).lean();
  return {
    typologies: (typologies.filter(Boolean) as string[]).sort(),
    unitTypes: (unitTypes.filter(Boolean) as string[]).sort(),
    projects: projectDocs.map((p) => ({ id: String(p._id), name: p.name })),
    hasUnassigned: projects.some((p) => p == null),
  };
}

export async function getUnit(id: string) {
  const oid = toObjectId(id);
  if (!oid) return null;
  const obs = await InventoryUnitObservation.findById(oid)
    .populate<{ projectId: { _id: Types.ObjectId; name: string } | null }>("projectId", "name")
    .populate<{ sourceDocumentId: { _id: Types.ObjectId; filename: string; sha256: string } }>("sourceDocumentId", "filename sha256")
    .lean();
  if (!obs) return null;
  const snapshot = await InventorySnapshot.findById(obs.snapshotId).lean();
  // Same unit in every snapshot (including superseded extraction versions, labelled as such).
  const history = obs.unitKey
    ? await InventoryUnitObservation.find({ projectId: obs.projectId?._id ?? null, unitKey: obs.unitKey })
        .select("snapshotId listedPriceAED status areaSqFt pricePerSqFt sourcePage sourceDocumentId")
        .lean()
    : [];
  const snaps = await InventorySnapshot.find({ _id: { $in: history.map((h) => h.snapshotId) } })
    .populate<{ sourceDocumentId: { filename: string } }>("sourceDocumentId", "filename")
    .lean();
  const snapById = new Map(snaps.map((s) => [String(s._id), s]));
  return {
    obs,
    snapshot,
    history: history
      .map((h) => ({ ...h, snapshot: snapById.get(String(h.snapshotId)) }))
      .sort((a, b) => (a.snapshot?.snapshotDate?.getTime() ?? 0) - (b.snapshot?.snapshotDate?.getTime() ?? 0)),
  };
}

export interface GroupStats {
  key: string;
  label: string;
  rows: number;
  distinctUnits: number;
  price: Summary;
  psf: Summary;
  area: Summary;
  status: Record<string, number>;
}

/** Exact per-group statistics for current snapshots, computed from the stored rows. */
export async function groupStats(by: "project" | "typology" | "unitType", filter: { snapshot?: string; status?: string; project?: string } = {}): Promise<GroupStats[]> {
  const snapshotIds = await resolveSnapshotIds(filter.snapshot);
  const match: Record<string, unknown> = { snapshotId: { $in: snapshotIds } };
  if (filter.status) match.statusNormalized = filter.status;
  const pid = toObjectId(filter.project);
  if (pid) match.projectId = pid;
  const field = by === "project" ? "$projectId" : by === "typology" ? "$typology" : "$unitType";
  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: field,
        rows: { $sum: 1 },
        units: { $addToSet: { s: "$snapshotId", u: "$unitKey" } },
        prices: { $push: "$listedPriceAED" },
        psf: { $push: "$pricePerSqFt" },
        areas: { $push: "$areaSqFt" },
        statuses: { $push: "$statusNormalized" },
      },
    },
  ];
  const groups = await InventoryUnitObservation.aggregate<{
    _id: Types.ObjectId | string | null;
    rows: number;
    units: Array<{ s: Types.ObjectId; u: string | null }>;
    prices: Array<number | null>;
    psf: Array<number | null>;
    areas: Array<number | null>;
    statuses: Array<string | null>;
  }>(pipeline);
  const names =
    by === "project"
      ? new Map((await Project.find({ _id: { $in: groups.map((g) => g._id).filter(Boolean) } }).select("name").lean()).map((p) => [String(p._id), p.name]))
      : new Map<string, string>();
  return groups
    .map((g) => {
      const status: Record<string, number> = {};
      for (const s of g.statuses) status[s ?? "missing"] = (status[s ?? "missing"] ?? 0) + 1;
      const key = g._id == null ? "none" : String(g._id);
      return {
        key,
        label: by === "project" ? (g._id ? names.get(key) ?? "Unknown project" : "No project recorded") : g._id ? String(g._id) : "Not recorded",
        rows: g.rows,
        distinctUnits: g.units.filter((u) => u.u).length,
        price: summarize(g.prices),
        psf: summarize(g.psf),
        area: summarize(g.areas),
        status,
      };
    })
    .sort((a, b) => b.rows - a.rows);
}

export async function inventoryTotals(snapshot?: string) {
  const snapshotIds = await resolveSnapshotIds(snapshot);
  const [agg] = await InventoryUnitObservation.aggregate<{ rows: number; units: number; available: number; withWarnings: number }>([
    { $match: { snapshotId: { $in: snapshotIds } } },
    {
      $facet: {
        rows: [{ $count: "n" }],
        units: [{ $match: { unitKey: { $ne: null } } }, { $group: { _id: { s: "$snapshotId", p: "$projectId", u: "$unitKey" } } }, { $count: "n" }],
        available: [
          { $match: { statusNormalized: "available", unitKey: { $ne: null } } },
          { $group: { _id: { s: "$snapshotId", p: "$projectId", u: "$unitKey" } } },
          { $count: "n" },
        ],
        withWarnings: [{ $match: { "validationWarnings.0": { $exists: true } } }, { $count: "n" }],
      },
    },
    {
      $project: {
        rows: { $ifNull: [{ $first: "$rows.n" }, 0] },
        units: { $ifNull: [{ $first: "$units.n" }, 0] },
        available: { $ifNull: [{ $first: "$available.n" }, 0] },
        withWarnings: { $ifNull: [{ $first: "$withWarnings.n" }, 0] },
      },
    },
  ]);
  return agg ?? { rows: 0, units: 0, available: 0, withWarnings: 0 };
}

/** Compare two snapshots with known dates: matching is by project + normalized unit number. */
export async function compareSnapshots(aId: string, bId: string) {
  const a = toObjectId(aId);
  const b = toObjectId(bId);
  if (!a || !b || String(a) === String(b)) return null;
  const [sa, sb] = await Promise.all([InventorySnapshot.findById(a).lean(), InventorySnapshot.findById(b).lean()]);
  if (!sa || !sb) return null;
  if (sa.snapshotDateStatus !== "from_document" || sb.snapshotDateStatus !== "from_document") {
    return { comparable: false as const, reason: "Both snapshots need a snapshot date printed in the document to be compared in time." };
  }
  const [older, newer] = sa.snapshotDate! <= sb.snapshotDate! ? [sa, sb] : [sb, sa];
  const load = async (id: Types.ObjectId) =>
    new Map(
      (await InventoryUnitObservation.find({ snapshotId: id, unitKey: { $ne: null } }).select("projectId unitKey unitNumber listedPriceAED statusNormalized").lean()).map((o) => [
        `${o.projectId ?? "none"}|${o.unitKey}`,
        o,
      ]),
    );
  const [oldMap, newMap] = await Promise.all([load(older._id), load(newer._id)]);
  let onlyOld = 0;
  let onlyNew = 0;
  let priceChanged = 0;
  let statusChanged = 0;
  const changes: Array<{ unitNumber: string; field: string; from: unknown; to: unknown }> = [];
  for (const [k, o] of oldMap) {
    const n = newMap.get(k);
    if (!n) {
      onlyOld++;
      continue;
    }
    if (o.listedPriceAED !== n.listedPriceAED) {
      priceChanged++;
      if (changes.length < 200) changes.push({ unitNumber: o.unitNumber ?? "", field: "listed price", from: o.listedPriceAED, to: n.listedPriceAED });
    }
    if (o.statusNormalized !== n.statusNormalized) {
      statusChanged++;
      if (changes.length < 200) changes.push({ unitNumber: o.unitNumber ?? "", field: "status", from: o.statusNormalized, to: n.statusNormalized });
    }
  }
  for (const k of newMap.keys()) if (!oldMap.has(k)) onlyNew++;
  return { comparable: true as const, older, newer, inBoth: oldMap.size - onlyOld, onlyOld, onlyNew, priceChanged, statusChanged, changes };
}
