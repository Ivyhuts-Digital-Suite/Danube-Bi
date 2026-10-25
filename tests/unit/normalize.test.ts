import { describe, expect, it } from "vitest";
import {
  editDistance,
  escapeRegex,
  normalizeName,
  normalizeUnitNumber,
  parseDateOnly,
  parseNumber,
  pricePerSqFt,
  SQFT_PER_SQM,
  sqmToSqft,
} from "@/lib/normalize";
import { median, quantile, summarize } from "@/lib/stats";

describe("parseNumber", () => {
  it.each([
    ["1,234,567", 1234567],
    ["AED 1,234,567.00", 1234567],
    ["1234567", 1234567],
    ["850.5 sq.ft", 850.5],
    ["  2,000  ", 2000],
    ["AED1,050,000", 1050000],
  ])("parses %s", (raw, expected) => expect(parseNumber(raw)).toBe(expected));

  it.each(["", "-", "N/A", "1,000 - 2,000", "1,00,000", "abc", "12a", "-500"])("rejects %s", (raw) => expect(parseNumber(raw)).toBeNull());

  it("passes finite numbers through", () => {
    expect(parseNumber(12)).toBe(12);
    expect(parseNumber(Number.NaN)).toBeNull();
  });
});

describe("area and price per square foot", () => {
  it("uses the exact international-foot factor", () => {
    expect(SQFT_PER_SQM).toBeCloseTo(10.7639104167, 9);
    expect(sqmToSqft(100)).toBeCloseTo(1076.39104167, 6);
  });
  it("computes price per sq ft only with a positive area", () => {
    expect(pricePerSqFt(1_000_000, 500)).toBe(2000);
    expect(pricePerSqFt(1_000_000, 0)).toBeNull();
    expect(pricePerSqFt(null, 500)).toBeNull();
    expect(pricePerSqFt(1_000_000, null)).toBeNull();
  });
});

describe("names and unit numbers", () => {
  it("normalizes project names for exact matching only", () => {
    expect(normalizeName("Bayz 101")).toBe("bayz101");
    expect(normalizeName("BAYZ101")).toBe("bayz101");
    expect(normalizeName("Bayz 102")).not.toBe(normalizeName("Bayz 101"));
    expect(normalizeName("Elitz 2")).not.toBe(normalizeName("Elitz"));
  });
  it("normalizes unit numbers", () => {
    expect(normalizeUnitNumber(" b-1204 ")).toBe("B-1204");
    expect(normalizeUnitNumber("B 1204")).toBe("B1204");
  });
  it("escapes regex metacharacters", () => {
    expect(new RegExp(escapeRegex("a.b(c)")).test("a.b(c)")).toBe(true);
    expect(new RegExp(escapeRegex("a.b")).test("axb")).toBe(false);
  });
  it("computes edit distance", () => {
    expect(editDistance("serenz", "serenz")).toBe(0);
    expect(editDistance("serenz", "serens")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("parseDateOnly", () => {
  const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
  it.each([
    ["2024-03-05", "2024-03-05"],
    ["2024-03-05 00:00:00", "2024-03-05"],
    ["05-03-2024", "2024-03-05"],
    ["05/03/2024", "2024-03-05"],
    ["5 March 2024", "2024-03-05"],
    ["5th Mar 2024", "2024-03-05"],
    ["March 5, 2024", "2024-03-05"],
    ["Sept 5, 2024", "2024-09-05"],
  ])("parses %s day-first / ISO", (raw, expected) => expect(iso(parseDateOnly(raw))).toBe(expected));

  it.each(["31-02-2024", "2024-13-01", "", "yesterday", "13/13/2024", "5 Foo 2024"])("rejects %s", (raw) => expect(parseDateOnly(raw)).toBeNull());

  it("returns UTC midnight so the calendar day never shifts", () => {
    const d = parseDateOnly("01-01-2025")!;
    expect(d.getUTCHours()).toBe(0);
    expect(d.toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });
});

describe("statistics", () => {
  it("computes type-7 quantiles", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(median([])).toBeNull();
    expect(median([null, undefined, 4])).toBe(4);
  });
  it("summarizes", () => {
    expect(summarize([10, 20, 30])).toEqual({ n: 3, min: 10, p25: 15, median: 20, p75: 25, max: 30, mean: 20 });
    expect(summarize([]).n).toBe(0);
  });
});
