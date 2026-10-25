import { DataQualityIssue, DataSource, IngestionRun, MarketTransaction, Project, PublicEvent } from "@/server/models";
import { rejectionSummary, scopedAnalytics } from "./analytics";
import { currentSnapshots } from "./common";
import { groupStats, inventoryTotals } from "./inventory";

/** Latest run per source, with the most recent error if it failed. */
export async function latestRunsBySource() {
  return IngestionRun.aggregate<{ _id: string; status: string; startedAt: Date; completedAt: Date | null; error: string | null; runId: string; filename: string | null }>([
    { $sort: { startedAt: -1 } },
    {
      $group: {
        _id: "$sourceKey",
        status: { $first: "$status" },
        startedAt: { $first: "$startedAt" },
        completedAt: { $first: "$completedAt" },
        error: { $first: { $first: "$errors" } },
        runId: { $first: "$_id" },
        filename: { $first: "$filename" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

export async function geoCoverage() {
  const [verified, approximate, total] = await Promise.all([
    Project.countDocuments({ "geo.precision": "verified" }),
    Project.countDocuments({ "geo.precision": "approximate" }),
    Project.countDocuments(),
  ]);
  return { verified, approximate, located: verified + approximate, total };
}

/** Everything on the Command Center, computed from stored records for the analysis scope. */
export async function getCommandCenter() {
  const [scoped, issues, sources, runs, txAgg, eventCount, geo] = await Promise.all([
    scopedAnalytics(),
    DataQualityIssue.aggregate<{ _id: { rule: string; severity: string }; n: number }>([
      { $match: { resolvedAt: null } },
      { $group: { _id: { rule: "$rule", severity: "$severity" }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    DataSource.find().sort({ key: 1 }).lean(),
    latestRunsBySource(),
    MarketTransaction.aggregate<{ n: number; min: Date; max: Date }>([{ $group: { _id: null, n: { $sum: 1 }, min: { $min: "$transactionDate" }, max: { $max: "$transactionDate" } } }]),
    PublicEvent.countDocuments({ retractedAt: null }),
    geoCoverage(),
  ]);
  const rejections = await rejectionSummary(scoped.scope.current);
  const lastSuccess = sources.map((s) => s.lastSuccessfulFetchAt).filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return { ...scoped, rejections, issues, sources, runs, lastSuccess, tx: txAgg[0] ?? null, eventCount, geo };
}

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
