import type { Types } from "mongoose";
import { computeInventoryAnalytics, type AnalyticsRow, type InventoryAnalytics } from "@/lib/inventory-analytics";
import { InventorySnapshot, InventoryUnitObservation, Project, RejectedRecord } from "@/server/models";
import { toObjectId } from "./common";
import { unitMatch, type UnitFilter } from "./inventory";

// ---------------------------------------------------------------------------
// Analysis scope: analytics always describe exactly ONE inventory snapshot, so a unit listed in
// two documents can never be counted twice. The default is the most recent snapshot with a
// printed date; when no snapshot is dated, the most recently imported one (labelled as such —
// the import date is never presented as the snapshot date).
// ---------------------------------------------------------------------------

export interface ScopeSnapshot {
  id: string;
  oid: Types.ObjectId;
  filename: string;
  sha256: string;
  sourceDocumentId: string;
  extractionVersion: string;
  snapshotDate: Date | null;
  dateKnown: boolean;
  dateEvidence: string | null;
  importedAt: Date;
  recordCount: number;
  rejectedCount: number;
  warnings: string[];
  pagesWithoutText: number | null;
}

export interface AnalysisScope {
  snapshots: ScopeSnapshot[];
  current: ScopeSnapshot | null;
  /** True when the user did not pick the snapshot. */
  isDefault: boolean;
  /** How the default was chosen, for display. */
  basis: "latest_dated" | "latest_imported_undated" | "selected" | "none";
}

const NO_TEXT = /^(\d+) page\(s\) have no text layer/;

export async function listScopeSnapshots(): Promise<ScopeSnapshot[]> {
  const snaps = await InventorySnapshot.find({ superseded: false })
    .populate<{ sourceDocumentId: { _id: Types.ObjectId; filename: string; sha256: string } | null }>("sourceDocumentId", "filename sha256")
    .lean();
  return snaps
    .map((s) => {
      const noText = s.warnings.map((w) => NO_TEXT.exec(w)).find(Boolean);
      const dateKnown = s.snapshotDateStatus === "from_document" && s.snapshotDate != null;
      return {
        id: String(s._id),
        oid: s._id,
        filename: s.sourceDocumentId?.filename ?? "document",
        sha256: s.sourceDocumentId?.sha256 ?? "",
        sourceDocumentId: String(s.sourceDocumentId?._id ?? ""),
        extractionVersion: s.extractionVersion,
        snapshotDate: dateKnown ? s.snapshotDate! : null,
        dateKnown,
        dateEvidence: s.snapshotDateEvidence?.text ?? null,
        importedAt: s.importedAt,
        recordCount: s.recordCount,
        rejectedCount: s.rejectedCount,
        warnings: s.warnings,
        pagesWithoutText: noText ? Number(noText[1]) : null,
      };
    })
    .sort((a, b) => {
      if (a.dateKnown !== b.dateKnown) return a.dateKnown ? -1 : 1;
      if (a.dateKnown && b.dateKnown) return b.snapshotDate!.getTime() - a.snapshotDate!.getTime();
      return b.importedAt.getTime() - a.importedAt.getTime();
    });
}

export async function resolveScope(snapshot?: string | null): Promise<AnalysisScope> {
  const snapshots = await listScopeSnapshots();
  const chosen = snapshot ? snapshots.find((s) => s.id === snapshot) : undefined;
  if (chosen) return { snapshots, current: chosen, isDefault: false, basis: "selected" };
  const current = snapshots[0] ?? null;
  return { snapshots, current, isDefault: true, basis: !current ? "none" : current.dateKnown ? "latest_dated" : "latest_imported_undated" };
}

// ---------------------------------------------------------------------------
// Loading rows for the pure analytics module
// ---------------------------------------------------------------------------

/** Hard cap on rows loaded for in-memory statistics; far above any single inventory document. */
export const ANALYTICS_ROW_CAP = 50_000;

export async function loadAnalyticsRows(match: Record<string, unknown>): Promise<{ rows: AnalyticsRow[]; truncated: boolean }> {
  const docs = await InventoryUnitObservation.find(match)
    .select("snapshotId projectId projectNameAsListed unitKey unitNumber typology unitType areaSqFt listedPriceAED statusNormalized validationWarnings sourcePage lineIndex")
    .limit(ANALYTICS_ROW_CAP + 1)
    .lean();
  const truncated = docs.length > ANALYTICS_ROW_CAP;
  const ids = [...new Set(docs.map((d) => d.projectId).filter(Boolean).map(String))];
  const names = new Map((await Project.find({ _id: { $in: ids } }).select("name").lean()).map((p) => [String(p._id), p.name]));
  const rows = docs.slice(0, ANALYTICS_ROW_CAP).map<AnalyticsRow>((d) => ({
    id: String(d._id),
    snapshotId: String(d.snapshotId),
    projectId: d.projectId ? String(d.projectId) : null,
    projectName: d.projectId ? (names.get(String(d.projectId)) ?? d.projectNameAsListed ?? null) : (d.projectNameAsListed ?? null),
    unitKey: d.unitKey ?? null,
    unitNumber: d.unitNumber ?? null,
    typology: d.typology ?? null,
    unitType: d.unitType ?? null,
    areaSqFt: d.areaSqFt ?? null,
    listedPriceAED: d.listedPriceAED ?? null,
    statusNormalized: d.statusNormalized ?? null,
    validationWarnings: d.validationWarnings ?? [],
    sourcePage: d.sourcePage,
    lineIndex: d.lineIndex,
  }));
  return { rows, truncated };
}

export interface ScopedAnalytics {
  scope: AnalysisScope;
  analytics: InventoryAnalytics;
  rows: AnalyticsRow[];
  truncated: boolean;
}

/** Analytics for the scope snapshot with optional explorer filters applied. */
export async function scopedAnalytics(filter: UnitFilter = { warnings: "any" }): Promise<ScopedAnalytics> {
  const scope = await resolveScope(filter.snapshot);
  if (!scope.current) return { scope, analytics: computeInventoryAnalytics([]), rows: [], truncated: false };
  const match = unitMatch({ ...filter, snapshot: scope.current.id }, [scope.current.oid]);
  const { rows, truncated } = await loadAnalyticsRows(match);
  return { scope, analytics: computeInventoryAnalytics(rows), rows, truncated };
}

// ---------------------------------------------------------------------------
// Rejected and unplaced PDF lines
// ---------------------------------------------------------------------------

export const REJECTION_LABELS: Record<string, { label: string; kind: "rejected" | "unplaced"; explanation: string }> = {
  missing_unit_number_and_price: {
    label: "No unit number and no price",
    kind: "rejected",
    explanation: "The line sat inside the table but had neither a unit number nor a price — usually a wrapped continuation of the previous row or a sub-heading.",
  },
  missing_unit_number: {
    label: "No unit number",
    kind: "rejected",
    explanation: "The line had other values (such as a price) but no unit number, so it cannot be identified as a unit.",
  },
  line_with_numbers_outside_table_columns: {
    label: "Unplaced line",
    kind: "unplaced",
    explanation: "A line containing numbers that did not align with the table's columns (for example notes, totals or text from a neighbouring layout). Kept for review.",
  },
};

export function rejectionInfo(reason: string) {
  return REJECTION_LABELS[reason] ?? { label: reason.replace(/_/g, " "), kind: "rejected" as const, explanation: "Rejected during extraction." };
}

export async function rejectionSummary(scope: ScopeSnapshot | null) {
  if (!scope) return { total: 0, rejected: 0, unplaced: 0, byReason: [] as Array<{ reason: string; count: number }> };
  const byReason = await RejectedRecord.aggregate<{ _id: string; n: number }>([
    { $match: { sourceDocumentId: toObjectId(scope.sourceDocumentId), extractionVersion: scope.extractionVersion } },
    { $unwind: "$reasons" },
    { $group: { _id: "$reasons", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  const total = await RejectedRecord.countDocuments({ sourceDocumentId: toObjectId(scope.sourceDocumentId), extractionVersion: scope.extractionVersion });
  const unplaced = byReason.filter((r) => rejectionInfo(r._id).kind === "unplaced").reduce((s, r) => s + r.n, 0);
  return { total, rejected: total - unplaced, unplaced, byReason: byReason.map((r) => ({ reason: r._id, count: r.n })) };
}
