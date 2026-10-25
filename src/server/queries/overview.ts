import { DataQualityIssue, DataSource, IngestionRun, MarketTransaction, Project, PublicEvent } from "@/server/models";
import { currentSnapshots } from "./common";
import { groupStats, inventoryTotals } from "./inventory";

/** Everything on the Command Center comes from stored records; empty collections yield zeros/nulls. */
export async function getOverview() {
  const [snapshots, totals, byProject, projectCount, txAgg, events, eventCount, issues, sources, failedRuns] = await Promise.all([
    currentSnapshots(),
    inventoryTotals(),
    groupStats("project"),
    Project.countDocuments(),
    MarketTransaction.aggregate<{ n: number; min: Date; max: Date }>([{ $group: { _id: null, n: { $sum: 1 }, min: { $min: "$transactionDate" }, max: { $max: "$transactionDate" } } }]),
    PublicEvent.find({ retractedAt: null }).sort({ publicationDate: -1 }).limit(6).lean(),
    PublicEvent.countDocuments({ retractedAt: null }),
    DataQualityIssue.aggregate<{ _id: string; n: number }>([{ $match: { resolvedAt: null } }, { $group: { _id: "$severity", n: { $sum: 1 } } }]),
    DataSource.find().sort({ key: 1 }).lean(),
    // Only sources whose most recent run failed; an older failure fixed by a later run is not an alert.
    IngestionRun.aggregate<{ _id: string; status: string; startedAt: Date; error: string | null; runId: string; filename: string | null }>([
      { $sort: { startedAt: -1 } },
      { $group: { _id: "$sourceKey", status: { $first: "$status" }, startedAt: { $first: "$startedAt" }, error: { $first: { $first: "$errors" } }, runId: { $first: "$_id" }, filename: { $first: "$filename" } } },
      { $match: { status: { $in: ["failed", "interrupted"] } } },
    ]),
  ]);
  return {
    snapshots,
    totals,
    byProject,
    projectCount,
    tx: txAgg[0] ?? null,
    events,
    eventCount,
    issues: Object.fromEntries(issues.map((i) => [i._id, i.n])) as Record<string, number>,
    sources,
    failedRuns,
  };
}
