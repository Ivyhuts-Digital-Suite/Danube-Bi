import type { Types } from "mongoose";
import { escapeRegex } from "@/lib/normalize";
import {
  BrochurePage,
  DataQualityIssue,
  DataSource,
  DldProjectObservation,
  IngestionRun,
  InventoryUnitObservation,
  MarketTransaction,
  Project,
  ProjectFactObservation,
  PublicEvent,
  RejectedRecord,
  SourceDocument,
} from "@/server/models";
import { toObjectId } from "./common";
import { resolveSnapshotIds } from "./inventory";

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(q?: string) {
  const filter = q ? { $or: [{ name: { $regex: escapeRegex(q), $options: "i" } }, { "aliases.name": { $regex: escapeRegex(q), $options: "i" } }] } : {};
  const projects = await Project.find(filter).sort({ name: 1 }).lean();
  const ids = projects.map((p) => p._id);
  const snapshotIds = await resolveSnapshotIds();
  const [inv, facts, tx, pages] = await Promise.all([
    InventoryUnitObservation.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { projectId: { $in: ids }, snapshotId: { $in: snapshotIds } } }, { $group: { _id: "$projectId", n: { $sum: 1 } } }]),
    ProjectFactObservation.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { projectId: { $in: ids } } }, { $group: { _id: "$projectId", n: { $sum: 1 } } }]),
    MarketTransaction.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { projectId: { $in: ids } } }, { $group: { _id: "$projectId", n: { $sum: 1 } } }]),
    BrochurePage.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { detectedProjectIds: { $in: ids } } }, { $unwind: "$detectedProjectIds" }, { $group: { _id: "$detectedProjectIds", n: { $sum: 1 } } }]),
  ]);
  const m = (rows: Array<{ _id: Types.ObjectId; n: number }>) => new Map(rows.map((r) => [String(r._id), r.n]));
  const [mi, mf, mt, mp] = [m(inv), m(facts), m(tx), m(pages)];
  return projects.map((p) => ({
    id: String(p._id),
    name: p.name,
    aliases: p.aliases.map((a) => a.name ?? ""),
    location: p.location,
    sourceTypes: [...new Set(p.sourceReferences.map((r) => r.sourceType))],
    inventoryRows: mi.get(String(p._id)) ?? 0,
    facts: mf.get(String(p._id)) ?? 0,
    transactions: mt.get(String(p._id)) ?? 0,
    brochurePages: mp.get(String(p._id)) ?? 0,
  }));
}

export async function getProject(id: string) {
  const oid = toObjectId(id);
  if (!oid) return null;
  const project = await Project.findById(oid).lean();
  if (!project) return null;
  const docIds = project.sourceReferences.map((r) => r.sourceDocumentId).filter(Boolean) as Types.ObjectId[];
  const [facts, pages, events, docs, txSummary, dldRegister, others] = await Promise.all([
    ProjectFactObservation.find({ projectId: oid }).sort({ category: 1, sourcePage: 1 }).lean(),
    BrochurePage.find({ detectedProjectIds: oid }).select("sourceDocumentId page attribution detectedNames charCount").sort({ page: 1 }).limit(200).lean(),
    PublicEvent.find({ projectIds: oid }).sort({ publicationDate: -1 }).lean(),
    SourceDocument.find({ _id: { $in: docIds } }).select("filename documentType sha256").lean(),
    MarketTransaction.aggregate<{ count: number; value: number; first: Date; last: Date }>([
      { $match: { projectId: oid } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: "$transactionValueAED" }, first: { $min: "$transactionDate" }, last: { $max: "$transactionDate" } } },
    ]),
    DldProjectObservation.find({ normalizedName: { $in: project.matchKeys } }).sort({ retrievedAt: -1 }).limit(20).lean(),
    Project.find({ _id: { $ne: oid } }).select("name").sort({ name: 1 }).lean(),
  ]);
  return {
    project,
    facts,
    pages,
    events,
    docs: new Map(docs.map((d) => [String(d._id), d])),
    transactions: txSummary[0] ?? null,
    dldRegister,
    otherProjects: others.map((o) => ({ id: String(o._id), name: o.name })),
  };
}

// ---------------------------------------------------------------------------
// Sources, runs, rejections
// ---------------------------------------------------------------------------

export async function listDataSources() {
  return DataSource.find().sort({ key: 1 }).lean();
}

export async function listDocuments() {
  return SourceDocument.find().sort({ importedAt: -1 }).lean();
}

export async function listRuns(limit = 50) {
  return IngestionRun.find().sort({ startedAt: -1 }).limit(limit).lean();
}

export async function getRun(id: string) {
  const oid = toObjectId(id);
  if (!oid) return null;
  const run = await IngestionRun.findById(oid).lean();
  if (!run) return null;
  const doc = run.sourceDocumentId ? await SourceDocument.findById(run.sourceDocumentId).lean() : null;
  const rejected = run.sourceDocumentId
    ? await RejectedRecord.find({ sourceDocumentId: run.sourceDocumentId }).sort({ locator: 1 }).limit(500).lean()
    : [];
  const rejectedTotal = run.sourceDocumentId ? await RejectedRecord.countDocuments({ sourceDocumentId: run.sourceDocumentId }) : 0;
  return { run, doc, rejected, rejectedTotal };
}

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

export async function listIssues(opts: { rule?: string; severity?: string; open?: boolean; limit?: number }) {
  const filter: Record<string, unknown> = {};
  if (opts.rule) filter.rule = opts.rule;
  if (opts.severity) filter.severity = opts.severity;
  if (opts.open !== false) filter.resolvedAt = null;
  const [issues, total, byRule] = await Promise.all([
    DataQualityIssue.find(filter).sort({ severity: 1, lastSeenAt: -1 }).limit(opts.limit ?? 200).lean(),
    DataQualityIssue.countDocuments(filter),
    DataQualityIssue.aggregate<{ _id: { rule: string; severity: string }; n: number }>([
      { $match: { resolvedAt: null } },
      { $group: { _id: { rule: "$rule", severity: "$severity" }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
  ]);
  return { issues, total, byRule };
}

export async function unmatchedTransactionNames(limit = 50) {
  return MarketTransaction.aggregate<{ _id: string; n: number; value: number; developerName: string | null }>([
    { $match: { projectId: null, projectNameAsReported: { $ne: null } } },
    { $group: { _id: "$projectNameAsReported", n: { $sum: 1 }, value: { $sum: "$transactionValueAED" }, developerName: { $first: "$developerName" } } },
    { $sort: { n: -1 } },
    { $limit: limit },
  ]);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function listEvents(opts: { type?: string; project?: string; includeRetracted?: boolean } = {}) {
  const filter: Record<string, unknown> = {};
  if (opts.type) filter.eventType = opts.type;
  const pid = toObjectId(opts.project);
  if (pid) filter.projectIds = pid;
  if (!opts.includeRetracted) filter.retractedAt = null;
  const events = await PublicEvent.find(filter).sort({ publicationDate: -1, createdAt: -1 }).limit(500).lean();
  const projectIds = [...new Set(events.flatMap((e) => e.projectIds.map(String)))];
  const names = new Map((await Project.find({ _id: { $in: projectIds } }).select("name").lean()).map((p) => [String(p._id), p.name]));
  return events.map((e) => ({ ...e, projectNames: e.projectIds.map((id) => names.get(String(id)) ?? "Unknown") }));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function globalSearch(raw: string) {
  const q = raw.trim().slice(0, 100);
  if (q.length < 2) return null;
  const re = { $regex: escapeRegex(q), $options: "i" };
  const snapshotIds = await resolveSnapshotIds();
  const [projects, units, events, pages] = await Promise.all([
    Project.find({ $or: [{ name: re }, { "aliases.name": re }] }).select("name").limit(20).lean(),
    InventoryUnitObservation.find({ snapshotId: { $in: snapshotIds }, unitNumber: re }).select("unitNumber projectNameAsListed listedPriceAED status").limit(20).lean(),
    PublicEvent.find({ $or: [{ title: re }, { summary: re }], retractedAt: null }).select("title publicationDate publisher").limit(20).lean(),
    BrochurePage.find({ text: re }).select("sourceDocumentId page text detectedNames").limit(20).lean(),
  ]);
  const lower = q.toLowerCase();
  return {
    q,
    projects,
    units,
    events,
    pages: pages.map((p) => {
      const i = p.text.toLowerCase().indexOf(lower);
      return { ...p, snippet: p.text.slice(Math.max(0, i - 80), i + q.length + 80).replace(/\s+/g, " ") };
    }),
  };
}
