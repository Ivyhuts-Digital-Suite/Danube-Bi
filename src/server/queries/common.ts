import { Types } from "mongoose";
import { InventorySnapshot } from "@/server/models";

export function toObjectId(id: string | null | undefined): Types.ObjectId | null {
  return id && Types.ObjectId.isValid(id) && String(new Types.ObjectId(id)) === id ? new Types.ObjectId(id) : null;
}

/** Inventory snapshots that feed metrics (older extraction versions of a document are excluded). */
export async function currentSnapshots() {
  return InventorySnapshot.find({ superseded: false })
    .populate<{ sourceDocumentId: { _id: Types.ObjectId; filename: string; sha256: string } }>("sourceDocumentId", "filename sha256")
    .sort({ snapshotDate: -1, importedAt: -1 })
    .lean();
}

export type CurrentSnapshot = Awaited<ReturnType<typeof currentSnapshots>>[number];
