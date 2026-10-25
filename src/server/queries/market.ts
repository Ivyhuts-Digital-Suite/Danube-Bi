import { z } from "zod";
import { parseDateOnly } from "@/lib/normalize";
import { median } from "@/lib/stats";
import { DANUBE_DEVELOPER_PATTERN } from "@/server/ingest/dld-csv";
import { MarketTransaction, Project } from "@/server/models";

export const SHARE_COVERAGE_THRESHOLD = 0.8;

const marketQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  type: z.string().max(60).optional(),
  reg: z.string().max(60).optional(),
  usage: z.string().max(60).optional(),
  ptype: z.string().max(60).optional(),
});

export interface MarketFilter {
  from: Date | null;
  to: Date | null;
  transactionType?: string;
  registrationType?: string;
  usage?: string;
  propertyType?: string;
}

/** Dates are inclusive calendar days (stored at UTC midnight). */
export function parseMarketFilter(sp: Record<string, string | string[] | undefined>): MarketFilter {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  const q = marketQuerySchema.safeParse(flat);
  const d = q.success ? q.data : {};
  return {
    from: d.from ? parseDateOnly(d.from) : null,
    to: d.to ? parseDateOnly(d.to) : null,
    transactionType: d.type || undefined,
    registrationType: d.reg || undefined,
    usage: d.usage || undefined,
    propertyType: d.ptype || undefined,
  };
}

export function marketMatch(f: MarketFilter): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  if (f.from || f.to) {
    m.transactionDate = {
      ...(f.from ? { $gte: f.from } : {}),
      ...(f.to ? { $lt: new Date(f.to.getTime() + 86_400_000) } : {}),
    };
  }
  if (f.transactionType) m.transactionType = f.transactionType;
  if (f.registrationType) m.registrationType = f.registrationType;
  if (f.usage) m.usage = f.usage;
  if (f.propertyType) m.propertyType = f.propertyType;
  return m;
}

export async function marketFacets() {
  const [types, regs, usages, ptypes, range] = await Promise.all([
    MarketTransaction.distinct("transactionType"),
    MarketTransaction.distinct("registrationType"),
    MarketTransaction.distinct("usage"),
    MarketTransaction.distinct("propertyType"),
    MarketTransaction.aggregate<{ min: Date; max: Date; n: number }>([{ $group: { _id: null, min: { $min: "$transactionDate" }, max: { $max: "$transactionDate" }, n: { $sum: 1 } } }]),
  ]);
  const clean = (xs: unknown[]) => (xs.filter(Boolean) as string[]).sort();
  return { types: clean(types), regs: clean(regs), usages: clean(usages), ptypes: clean(ptypes), range: range[0] ?? null };
}

export interface DeveloperShare {
  developerName: string;
  isDanube: boolean;
  count: number;
  value: number;
  valueShare: number;
  countShare: number;
}

export async function marketSummary(f: MarketFilter) {
  const match = marketMatch(f);
  const [totals] = await MarketTransaction.aggregate<{ count: number; value: number; attributedValue: number; attributedCount: number; minDate: Date; maxDate: Date }>([
    { $match: match },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        value: { $sum: "$transactionValueAED" },
        attributedValue: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$developerName", null] }, null] }, "$transactionValueAED", 0] } },
        attributedCount: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$developerName", null] }, null] }, 1, 0] } },
        minDate: { $min: "$transactionDate" },
        maxDate: { $max: "$transactionDate" },
      },
    },
  ]);
  if (!totals) return null;

  // Exact median price per sq ft over rows with a positive DLD property size.
  const psfValues: number[] = [];
  const cursor = MarketTransaction.find({ ...match, areaSqFt: { $gt: 0 } }).select("transactionValueAED areaSqFt").lean().cursor();
  for await (const t of cursor) psfValues.push(t.transactionValueAED / t.areaSqFt!);

  const monthly = await MarketTransaction.aggregate<{ _id: string; count: number; value: number; danubeCount: number; danubeValue: number }>([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$transactionDate", timezone: "UTC" } },
        count: { $sum: 1 },
        value: { $sum: "$transactionValueAED" },
        danubeCount: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$developerName", ""] }, regex: DANUBE_DEVELOPER_PATTERN } }, 1, 0] } },
        danubeValue: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$developerName", ""] }, regex: DANUBE_DEVELOPER_PATTERN } }, "$transactionValueAED", 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const devs = await MarketTransaction.aggregate<{ _id: string; count: number; value: number }>([
    { $match: { ...match, developerName: { $ne: null } } },
    { $group: { _id: "$developerName", count: { $sum: 1 }, value: { $sum: "$transactionValueAED" } } },
    { $sort: { value: -1 } },
  ]);
  const developerShares: DeveloperShare[] = devs.map((d) => ({
    developerName: d._id,
    isDanube: DANUBE_DEVELOPER_PATTERN.test(d._id),
    count: d.count,
    value: d.value,
    valueShare: totals.value > 0 ? d.value / totals.value : 0,
    countShare: totals.count > 0 ? d.count / totals.count : 0,
  }));
  const danube = developerShares.filter((d) => d.isDanube);
  const coverage = totals.value > 0 ? totals.attributedValue / totals.value : 0;

  const topProjects = await MarketTransaction.aggregate<{ _id: string; count: number; value: number; developerName: string | null; projectId: string | null }>([
    { $match: { ...match, projectNameAsReported: { $ne: null } } },
    { $group: { _id: "$projectNameAsReported", count: { $sum: 1 }, value: { $sum: "$transactionValueAED" }, developerName: { $first: "$developerName" }, projectId: { $first: "$projectId" } } },
    { $sort: { count: -1 } },
    { $limit: 25 },
  ]);

  return {
    totals,
    medianPsf: median(psfValues),
    psfSample: psfValues.length,
    monthly,
    developerShares,
    danube: {
      developerNames: danube.map((d) => d.developerName),
      count: danube.reduce((s, d) => s + d.count, 0),
      value: danube.reduce((s, d) => s + d.value, 0),
      valueShare: danube.reduce((s, d) => s + d.valueShare, 0),
      countShare: danube.reduce((s, d) => s + d.countShare, 0),
    },
    coverage,
    unattributedValue: totals.value - totals.attributedValue,
    unattributedCount: totals.count - totals.attributedCount,
    shareReliable: coverage >= SHARE_COVERAGE_THRESHOLD,
    topProjects,
  };
}

/** Registered transactions linked (by exact name or reviewed alias) to projects in this app. */
export async function linkedProjectTransactions(f: MarketFilter) {
  const rows = await MarketTransaction.aggregate<{ _id: string; count: number; value: number; first: Date; last: Date }>([
    { $match: { ...marketMatch(f), projectId: { $ne: null } } },
    { $group: { _id: "$projectId", count: { $sum: 1 }, value: { $sum: "$transactionValueAED" }, first: { $min: "$transactionDate" }, last: { $max: "$transactionDate" } } },
    { $sort: { count: -1 } },
  ]);
  const names = new Map((await Project.find({ _id: { $in: rows.map((r) => r._id) } }).select("name").lean()).map((p) => [String(p._id), p.name]));
  return rows.map((r) => ({ ...r, projectId: String(r._id), name: names.get(String(r._id)) ?? "Unknown" }));
}
