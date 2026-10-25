import { describe, expect, it } from "vitest";
import { csvCell, parseCsvPreview } from "@/lib/csv";
import { checkUaeCoordinates } from "@/lib/geo";
import {
  bandCounts,
  computeInventoryAnalytics,
  dedupeUnits,
  deriveInsights,
  histogram,
  needsReview,
  niceStep,
  PRICE_BANDS,
  rowPsf,
  tukeyOutliers,
  warningInfo,
  type AnalyticsRow,
} from "@/lib/inventory-analytics";
import { href } from "@/lib/url";

let seq = 0;
function row(p: Partial<AnalyticsRow>): AnalyticsRow {
  seq++;
  return {
    id: `r${seq}`,
    snapshotId: "s1",
    projectId: "p1",
    projectName: "Alphaz",
    unitKey: `U-${seq}`,
    unitNumber: `U-${seq}`,
    typology: "1 BED",
    unitType: "Apartment",
    areaSqFt: 1000,
    listedPriceAED: 1_000_000,
    statusNormalized: "available",
    validationWarnings: [],
    sourcePage: 1,
    lineIndex: seq,
    ...p,
  };
}

describe("validity and price per sq ft", () => {
  it("computes AED/sq ft only for positive price and area", () => {
    expect(rowPsf({ listedPriceAED: 1_500_000, areaSqFt: 1000 })).toBe(1500);
    expect(rowPsf({ listedPriceAED: 0, areaSqFt: 1000 })).toBeNull();
    expect(rowPsf({ listedPriceAED: 1_000_000, areaSqFt: 0 })).toBeNull();
    expect(rowPsf({ listedPriceAED: null, areaSqFt: 900 })).toBeNull();
    expect(rowPsf({ listedPriceAED: Number.NaN, areaSqFt: 900 })).toBeNull();
  });
});

describe("deduplication", () => {
  it("collapses identical duplicates, excludes conflicting ones and keeps units distinct across projects and snapshots", () => {
    const rows = [
      row({ unitKey: "A-1", unitNumber: "A-1" }),
      row({ unitKey: "A-1", unitNumber: "A-1" }), // identical duplicate
      row({ unitKey: "B-1", unitNumber: "B-1", listedPriceAED: 600_000 }),
      row({ unitKey: "B-1", unitNumber: "B-1", listedPriceAED: 650_000 }), // conflicting duplicate
      row({ unitKey: "A-1", unitNumber: "A-1", projectId: "p2", projectName: "Betaz" }), // same number, other project
      row({ unitKey: "A-1", unitNumber: "A-1", snapshotId: "s2" }), // same unit, other snapshot
    ];
    const d = dedupeUnits(rows);
    expect(d.distinctUnits).toBe(4);
    expect(d.duplicateRowsCollapsed).toBe(1);
    expect(d.conflictingUnits).toBe(1);
    expect(d.conflictingRows).toBe(2);
    expect(d.conflictingUnitNumbers).toEqual(["B-1"]);
    expect(d.analysisSet).toHaveLength(3);
  });
});

describe("computeInventoryAnalytics", () => {
  const rows = [
    row({ listedPriceAED: 1_000_000, areaSqFt: 1000, statusNormalized: "available" }),
    row({ listedPriceAED: 2_100_000, areaSqFt: 1500, statusNormalized: "sold", typology: "2 BED" }),
    row({ listedPriceAED: 1_200_000, areaSqFt: 800, statusNormalized: "available" }),
    row({ listedPriceAED: null, areaSqFt: 700, statusNormalized: null, validationWarnings: ["price_missing", "status_missing"] }),
    row({ listedPriceAED: 900_000, areaSqFt: null, statusNormalized: "other", validationWarnings: ["area_missing", "wrapped_text_joined"], projectId: null, projectName: null }),
  ];
  const a = computeInventoryAnalytics(rows);

  it("counts records and status labels per record", () => {
    expect(a.records).toBe(5);
    expect(a.status).toEqual({ available: 2, sold: 1, reserved: 0, other: 1, missing: 1 });
  });

  it("sums listed value over valid prices only and reports the exclusion", () => {
    expect(a.listedValue.sum).toBe(5_200_000);
    expect(a.listedValue.units).toBe(4);
    expect(a.listedValue.excludedNoPrice).toBe(1);
  });

  it("uses exact medians and quartiles", () => {
    // prices 0.9M, 1.0M, 1.2M, 2.1M -> median 1.1M; p25 = 0.975M; p75 = 1.425M
    expect(a.price.median).toBe(1_100_000);
    expect(a.price.p25).toBe(975_000);
    expect(a.price.p75).toBe(1_425_000);
    // psf 1000, 1400, 1500 -> median 1400
    expect(a.psf.median).toBe(1400);
    expect(a.psf.n).toBe(3);
  });

  it("reports coverage and review-required records", () => {
    expect(a.coverage).toMatchObject({ records: 5, withPrice: 4, withArea: 4, withPsf: 3, withStatus: 4, withProject: 4, reviewRequired: 2 });
    expect(a.coverage.warnings.find((w) => w.code === "wrapped_text_joined")?.info.review).toBe(false);
  });

  it("groups by project, keeping unlinked records separate", () => {
    expect(a.projects.map((p) => [p.key, p.records])).toEqual([
      ["p1", 4],
      ["none", 1],
    ]);
    expect(a.projects[0].listedValue).toBe(4_300_000);
  });

  it("returns zeros and nulls, never invented values, for no rows", () => {
    const e = computeInventoryAnalytics([]);
    expect(e.records).toBe(0);
    expect(e.price.median).toBeNull();
    expect(e.listedValue.sum).toBe(0);
    expect(e.projects).toEqual([]);
    expect(e.psfHistogram).toEqual([]);
    expect(deriveInsights(e, { snapshotDateKnown: false, rejectedRecords: 0, pagesWithoutText: null, inventoryHref: () => "/" })).toEqual([]);
  });
});

describe("distributions", () => {
  it("puts every value in exactly one fixed band (lower bound inclusive)", () => {
    const bands = bandCounts([999_999, 1_000_000, 1_499_999, 25_000_000], PRICE_BANDS);
    expect(bands.find((b) => b.label === "< 1M")?.count).toBe(1);
    expect(bands.find((b) => b.label === "1–1.5M")?.count).toBe(2);
    expect(bands.find((b) => b.label === "20M +")?.count).toBe(1);
    expect(bands.reduce((s, b) => s + b.count, 0)).toBe(4);
  });

  it("builds nice equal-width histogram bins covering all values", () => {
    expect(niceStep(1500, 6000, 10)).toBe(500);
    const h = histogram([1506, 2000, 2473, 3300, 6064]);
    expect(h[0].min).toBe(1500);
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(5);
    expect(histogram([7, 7, 7])).toHaveLength(1);
  });
});

describe("outliers", () => {
  it("applies Tukey fences and needs at least 8 values", () => {
    const items = [100, 102, 104, 106, 108, 110, 112, 500].map((value, i) => ({ id: `x${i}`, value }));
    const o = tukeyOutliers(items);
    expect(o.ids).toEqual(["x7"]);
    expect(tukeyOutliers(items.slice(0, 7)).ids).toEqual([]);
  });
});

describe("warnings", () => {
  it("explains known and page-specific warning codes", () => {
    expect(warningInfo("price_missing").review).toBe(true);
    expect(warningInfo("header_from_page_29").label).toBe("Header from p.29");
    expect(needsReview(["wrapped_text_joined", "header_from_page_3"])).toBe(false);
    expect(needsReview(["status_unrecognized"])).toBe(true);
  });
});

describe("insights", () => {
  it("states samples, caveats and an unknown-date warning; no comparison below the minimum sample", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ projectId: "big", projectName: "Big", listedPriceAED: 1_000_000 + i * 10_000 }));
    rows.push(...Array.from({ length: 3 }, () => row({ projectId: "small", projectName: "Small", listedPriceAED: 9_000_000 })));
    const ins = deriveInsights(computeInventoryAnalytics(rows), { snapshotDateKnown: false, rejectedRecords: 4, pagesWithoutText: 2, inventoryHref: (p) => href("/inventory", p) });
    const ids = ins.map((i) => i.id);
    expect(ids).toContain("most_records");
    expect(ids).not.toContain("highest_median_price"); // only one project has >= 10 priced units
    const avail = ins.find((i) => i.id === "available_share")!;
    expect(avail.caveat).toMatch(/no printed date/);
    expect(ins.find((i) => i.id === "data_gaps")!.detail).toMatch(/4 extracted lines rejected or unplaced; 2 PDF pages/);
    expect(ins.every((i) => i.sample.startsWith("n = "))).toBe(true);
    expect(ins.find((i) => i.id === "most_records")!.href).toBe("/inventory?project=big");
  });
});

describe("coordinates", () => {
  it("accepts UAE positions and rejects swapped, foreign or empty input", () => {
    expect(checkUaeCoordinates("25.0657", "55.1713")).toEqual({ ok: true, lat: 25.0657, lng: 55.1713 });
    expect(checkUaeCoordinates("55.1713", "25.0657")).toMatchObject({ ok: false, reason: expect.stringMatching(/swapped/) });
    expect(checkUaeCoordinates("51.5", "-0.12")).toMatchObject({ ok: false, reason: expect.stringMatching(/outside the UAE/) });
    expect(checkUaeCoordinates("", "55")).toMatchObject({ ok: false });
    expect(checkUaeCoordinates("abc", "55")).toMatchObject({ ok: false });
  });
});

describe("csv", () => {
  it("quotes cells and neutralises spreadsheet formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(null)).toBe("");
  });

  it("parses a preview with quotes, CRLF, BOM and a truncated last line", () => {
    const text = '﻿Transaction Number,Amount\r\n"T-1","1,000"\r\nT-2,2000\r\nT-3,30';
    expect(parseCsvPreview(text, 10)).toEqual([
      ["Transaction Number", "Amount"],
      ["T-1", "1,000"],
      ["T-2", "2000"],
      ["T-3", "30"],
    ]);
    expect(parseCsvPreview(text, 10, true)).toHaveLength(3);
  });
});
