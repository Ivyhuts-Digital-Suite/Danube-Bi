import type { Types } from "mongoose";
import { editDistance } from "@/lib/normalize";
import { DataQualityIssue, InventoryUnitObservation, MarketTransaction, Project } from "@/server/models";

export interface IssueInput {
  key: string;
  entityType: string;
  entityId?: string;
  rule: string;
  severity: "info" | "warning" | "error";
  details: string;
  sourceReferences?: Array<Record<string, unknown>>;
}

/** Insert or refresh an issue. Re-detection updates lastSeenAt and never duplicates. */
export async function upsertIssue(issue: IssueInput, now = new Date()) {
  await DataQualityIssue.updateOne(
    { key: issue.key },
    {
      $set: {
        entityType: issue.entityType,
        entityId: issue.entityId,
        rule: issue.rule,
        severity: issue.severity,
        details: issue.details,
        sourceReferences: issue.sourceReferences ?? [],
        lastSeenAt: now,
      },
      $setOnInsert: { detectedAt: now },
    },
    { upsert: true },
  );
}

/** Duplicate and conflicting unit rows within one snapshot, plus missing-field rates. */
export async function runInventoryChecks(snapshotId: Types.ObjectId, sourceDocumentId: Types.ObjectId) {
  const groups = await InventoryUnitObservation.aggregate<{
    _id: { projectId: Types.ObjectId | null; unitKey: string };
    n: number;
    prices: Array<number | null>;
    statuses: Array<string | null>;
    areas: Array<number | null>;
    pages: number[];
    unitNumber: string;
  }>([
    { $match: { snapshotId, unitKey: { $ne: null } } },
    {
      $group: {
        _id: { projectId: "$projectId", unitKey: "$unitKey" },
        n: { $sum: 1 },
        prices: { $addToSet: "$listedPriceAED" },
        statuses: { $addToSet: "$statusNormalized" },
        areas: { $addToSet: "$areaSqFt" },
        pages: { $addToSet: "$sourcePage" },
        unitNumber: { $first: "$unitNumber" },
      },
    },
    { $match: { n: { $gt: 1 } } },
  ]);
  for (const g of groups) {
    const conflicting = g.prices.length > 1 || g.statuses.length > 1 || g.areas.length > 1;
    await upsertIssue({
      key: `inv_dup:${snapshotId}:${g._id.projectId ?? "none"}:${g._id.unitKey}`,
      entityType: "InventoryUnitObservation",
      entityId: g.unitNumber,
      rule: conflicting ? "conflicting_unit_records" : "duplicate_unit_records",
      severity: conflicting ? "error" : "warning",
      details: `Unit ${g.unitNumber} appears ${g.n} times in the same snapshot (pages ${g.pages.sort((a, b) => a - b).join(", ")})${
        conflicting ? ` with differing values (prices: ${g.prices.join(" / ")}; statuses: ${g.statuses.join(" / ")}; areas: ${g.areas.join(" / ")})` : ""
      }. Both rows are kept; distinct-unit counts count it once.`,
      sourceReferences: [{ sourceType: "local_document", sourceDocumentId, page: g.pages[0], claimType: "documented" }],
    });
  }

  const [stats] = await InventoryUnitObservation.aggregate<{
    total: number;
    noPrice: number;
    noArea: number;
    noStatus: number;
    noProject: number;
  }>([
    { $match: { snapshotId } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        noPrice: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$listedPriceAED", null] }, null] }, 1, 0] } },
        noArea: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$areaSqFt", null] }, null] }, 1, 0] } },
        noStatus: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$status", null] }, null] }, 1, 0] } },
        noProject: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$projectId", null] }, null] }, 1, 0] } },
      },
    },
  ]);
  if (stats) {
    for (const [field, n] of [
      ["listed price", stats.noPrice],
      ["area", stats.noArea],
      ["status", stats.noStatus],
      ["project", stats.noProject],
    ] as const) {
      if (n > 0) {
        await upsertIssue({
          key: `inv_missing:${snapshotId}:${field}`,
          entityType: "InventorySnapshot",
          entityId: String(snapshotId),
          rule: "missing_field",
          severity: n / stats.total > 0.1 ? "warning" : "info",
          details: `${n} of ${stats.total} rows have no usable ${field}.`,
          sourceReferences: [{ sourceType: "local_document", sourceDocumentId, claimType: "documented" }],
        });
      }
    }
  }
}

/** Two keys that differ only by trailing digits ("bayz101" vs "bayz102") are distinct projects. */
function differsOnlyByDigits(a: string, b: string): boolean {
  return a.replace(/\d+$/, "") === b.replace(/\d+$/, "");
}

/** Flag project names that may be aliases of each other. Never merges anything. */
export async function runProjectAliasChecks() {
  const projects = await Project.find().select("_id name normalizedName").lean();
  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const a = projects[i];
      const b = projects[j];
      const [x, y] = a.normalizedName.length <= b.normalizedName.length ? [a, b] : [b, a];
      if (differsOnlyByDigits(x.normalizedName, y.normalizedName)) continue;
      const contains = x.normalizedName.length >= 4 && y.normalizedName.includes(x.normalizedName);
      const close = x.normalizedName.length >= 5 && editDistance(x.normalizedName, y.normalizedName) <= 1;
      if (!contains && !close) continue;
      const ids = [String(x._id), String(y._id)].sort();
      await upsertIssue({
        key: `possible_alias:${ids[0]}:${ids[1]}`,
        entityType: "Project",
        entityId: ids.join(","),
        rule: "possible_project_alias",
        severity: "info",
        details: `"${x.name}" and "${y.name}" may refer to the same project. Review the sources and merge on the project page only if the evidence supports it.`,
      });
    }
  }
}

/** Unmatched DLD project names that contain a known project name are surfaced for human review. */
export async function runTransactionMatchChecks() {
  const projects = await Project.find().select("_id name matchKeys").lean();
  const unmatched = await MarketTransaction.aggregate<{ _id: string; n: number; sample: string }>([
    { $match: { projectId: null, projectNormalizedName: { $nin: [null, ""] } } },
    { $group: { _id: "$projectNormalizedName", n: { $sum: 1 }, sample: { $first: "$projectNameAsReported" } } },
  ]);
  for (const u of unmatched) {
    for (const p of projects) {
      const key = p.matchKeys.find((k) => k.length >= 4 && u._id.includes(k) && !differsOnlyByDigits(k, u._id));
      if (!key) continue;
      await upsertIssue({
        key: `tx_candidate:${u._id}:${p._id}`,
        entityType: "MarketTransaction",
        entityId: u._id,
        rule: "unmatched_project_candidate",
        severity: "info",
        details: `${u.n} DLD transaction(s) list project "${u.sample}", which contains the name of "${p.name}". They are NOT attributed to it. If the evidence confirms they are the same project, add "${u.sample}" as an alias on the project page.`,
      });
    }
  }
}
