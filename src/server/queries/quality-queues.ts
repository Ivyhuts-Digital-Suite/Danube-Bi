import { DataQualityIssue, IngestionRun, Project, RejectedRecord, SourceDocument } from "@/server/models";
import { rejectionSummary, scopedAnalytics } from "./analytics";
import { unmatchedTransactionNames } from "./catalog";
import { toObjectId } from "./common";

export const QUEUES = ["overview", "review", "rejected", "aliases", "snapshots", "dld", "extraction", "issues"] as const;
export type Queue = (typeof QUEUES)[number];

/** Counts for every queue, plus the data the selected queue needs. */
export async function getQualityWorkspace(queue: Queue, opts: { reason?: string; page?: number; rule?: string; showResolved?: boolean }) {
  const scoped = await scopedAnalytics();
  const scope = scoped.scope.current;
  const [rejections, openByRule, unmatched, docs, failedRuns] = await Promise.all([
    rejectionSummary(scope),
    DataQualityIssue.aggregate<{ _id: { rule: string; severity: string }; n: number }>([
      { $match: { resolvedAt: null } },
      { $group: { _id: { rule: "$rule", severity: "$severity" }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    unmatchedTransactionNames(100),
    SourceDocument.find().select("filename documentType warnings pageCount extractionStatus importedAt").sort({ importedAt: -1 }).lean(),
    IngestionRun.find({ status: { $in: ["failed", "interrupted"] } }).sort({ startedAt: -1 }).limit(20).lean(),
  ]);
  const open = (rule: string) => openByRule.filter((r) => r._id.rule === rule).reduce((s, r) => s + r.n, 0);

  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);
  let rejected: { rows: Awaited<ReturnType<typeof listRejected>>; total: number } | null = null;
  if (queue === "rejected" && scope) {
    rejected = { rows: await listRejected(scope.sourceDocumentId, scope.extractionVersion, opts.reason, page, pageSize), total: await countRejected(scope.sourceDocumentId, scope.extractionVersion, opts.reason) };
  }
  let aliases: Array<{ id: string; details: string; detectedAt: Date; projects: Array<{ id: string; name: string; records: number }> }> = [];
  if (queue === "aliases") {
    const issues = await DataQualityIssue.find({ rule: "possible_project_alias", resolvedAt: null }).sort({ detectedAt: -1 }).lean();
    const ids = [...new Set(issues.flatMap((i) => (i.entityId ?? "").split(",").filter(Boolean)))];
    const names = new Map((await Project.find({ _id: { $in: ids } }).select("name").lean()).map((p) => [String(p._id), p.name]));
    const records = new Map(scoped.analytics.projects.map((g) => [g.key, g.records]));
    aliases = issues.map((i) => ({
      id: String(i._id),
      details: i.details,
      detectedAt: i.detectedAt,
      projects: (i.entityId ?? "")
        .split(",")
        .filter(Boolean)
        .map((pid) => ({ id: pid, name: names.get(pid) ?? "Project no longer exists", records: records.get(pid) ?? 0 })),
    }));
  }
  let issues: Awaited<ReturnType<typeof listIssueDocs>> | null = null;
  if (queue === "issues") issues = await listIssueDocs(opts.rule, opts.showResolved ?? false);

  return {
    scope: scoped.scope,
    analytics: scoped.analytics,
    rejections,
    openByRule,
    unmatched,
    docs,
    failedRuns,
    rejected,
    aliases,
    issues,
    pageSize,
    counts: {
      review: scoped.analytics.coverage.reviewRequired,
      rejected: rejections.total,
      aliases: open("possible_project_alias"),
      snapshots: scoped.scope.snapshots.filter((s) => !s.dateKnown).length,
      dld: unmatched.length + open("conflicting_transaction_record") + open("unmatched_project_candidate"),
      extraction: docs.reduce((s, d) => s + (d.warnings.some((w) => /no text layer/.test(w)) ? 1 : 0), 0) + failedRuns.length,
      issues: openByRule.reduce((s, r) => s + r.n, 0),
    },
  };
}

function rejectedFilter(docId: string, version: string, reason?: string) {
  return { sourceDocumentId: toObjectId(docId), extractionVersion: version, ...(reason ? { reasons: reason } : {}) };
}

async function listRejected(docId: string, version: string, reason: string | undefined, page: number, pageSize: number) {
  // Locators are "p<page>:l<line>"; sort numerically by page then line.
  return RejectedRecord.aggregate<{ _id: unknown; locator: string; reasons: string[]; raw: Record<string, unknown> | null; p: number; l: number }>([
    { $match: rejectedFilter(docId, version, reason) },
    {
      $addFields: {
        p: { $toInt: { $arrayElemAt: [{ $split: [{ $substrCP: ["$locator", 1, 100] }, ":l"] }, 0] } },
        l: { $toInt: { $arrayElemAt: [{ $split: ["$locator", ":l"] }, 1] } },
      },
    },
    { $sort: { p: 1, l: 1 } },
    { $skip: (page - 1) * pageSize },
    { $limit: pageSize },
    { $project: { locator: 1, reasons: 1, raw: 1, p: 1, l: 1 } },
  ]);
}

async function countRejected(docId: string, version: string, reason?: string) {
  return RejectedRecord.countDocuments(rejectedFilter(docId, version, reason));
}

async function listIssueDocs(rule: string | undefined, showResolved: boolean) {
  const filter: Record<string, unknown> = {};
  if (rule) filter.rule = rule;
  if (!showResolved) filter.resolvedAt = null;
  const [list, total] = await Promise.all([DataQualityIssue.find(filter).sort({ resolvedAt: 1, severity: 1, lastSeenAt: -1 }).limit(200).lean(), DataQualityIssue.countDocuments(filter)]);
  return { list, total };
}
