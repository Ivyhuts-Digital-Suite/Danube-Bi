import type { Types } from "mongoose";
import { escapeRegex } from "@/lib/normalize";
import { validPositive, type GroupSummary } from "@/lib/inventory-analytics";
import {
  BrochurePage,
  DataQualityIssue,
  IngestionRun,
  InventorySnapshot,
  InventoryUnitObservation,
  MarketTransaction,
  Project,
  ProjectFactObservation,
  SourceDocument,
} from "@/server/models";
import { scopedAnalytics } from "./analytics";
import { getProject } from "./catalog";
import { listUnits, parseUnitQuery } from "./inventory";

export interface PortfolioProject {
  id: string;
  name: string;
  normalizedName: string;
  aliases: string[];
  stats: GroupSummary | null;
  coverage: { withPrice: number; withArea: number; records: number };
  /** Share of this project's records whose project came from a page heading rather than a project column. */
  headingAttributed: number;
  attribution: "project_column" | "mixed" | "section_heading" | "no_inventory";
  possibleAliases: number;
  facts: number;
  brochurePages: number;
  transactions: number;
  sourceFiles: string[];
  geo: { precision: string; lat: number; lng: number } | null;
}

/** Everything on a project page. Returns null when the project does not exist (or was merged away). */
export async function getProjectDetail(id: string, unitPage = 1) {
  const detail = await getProject(id);
  if (!detail) return null;
  const pid = detail.project._id;
  const scoped = await scopedAnalytics({ project: id, warnings: "any" });
  const scope = scoped.scope.current;
  const [units, snapshotRows, issues] = await Promise.all([
    scope ? listUnits(parseUnitQuery({ project: id, snapshot: scope.id, page: String(unitPage), pageSize: "25" })) : null,
    // Snapshot timeline across every snapshot (including superseded extractions) that lists this project.
    InventoryUnitObservation.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { projectId: pid } }, { $group: { _id: "$snapshotId", n: { $sum: 1 } } }]),
    DataQualityIssue.find({ resolvedAt: null, $or: [{ entityId: String(pid) }, { entityId: { $regex: escapeRegex(String(pid)) } }] })
      .sort({ severity: 1 })
      .lean(),
  ]);
  const snaps = await InventorySnapshot.find({ _id: { $in: snapshotRows.map((s) => s._id) } })
    .populate<{ sourceDocumentId: { _id: Types.ObjectId; filename: string; sha256: string } | null }>("sourceDocumentId", "filename sha256")
    .sort({ importedAt: -1 })
    .lean();
  const docIds = [...new Set([...snaps.map((s) => s.sourceDocumentId?._id), ...detail.project.sourceReferences.map((r) => r.sourceDocumentId)].filter(Boolean).map(String))];
  const runs = await IngestionRun.find({ sourceDocumentId: { $in: docIds } }).sort({ startedAt: -1 }).limit(20).lean();
  const aliasIds = issues.filter((i) => i.rule === "possible_project_alias").flatMap((i) => (i.entityId ?? "").split(",")).filter((x) => x && x !== String(pid));
  const aliasNames = new Map((await Project.find({ _id: { $in: aliasIds } }).select("name").lean()).map((p) => [String(p._id), p.name]));
  return {
    ...detail,
    scoped,
    units,
    timeline: snaps.map((s) => ({
      id: String(s._id),
      filename: s.sourceDocumentId?.filename ?? "document",
      sha256: s.sourceDocumentId?.sha256 ?? "",
      dateKnown: s.snapshotDateStatus === "from_document" && !!s.snapshotDate,
      snapshotDate: s.snapshotDate ?? null,
      importedAt: s.importedAt,
      superseded: s.superseded,
      extractionVersion: s.extractionVersion,
      records: snapshotRows.find((r) => String(r._id) === String(s._id))?.n ?? 0,
    })),
    runs,
    issues: issues.map((i) => ({ ...i, otherProjects: (i.entityId ?? "").split(",").filter((x) => x && x !== String(pid)).map((x) => ({ id: x, name: aliasNames.get(x) ?? "Unknown project" })) })),
  };
}

export async function getPortfolio(q?: string) {
  const filter = q ? { $or: [{ name: { $regex: escapeRegex(q), $options: "i" } }, { "aliases.name": { $regex: escapeRegex(q), $options: "i" } }] } : {};
  const [projects, scoped] = await Promise.all([Project.find(filter).sort({ name: 1 }).lean(), scopedAnalytics()]);
  const ids = projects.map((p) => p._id);
  const count = (rows: Array<{ _id: Types.ObjectId; n: number }>) => new Map(rows.map((r) => [String(r._id), r.n]));
  const [facts, pages, tx, aliasIssues] = await Promise.all([
    ProjectFactObservation.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { projectId: { $in: ids } } }, { $group: { _id: "$projectId", n: { $sum: 1 } } }]),
    BrochurePage.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { detectedProjectIds: { $in: ids } } }, { $unwind: "$detectedProjectIds" }, { $group: { _id: "$detectedProjectIds", n: { $sum: 1 } } }]),
    MarketTransaction.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { projectId: { $in: ids } } }, { $group: { _id: "$projectId", n: { $sum: 1 } } }]),
    DataQualityIssue.find({ rule: "possible_project_alias", resolvedAt: null }).select("entityId").lean(),
  ]);
  const [mf, mp, mt] = [count(facts), count(pages), count(tx)];
  const docIds = [...new Set(projects.flatMap((p) => p.sourceReferences.map((r) => r.sourceDocumentId).filter(Boolean).map(String)))];
  const docNames = new Map((await SourceDocument.find({ _id: { $in: docIds } }).select("filename").lean()).map((d) => [String(d._id), d.filename]));

  const statsById = new Map(scoped.analytics.projects.map((g) => [g.key, g]));
  const rowsById = new Map<string, typeof scoped.rows>();
  for (const r of scoped.rows) if (r.projectId) rowsById.set(r.projectId, [...(rowsById.get(r.projectId) ?? []), r]);

  const items: PortfolioProject[] = projects.map((p) => {
    const id = String(p._id);
    const rows = rowsById.get(id) ?? [];
    const heading = rows.filter((r) => r.validationWarnings.includes("project_from_section_heading")).length;
    return {
      id,
      name: p.name,
      normalizedName: p.normalizedName,
      aliases: p.aliases.map((a) => a.name ?? "").filter(Boolean),
      stats: statsById.get(id) ?? null,
      coverage: { records: rows.length, withPrice: rows.filter((r) => validPositive(r.listedPriceAED)).length, withArea: rows.filter((r) => validPositive(r.areaSqFt)).length },
      headingAttributed: heading,
      attribution: rows.length === 0 ? "no_inventory" : heading === 0 ? "project_column" : heading === rows.length ? "section_heading" : "mixed",
      possibleAliases: aliasIssues.filter((i) => (i.entityId ?? "").split(",").includes(id)).length,
      facts: mf.get(id) ?? 0,
      brochurePages: mp.get(id) ?? 0,
      transactions: mt.get(id) ?? 0,
      sourceFiles: [...new Set(p.sourceReferences.map((r) => (r.sourceDocumentId ? docNames.get(String(r.sourceDocumentId)) : r.sourceType)).filter((x): x is string => !!x))],
      geo: p.geo ? { precision: p.geo.precision, lat: p.geo.lat, lng: p.geo.lng } : null,
    };
  });
  return { scope: scoped.scope, items, unlinkedRecords: scoped.analytics.projects.find((g) => g.key === "none")?.records ?? 0 };
}
