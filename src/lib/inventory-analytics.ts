// Pure inventory analytics shared by every page. Database code loads rows and passes them here,
// so each formula exists once and is unit-tested (tests/unit/inventory-analytics.test.ts).
//
// Counting rules (also shown on the Methodology page):
// - "Unit records" are accepted inventory rows. Status and composition counts are per record.
// - Numeric statistics (prices, sizes, AED/sq ft, listed value) use the *analysis set*: one record
//   per distinct unit (snapshot + project + normalized unit number). Identical duplicate rows are
//   collapsed; units whose duplicate rows disagree are excluded and counted, never silently dropped.
// - A price is valid when it is a finite number > 0; a size when it is a finite number > 0.
//   AED/sq ft is computed only when both are valid.

import { pricePerSqFt } from "./normalize";
import { summarize, type Summary } from "./stats";

export const STATUS_KEYS = ["available", "sold", "reserved", "other", "missing"] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

export const STATUS_LABELS: Record<StatusKey, string> = {
  available: "Available",
  sold: "Sold",
  reserved: "Reserved / booked",
  other: "Unrecognized label",
  missing: "No status",
};

export interface AnalyticsRow {
  id: string;
  snapshotId: string;
  projectId: string | null;
  /** Canonical project name when linked, otherwise the name as listed (or null). */
  projectName: string | null;
  unitKey: string | null;
  unitNumber: string | null;
  typology: string | null;
  unitType: string | null;
  areaSqFt: number | null;
  listedPriceAED: number | null;
  statusNormalized: string | null;
  validationWarnings: string[];
  sourcePage: number;
  lineIndex: number;
}

// ---------------------------------------------------------------------------
// Validation warnings: human-readable explanations and whether a person must review the row.
// ---------------------------------------------------------------------------

export interface WarningInfo {
  label: string;
  explanation: string;
  /** True when the row cannot be fully trusted in calculations without a person checking it. */
  review: boolean;
}

const WARNINGS: Record<string, WarningInfo> = {
  price_missing: { label: "No price", explanation: "The row has no value in the price column, so it is excluded from price statistics and listed value.", review: true },
  price_unparseable: { label: "Price unreadable", explanation: "The price cell could not be read as a single number (e.g. text or a range). The original text is kept; the row is excluded from price statistics.", review: true },
  price_outside_plausible_range: { label: "Unusual price", explanation: "The price is outside AED 50,000–500,000,000. It is kept as printed but should be checked against the source page.", review: true },
  area_missing: { label: "No size", explanation: "The row has no size, so AED/sq ft cannot be calculated for it.", review: true },
  area_unparseable: { label: "Size unreadable", explanation: "The size cell could not be read as a single number. AED/sq ft is not calculated for this row.", review: true },
  area_outside_plausible_range: { label: "Unusual size", explanation: "The size is outside 100–50,000 sq ft. It is kept as printed but should be checked.", review: true },
  area_converted_from_sqm: { label: "Converted from m²", explanation: "The source column was in square metres and was converted with 1 m² = 10.7639 sq ft.", review: false },
  area_in_sqm: { label: "Size in m²", explanation: "The source page labels sizes in square metres.", review: false },
  status_missing: { label: "No status", explanation: "The status column is empty, so the row is counted under 'No status'.", review: true },
  status_unrecognized: { label: "Unrecognized status", explanation: "The status text is not a known label (available / sold / reserved). This is often other page text read into the status column.", review: true },
  project_missing: { label: "No project", explanation: "No project name was found for this row.", review: true },
  project_from_section_heading: { label: "Project from heading", explanation: "The page has no project column; the project was taken from a section heading on the page. Lower attribution confidence.", review: false },
  wrapped_text_joined: { label: "Wrapped text joined", explanation: "A cell's text wrapped onto a second line in the PDF and was joined. Informational.", review: false },
};

export function warningInfo(code: string): WarningInfo {
  if (WARNINGS[code]) return WARNINGS[code];
  const header = /^header_from_page_(\d+)$/.exec(code);
  if (header) {
    return { label: `Header from p.${header[1]}`, explanation: `This page has no table header of its own; columns were read using the header printed on page ${header[1]}. Informational.`, review: false };
  }
  return { label: code.replace(/_/g, " "), explanation: "Validation note recorded during extraction.", review: false };
}

/** Warning codes that mark a row as needing review (used by the "review required" filter). */
export const REVIEW_WARNING_CODES = Object.entries(WARNINGS)
  .filter(([, w]) => w.review)
  .map(([k]) => k);

export function needsReview(warnings: readonly string[]): boolean {
  return warnings.some((w) => warningInfo(w).review);
}

// ---------------------------------------------------------------------------
// Value validity
// ---------------------------------------------------------------------------

export function validPositive(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export function statusKey(s: string | null | undefined): StatusKey {
  return s === "available" || s === "sold" || s === "reserved" || s === "other" ? s : "missing";
}

export function rowPsf(r: Pick<AnalyticsRow, "listedPriceAED" | "areaSqFt">): number | null {
  return validPositive(r.listedPriceAED) && validPositive(r.areaSqFt) ? pricePerSqFt(r.listedPriceAED, r.areaSqFt) : null;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

export interface DedupResult {
  /** One record per distinct unit, in source order. Conflicting units are not included. */
  analysisSet: AnalyticsRow[];
  distinctUnits: number;
  /** Extra rows beyond the first for units whose duplicates are identical. */
  duplicateRowsCollapsed: number;
  /** Units listed more than once with differing price, size or status. */
  conflictingUnits: number;
  conflictingRows: number;
  conflictingUnitNumbers: string[];
}

const unitGroupKey = (r: AnalyticsRow) => `${r.snapshotId}|${r.projectId ?? r.projectName ?? "none"}|${r.unitKey ?? `row:${r.id}`}`;

export function dedupeUnits(rows: readonly AnalyticsRow[]): DedupResult {
  const ordered = [...rows].sort((a, b) => a.sourcePage - b.sourcePage || a.lineIndex - b.lineIndex);
  const groups = new Map<string, AnalyticsRow[]>();
  for (const r of ordered) {
    const k = unitGroupKey(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const analysisSet: AnalyticsRow[] = [];
  let duplicateRowsCollapsed = 0;
  let conflictingUnits = 0;
  let conflictingRows = 0;
  const conflictingUnitNumbers: string[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) {
      analysisSet.push(g[0]);
      continue;
    }
    const sig = (r: AnalyticsRow) => `${r.listedPriceAED ?? ""}|${r.areaSqFt ?? ""}|${r.statusNormalized ?? ""}`;
    if (new Set(g.map(sig)).size === 1) {
      analysisSet.push(g[0]);
      duplicateRowsCollapsed += g.length - 1;
    } else {
      conflictingUnits++;
      conflictingRows += g.length;
      conflictingUnitNumbers.push(g[0].unitNumber ?? g[0].unitKey ?? g[0].id);
    }
  }
  return { analysisSet, distinctUnits: groups.size, duplicateRowsCollapsed, conflictingUnits, conflictingRows, conflictingUnitNumbers };
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

export interface Band {
  label: string;
  /** Inclusive lower bound. */
  min: number;
  /** Exclusive upper bound (null = open-ended). */
  max: number | null;
  count: number;
}

export const PRICE_BANDS: Array<[number, number | null, string]> = [
  [0, 1_000_000, "< 1M"],
  [1_000_000, 1_500_000, "1–1.5M"],
  [1_500_000, 2_000_000, "1.5–2M"],
  [2_000_000, 3_000_000, "2–3M"],
  [3_000_000, 5_000_000, "3–5M"],
  [5_000_000, 10_000_000, "5–10M"],
  [10_000_000, 20_000_000, "10–20M"],
  [20_000_000, null, "20M +"],
];

export const SIZE_BANDS: Array<[number, number | null, string]> = [
  [0, 500, "< 500"],
  [500, 750, "500–750"],
  [750, 1_000, "750–1,000"],
  [1_000, 1_500, "1,000–1,500"],
  [1_500, 2_500, "1,500–2,500"],
  [2_500, 4_000, "2,500–4,000"],
  [4_000, null, "4,000 +"],
];

export function bandCounts(values: readonly number[], bands: Array<[number, number | null, string]>): Band[] {
  const out = bands.map(([min, max, label]) => ({ label, min, max, count: 0 }));
  for (const v of values) {
    const b = out.find((x) => v >= x.min && (x.max == null || v < x.max));
    if (b) b.count++;
  }
  return out;
}

export function bandFor(v: number, bands: Array<[number, number | null, string]>): string | null {
  const b = bands.find(([min, max]) => v >= min && (max == null || v < max));
  return b ? b[2] : null;
}

/** A 1/2/2.5/5 × 10^k step giving about `target` bins over [min, max]. */
export function niceStep(min: number, max: number, target = 10): number {
  const span = max - min;
  if (!(span > 0)) return 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  const mult = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return mult * pow;
}

/** Equal-width histogram with nice bin edges; every value lands in exactly one bin. */
export function histogram(values: readonly number[], target = 10): Band[] {
  if (values.length === 0) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === hi) return [{ label: fmtEdge(lo), min: lo, max: null, count: values.length }];
  const step = niceStep(lo, hi, target);
  const start = Math.floor(lo / step) * step;
  const n = Math.max(1, Math.floor((hi - start) / step) + 1);
  const bins: Band[] = Array.from({ length: n }, (_, i) => {
    const min = start + i * step;
    return { label: `${fmtEdge(min)}–${fmtEdge(min + step)}`, min, max: min + step, count: 0 };
  });
  for (const v of values) bins[Math.min(n - 1, Math.floor((v - start) / step))].count++;
  return bins;
}

function fmtEdge(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Outliers
// ---------------------------------------------------------------------------

export const OUTLIER_MIN_SAMPLE = 8;
export const OUTLIER_K = 1.5;

export interface OutlierResult {
  n: number;
  q1: number | null;
  q3: number | null;
  lower: number | null;
  upper: number | null;
  ids: string[];
}

/** Tukey fences: values below Q1 − 1.5·IQR or above Q3 + 1.5·IQR. Needs at least 8 values. */
export function tukeyOutliers(items: ReadonlyArray<{ id: string; value: number }>): OutlierResult {
  const s = summarize(items.map((i) => i.value));
  if (s.n < OUTLIER_MIN_SAMPLE || s.p25 == null || s.p75 == null) return { n: s.n, q1: s.p25, q3: s.p75, lower: null, upper: null, ids: [] };
  const iqr = s.p75 - s.p25;
  const lower = s.p25 - OUTLIER_K * iqr;
  const upper = s.p75 + OUTLIER_K * iqr;
  return { n: s.n, q1: s.p25, q3: s.p75, lower, upper, ids: items.filter((i) => i.value < lower || i.value > upper).map((i) => i.id) };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export type StatusCounts = Record<StatusKey, number>;

export interface GroupSummary {
  key: string;
  label: string;
  /** Accepted records in the group. */
  records: number;
  /** Distinct units in the analysis set (conflicting units excluded). */
  units: number;
  status: StatusCounts;
  price: Summary;
  psf: Summary;
  area: Summary;
  listedValue: number;
  /** Most common typologies within the group (records), descending. */
  typologies: Array<{ label: string; count: number }>;
}

export interface Coverage {
  records: number;
  withPrice: number;
  withArea: number;
  withPsf: number;
  withStatus: number;
  withProject: number;
  withTypology: number;
  reviewRequired: number;
  warnings: Array<{ code: string; count: number; info: WarningInfo }>;
}

export interface InventoryAnalytics {
  records: number;
  dedup: Omit<DedupResult, "analysisSet">;
  status: StatusCounts;
  /** Sum of valid listed prices over the analysis set. Not revenue and not transaction value. */
  listedValue: { sum: number; units: number; excludedNoPrice: number };
  price: Summary;
  psf: Summary;
  area: Summary;
  priceBands: Band[];
  sizeBands: Band[];
  psfHistogram: Band[];
  projects: GroupSummary[];
  typologies: GroupSummary[];
  unitTypes: GroupSummary[];
  sizeBandGroups: GroupSummary[];
  coverage: Coverage;
  psfOutliers: OutlierResult;
}

function emptyStatus(): StatusCounts {
  return { available: 0, sold: 0, reserved: 0, other: 0, missing: 0 };
}

function topCounts(values: Array<string | null>, limit: number) {
  const m = new Map<string, number>();
  for (const v of values) {
    const k = v ?? "Not recorded";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function summarizeGroup(key: string, label: string, records: AnalyticsRow[], analysis: AnalyticsRow[]): GroupSummary {
  const status = emptyStatus();
  for (const r of records) status[statusKey(r.statusNormalized)]++;
  const prices = analysis.map((r) => r.listedPriceAED).filter(validPositive);
  return {
    key,
    label,
    records: records.length,
    units: analysis.length,
    status,
    price: summarize(prices),
    psf: summarize(analysis.map(rowPsf)),
    area: summarize(analysis.map((r) => r.areaSqFt).filter(validPositive)),
    listedValue: prices.reduce((s, p) => s + p, 0),
    typologies: topCounts(records.map((r) => r.typology), 4),
  };
}

function groupBy(records: readonly AnalyticsRow[], analysis: readonly AnalyticsRow[], keyOf: (r: AnalyticsRow) => { key: string; label: string } | null): GroupSummary[] {
  const rec = new Map<string, { label: string; rows: AnalyticsRow[]; analysis: AnalyticsRow[] }>();
  for (const r of records) {
    const k = keyOf(r);
    if (!k) continue;
    const g = rec.get(k.key) ?? { label: k.label, rows: [], analysis: [] };
    g.rows.push(r);
    rec.set(k.key, g);
  }
  for (const r of analysis) {
    const k = keyOf(r);
    if (k) rec.get(k.key)?.analysis.push(r);
  }
  return [...rec.entries()]
    .map(([key, g]) => summarizeGroup(key, g.label, g.rows, g.analysis))
    .sort((a, b) => b.records - a.records || a.label.localeCompare(b.label));
}

export const projectKeyOf = (r: AnalyticsRow) => ({ key: r.projectId ?? "none", label: r.projectName ?? "No project recorded" });

export function computeInventoryAnalytics(rows: readonly AnalyticsRow[]): InventoryAnalytics {
  const { analysisSet, ...dedup } = dedupeUnits(rows);
  const status = emptyStatus();
  for (const r of rows) status[statusKey(r.statusNormalized)]++;

  const prices = analysisSet.map((r) => r.listedPriceAED).filter(validPositive);
  const areas = analysisSet.map((r) => r.areaSqFt).filter(validPositive);
  const psfItems = analysisSet.flatMap((r) => {
    const v = rowPsf(r);
    return v == null ? [] : [{ id: r.id, value: v }];
  });

  const warningCounts = new Map<string, number>();
  for (const r of rows) for (const w of new Set(r.validationWarnings)) warningCounts.set(w, (warningCounts.get(w) ?? 0) + 1);

  return {
    records: rows.length,
    dedup,
    status,
    listedValue: { sum: prices.reduce((s, p) => s + p, 0), units: prices.length, excludedNoPrice: analysisSet.length - prices.length },
    price: summarize(prices),
    psf: summarize(psfItems.map((p) => p.value)),
    area: summarize(areas),
    priceBands: bandCounts(prices, PRICE_BANDS),
    sizeBands: bandCounts(areas, SIZE_BANDS),
    psfHistogram: histogram(psfItems.map((p) => p.value), 10),
    projects: groupBy(rows, analysisSet, projectKeyOf),
    typologies: groupBy(rows, analysisSet, (r) => ({ key: r.typology ?? "none", label: r.typology ?? "Not recorded" })),
    unitTypes: groupBy(rows, analysisSet, (r) => ({ key: r.unitType ?? "none", label: r.unitType ?? "Not recorded" })),
    sizeBandGroups: groupBy(rows, analysisSet, (r) => {
      const label = validPositive(r.areaSqFt) ? bandFor(r.areaSqFt, SIZE_BANDS) : null;
      return label ? { key: label, label } : null;
    }).sort((a, b) => SIZE_BANDS.findIndex((s) => s[2] === a.key) - SIZE_BANDS.findIndex((s) => s[2] === b.key)),
    coverage: {
      records: rows.length,
      withPrice: rows.filter((r) => validPositive(r.listedPriceAED)).length,
      withArea: rows.filter((r) => validPositive(r.areaSqFt)).length,
      withPsf: rows.filter((r) => rowPsf(r) != null).length,
      withStatus: rows.filter((r) => r.statusNormalized != null).length,
      withProject: rows.filter((r) => r.projectId != null).length,
      withTypology: rows.filter((r) => r.typology != null).length,
      reviewRequired: rows.filter((r) => needsReview(r.validationWarnings)).length,
      warnings: [...warningCounts.entries()]
        .map(([code, count]) => ({ code, count, info: warningInfo(code) }))
        .sort((a, b) => Number(b.info.review) - Number(a.info.review) || b.count - a.count),
    },
    psfOutliers: tukeyOutliers(psfItems),
  };
}

// ---------------------------------------------------------------------------
// Deterministic insights
// ---------------------------------------------------------------------------

/** Minimum priced units per group before a group's median or spread is compared with others. */
export const COMPARISON_MIN_SAMPLE = 10;

export interface Insight {
  id: string;
  title: string;
  detail: string;
  /** Sample statement, e.g. "n = 346 records". */
  sample: string;
  caveat?: string;
  tone: "neutral" | "warn";
  href?: string;
}

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
const int = (v: number) => Math.round(v).toLocaleString("en-US");
const aedM = (v: number) => `AED ${(v / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;

export interface InsightContext {
  snapshotDateKnown: boolean;
  rejectedRecords: number;
  pagesWithoutText: number | null;
  /** Builds a link to the Inventory Explorer with the given filters. */
  inventoryHref: (params: Record<string, string>) => string;
}

export function deriveInsights(a: InventoryAnalytics, ctx: InsightContext): Insight[] {
  const out: Insight[] = [];
  if (a.records === 0) return out;

  const linked = a.projects.filter((p) => p.key !== "none");
  const top = linked[0];
  if (top) {
    out.push({
      id: "most_records",
      title: `${top.label} has the most imported unit records`,
      detail: `${int(top.records)} of ${int(a.records)} accepted records (${pct(top.records, a.records)}).`,
      sample: `n = ${int(a.records)} records across ${linked.length} linked project names`,
      caveat: "Reflects what the supplied document lists and what extraction could read, not the project's total size.",
      tone: "neutral",
      href: ctx.inventoryHref({ project: top.key }),
    });
  }

  const comparable = linked.filter((p) => p.price.n >= COMPARISON_MIN_SAMPLE && p.price.median != null);
  if (comparable.length >= 2) {
    const best = [...comparable].sort((x, y) => (y.price.median ?? 0) - (x.price.median ?? 0))[0];
    out.push({
      id: "highest_median_price",
      title: `${best.label} has the highest median listed price`,
      detail: `${aedM(best.price.median!)} median across ${int(best.price.n)} priced units (compared with ${comparable.length - 1} other project(s) with ≥ ${COMPARISON_MIN_SAMPLE} priced units).`,
      sample: `n = ${int(best.price.n)} priced units`,
      caveat: "Projects differ in unit mix (studios vs. villas); a higher median does not mean higher value per sq ft.",
      tone: "neutral",
      href: ctx.inventoryHref({ project: best.key, sort: "listedPriceAED", dir: "desc" }),
    });
    const spread = comparable
      .filter((p) => p.psf.n >= COMPARISON_MIN_SAMPLE && p.psf.p25 != null && p.psf.p75 != null)
      .map((p) => ({ p, iqr: p.psf.p75! - p.psf.p25! }))
      .sort((x, y) => y.iqr - x.iqr)[0];
    if (spread) {
      out.push({
        id: "widest_psf_spread",
        title: `${spread.p.label} shows the widest AED/sq ft spread`,
        detail: `Interquartile range AED ${int(spread.p.psf.p25!)}–${int(spread.p.psf.p75!)} per sq ft (width ${int(spread.iqr)}).`,
        sample: `n = ${int(spread.p.psf.n)} units with price and size`,
        caveat: "A wide spread usually reflects a mixed unit mix (views, floors, types) rather than inconsistent pricing.",
        tone: "neutral",
        href: `/pricing?project=${spread.p.key}`,
      });
    }
  }

  const topTypology = a.typologies.find((t) => t.key !== "none");
  if (topTypology) {
    out.push({
      id: "most_common_typology",
      title: `“${topTypology.label}” is the most common typology`,
      detail: `${int(topTypology.records)} records (${pct(topTypology.records, a.records)}) carry this typology as written in the document.`,
      sample: `n = ${int(a.records)} records; ${int(a.records - a.coverage.withTypology)} without a typology`,
      caveat: "Typology labels are used exactly as printed; similar labels are not merged.",
      tone: "neutral",
      href: ctx.inventoryHref({ typology: topTypology.key }),
    });
  }

  out.push({
    id: "available_share",
    title: `${pct(a.status.available, a.records)} of records are labelled available`,
    detail: `${int(a.status.available)} available · ${int(a.status.sold)} sold · ${int(a.status.reserved)} reserved · ${int(a.status.other)} unrecognized · ${int(a.status.missing)} without status.`,
    sample: `n = ${int(a.records)} records`,
    caveat: ctx.snapshotDateKnown
      ? "Labels are as printed on the document's own date, not current availability."
      : "The document has no printed date, so these labels cannot be placed in time and do not show current availability.",
    tone: a.status.sold === 0 && a.status.available > 0 ? "warn" : "neutral",
    href: ctx.inventoryHref({ status: "available" }),
  });

  const gaps: string[] = [];
  const noPrice = a.records - a.coverage.withPrice;
  const noArea = a.records - a.coverage.withArea;
  if (noPrice > 0) gaps.push(`${int(noPrice)} records without a usable price`);
  if (noArea > 0) gaps.push(`${int(noArea)} without a usable size`);
  if (ctx.rejectedRecords > 0) gaps.push(`${int(ctx.rejectedRecords)} extracted lines rejected or unplaced`);
  if (ctx.pagesWithoutText) gaps.push(`${int(ctx.pagesWithoutText)} PDF pages without a text layer (not read)`);
  if (!ctx.snapshotDateKnown) gaps.push("no printed snapshot date");
  if (gaps.length) {
    out.push({
      id: "data_gaps",
      title: "Data gaps limit the analysis",
      detail: `${gaps.join("; ")}.`,
      sample: `n = ${int(a.records)} accepted records`,
      caveat: "Gaps are excluded from calculations and listed on Data Quality; nothing is estimated to fill them.",
      tone: "warn",
      href: "/quality",
    });
  }
  return out;
}
