import type { Types } from "mongoose";
import { cleanText, normalizeName } from "@/lib/normalize";
import {
  BrochurePage,
  InventoryUnitObservation,
  MarketTransaction,
  Project,
  ProjectFactObservation,
  PublicEvent,
} from "@/server/models";
import { upsertIssue } from "@/server/quality";

export interface ProjectSourceRef {
  sourceType: string;
  sourceDocumentId?: Types.ObjectId;
  page?: number;
  claimType: "documented" | "marketing_claim" | "registered_transaction" | "official_public";
  limitations?: string;
}

/**
 * Find a project by exact normalized name/alias, or create it from a name found in a source.
 * Only exact normalized matches are reused; similar names create separate projects that are
 * flagged for review by runProjectAliasChecks.
 */
export async function resolveOrCreateProject(rawName: string, ref: ProjectSourceRef): Promise<Types.ObjectId | null> {
  const name = cleanText(rawName);
  const key = normalizeName(name);
  if (!key) return null;
  const existing = await Project.findOne({ matchKeys: key }).select("_id sourceReferences").lean();
  if (existing) {
    const already = existing.sourceReferences.some(
      (r) => String(r.sourceDocumentId ?? "") === String(ref.sourceDocumentId ?? "") && r.sourceType === ref.sourceType,
    );
    if (!already) {
      await Project.updateOne({ _id: existing._id }, { $push: { sourceReferences: { ...ref, retrievedAt: new Date(), verificationStatus: "unverified" } } });
    }
    return existing._id;
  }
  try {
    const created = await Project.create({
      name,
      normalizedName: key,
      matchKeys: [key],
      aliases: [],
      sourceReferences: [{ ...ref, retrievedAt: new Date(), verificationStatus: "unverified" }],
    });
    return created._id;
  } catch (err) {
    const raced = await Project.findOne({ matchKeys: key }).select("_id").lean();
    if (raced) return raced._id;
    throw err;
  }
}

export class AliasConflictError extends Error {}

/**
 * Add an alias after human review, then link any DLD transactions that carry that exact name.
 * Returns the number of transactions newly linked.
 */
export async function addProjectAlias(projectId: Types.ObjectId, aliasName: string, note?: string): Promise<number> {
  const name = cleanText(aliasName);
  const key = normalizeName(name);
  if (!key) throw new AliasConflictError("Alias must contain letters or digits.");
  const owner = await Project.findOne({ matchKeys: key }).select("_id name").lean();
  if (owner && String(owner._id) !== String(projectId)) {
    throw new AliasConflictError(`"${name}" already identifies project "${owner.name}". Merge the projects instead if they are the same.`);
  }
  if (owner) return 0;
  await Project.updateOne(
    { _id: projectId },
    { $push: { aliases: { name, normalized: key, addedBy: "user", addedAt: new Date(), note } }, $addToSet: { matchKeys: key } },
  );
  const res = await MarketTransaction.updateMany(
    { projectNormalizedName: key, projectId: null },
    { $set: { projectId, matchMethod: "exact_alias", matchConfidence: "high" } },
  );
  return res.modifiedCount;
}

/**
 * Merge `sourceId` into `targetId` after human review: every observation that referenced the
 * source now references the target, the source's names become aliases, and the decision is
 * recorded as a resolved data-quality entry. Observations themselves are not altered otherwise.
 */
export async function mergeProjects(sourceId: Types.ObjectId, targetId: Types.ObjectId, note: string) {
  if (String(sourceId) === String(targetId)) throw new AliasConflictError("Cannot merge a project into itself.");
  const [source, target] = await Promise.all([Project.findById(sourceId).lean(), Project.findById(targetId).lean()]);
  if (!source || !target) throw new AliasConflictError("Project not found.");
  // A local standalone mongod has no multi-document transactions, so the steps are ordered to be
  // safely re-runnable: references move first, the source project is deleted last.
  await InventoryUnitObservation.updateMany({ projectId: sourceId }, { $set: { projectId: targetId } });
  for (const f of await ProjectFactObservation.find({ projectId: sourceId }).select("_id")) {
    try {
      await ProjectFactObservation.updateOne({ _id: f._id }, { $set: { projectId: targetId } });
    } catch (err) {
      // The target already holds the identical fact from the same document page: drop the copy.
      if ((err as { code?: number }).code === 11000) await ProjectFactObservation.deleteOne({ _id: f._id });
      else throw err;
    }
  }
  await MarketTransaction.updateMany({ projectId: sourceId }, { $set: { projectId: targetId } });
  await BrochurePage.updateMany({ detectedProjectIds: sourceId }, { $addToSet: { detectedProjectIds: targetId } });
  await BrochurePage.updateMany({ detectedProjectIds: sourceId }, { $pull: { detectedProjectIds: sourceId } });
  await PublicEvent.updateMany({ projectIds: sourceId }, { $addToSet: { projectIds: targetId } });
  await PublicEvent.updateMany({ projectIds: sourceId }, { $pull: { projectIds: sourceId } });
  const newAliases = [{ name: source.name, normalized: source.normalizedName, addedBy: "user", addedAt: new Date(), note: `Merged: ${note}` }, ...source.aliases];
  await Project.updateOne(
    { _id: targetId },
    { $push: { aliases: { $each: newAliases }, sourceReferences: { $each: source.sourceReferences } } },
  );
  // matchKeys are unique across projects, so they can move only after the source is gone.
  await Project.deleteOne({ _id: sourceId });
  await Project.updateOne({ _id: targetId }, { $addToSet: { matchKeys: { $each: source.matchKeys } } });
  await upsertIssue({
    key: `merge:${sourceId}:${targetId}`,
    entityType: "Project",
    entityId: String(targetId),
    rule: "projects_merged_by_user",
    severity: "info",
    details: `"${source.name}" was merged into "${target.name}" after review. Reason: ${note}`,
  });
}
