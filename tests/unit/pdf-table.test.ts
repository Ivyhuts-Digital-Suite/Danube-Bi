import { describe, expect, it } from "vitest";
import { normalizeInventoryRow, normalizeStatus } from "@/server/ingest/inventory-rows";
import {
  buildProjectNameMatcher,
  classifyHeaderCell,
  detectSnapshotDate,
  extractInventoryTable,
  groupLines,
} from "@/server/ingest/pdf-table";
import { readPdfText } from "@/server/ingest/pdf-text";
import { makePdf, tablePage } from "../fixtures/make-pdf";

// Synthetic test layout (not real Danube data).
const COLS = [
  { x: 30, header: "S.No" },
  { x: 70, header: "Project" },
  { x: 150, header: "Unit No" },
  { x: 220, header: "Unit Type" },
  { x: 300, header: "Typology" },
  { x: 380, header: "Size (Sq.Ft)" },
  { x: 460, header: "View" },
  { x: 560, header: "Price (AED)" },
  { x: 660, header: "Status" },
];

describe("header classification", () => {
  it.each([
    ["S.No", "serialNumber"],
    ["Sr. No.", "serialNumber"],
    ["Unit No", "unitNumber"],
    ["Unit Number", "unitNumber"],
    ["Unit Type", "unitType"],
    ["Typology", "typology"],
    ["Bedrooms", "typology"],
    ["Size (Sq.Ft)", "areaSqFt"],
    ["Area (sq ft)", "areaSqFt"],
    ["Total Area", "areaSqFt"],
    ["View", "view"],
    ["Price (AED)", "listedPriceAED"],
    ["Selling Price", "listedPriceAED"],
    ["Status", "status"],
    ["Project", "project"],
  ])("%s -> %s", (text, field) => expect(classifyHeaderCell(text)).toBe(field));

  it("does not classify unrelated text", () => {
    expect(classifyHeaderCell("Welcome to Dubai")).toBeNull();
  });
});

describe("groupLines", () => {
  it("groups by y and sorts by x", () => {
    const lines = groupLines([
      { str: "b", x: 50, y: 100, width: 5, height: 9 },
      { str: "a", x: 10, y: 101, width: 5, height: 9 },
      { str: "c", x: 10, y: 80, width: 5, height: 9 },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["a b", "c"]);
  });
});

describe("extractInventoryTable (real PDF bytes)", () => {
  it("extracts rows, carries the header across pages, joins wrapped text and records unplaced lines", async () => {
    const pdf = makePdf([
      tablePage(
        COLS,
        [
          ["1", "Testz Tower", "A-101", "Apartment", "1 BR", "750", "Pool", "1,200,000", "Available"],
          ["2", "Testz Tower", "A-102", "Apartment", "2 BR", "1,100", "Garden and", "1,650,000", "Sold"],
          ["", "", "", "", "", "", "Pool", "", ""],
        ],
        { title: "Inventory as of 12-03-2026" },
      ),
      // Continuation page without its own header.
      {
        texts: [
          { x: 30, y: 520, text: "3" },
          { x: 70, y: 520, text: "Testz Tower" },
          { x: 150, y: 520, text: "A-103" },
          { x: 220, y: 520, text: "Apartment" },
          { x: 380, y: 520, text: "800" },
          { x: 560, y: 520, text: "1,250,000" },
          { x: 660, y: 520, text: "Booked" },
          { x: 30, y: 480, text: "Total 4,100,000" },
          { x: 30, y: 40, text: "Page 2" },
        ],
      },
    ]);
    const text = await readPdfText(pdf);
    const t = extractInventoryTable(text.pages);
    expect(t.headerLayouts).toHaveLength(1);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0].values).toMatchObject({ unitNumber: "A-101", listedPriceAED: "1,200,000", status: "Available", project: "Testz Tower" });
    expect(t.rows[1].values.view).toBe("Garden and Pool");
    expect(t.rows[1].notes).toContain("wrapped_text_joined");
    expect(t.rows[2].notes).toContain("header_from_page_1");
    expect(t.unplaced.map((u) => u.text)).toEqual(["Total 4,100,000"]);
    expect(t.pagesWithTable).toEqual([1, 2]);
  });

  it("uses a section heading as the project when there is no project column", async () => {
    const cols = COLS.filter((c) => c.header !== "Project");
    const pdf = makePdf([tablePage(cols, [["1", "B-1", "Apartment", "Studio", "400", "City", "700,000", "Available"]], { title: "SAMPLEZ BY DANUBE" })]);
    const text = await readPdfText(pdf);
    const matcher = buildProjectNameMatcher(["Samplez"]);
    const t = extractInventoryTable(text.pages, (s) => {
      const f = [...new Set(matcher(s))];
      return f.length === 1 ? f[0] : null;
    });
    expect(t.rows[0].values.project).toBe("Samplez");
    expect(t.rows[0].notes).toContain("project_from_section_heading");
  });

  it("reports pages without a text layer", async () => {
    const text = await readPdfText(makePdf([{ texts: [], noText: true }]));
    const t = extractInventoryTable(text.pages);
    expect(t.pagesWithoutText).toEqual([1]);
    expect(t.rows).toHaveLength(0);
  });
});

describe("detectSnapshotDate", () => {
  const page = (lines: string[]) => ({ page: 1, width: 842, height: 595, items: lines.map((s, i) => ({ str: s, x: 10, y: 500 - i * 20, width: 100, height: 9 })) });
  it("finds a labelled date", () => {
    const r = detectSnapshotDate([page(["Inventory as of 12-03-2026"])]);
    expect(r.status).toBe("from_document");
    expect(r.date?.toISOString().slice(0, 10)).toBe("2026-03-12");
  });
  it("is unknown without a labelled date (never uses import time)", () => {
    const r = detectSnapshotDate([page(["Price list", "Handover 2027"])]);
    expect(r).toMatchObject({ status: "unknown", date: null });
  });
  it("is ambiguous when different dates are printed", () => {
    const r = detectSnapshotDate([page(["Updated on 01-02-2026", "As of 05-02-2026"])]);
    expect(r.status).toBe("ambiguous");
    expect(r.date).toBeNull();
  });
});

describe("normalizeInventoryRow", () => {
  const base = { page: 1, lineIndex: 3, lineText: "x", notes: [] as string[] };
  it("normalizes a complete row and keeps original values", () => {
    const r = normalizeInventoryRow({ ...base, values: { unitNumber: "a-101 ", listedPriceAED: "1,200,000", areaSqFt: "750", status: "Available", project: "Testz" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.unitKey).toBe("A-101");
    expect(r.value.pricePerSqFt).toBe(1600);
    expect(r.value.statusNormalized).toBe("available");
    expect(r.value.originalValues.listedPriceAED).toBe("1,200,000");
    expect(r.value.validationWarnings).toEqual([]);
  });
  it("keeps rows with missing price but warns", () => {
    const r = normalizeInventoryRow({ ...base, values: { unitNumber: "A-1", status: "Sold", areaSqFt: "500", project: "P" } });
    expect(r.ok && r.value.validationWarnings).toContain("price_missing");
    expect(r.ok && r.value.pricePerSqFt).toBeNull();
  });
  it("converts sq m areas explicitly", () => {
    const r = normalizeInventoryRow({ ...base, notes: ["area_in_sqm"], values: { unitNumber: "A-1", areaSqFt: "100", listedPriceAED: "1,000,000", status: "Available", project: "P" } });
    expect(r.ok && r.value.areaSqFt).toBeCloseTo(1076.391, 2);
    expect(r.ok && r.value.validationWarnings).toContain("area_converted_from_sqm");
  });
  it("rejects rows without a unit number", () => {
    const r = normalizeInventoryRow({ ...base, values: { listedPriceAED: "1,000,000", status: "Available" } });
    expect(r).toMatchObject({ ok: false, reasons: ["missing_unit_number"] });
  });
  it("flags implausible prices without changing them", () => {
    const r = normalizeInventoryRow({ ...base, values: { unitNumber: "A-1", listedPriceAED: "1,200", areaSqFt: "700", status: "Available", project: "P" } });
    expect(r.ok && r.value.listedPriceAED).toBe(1200);
    expect(r.ok && r.value.validationWarnings).toContain("price_outside_plausible_range");
  });
  it("maps statuses", () => {
    expect(normalizeStatus("Available")).toBe("available");
    expect(normalizeStatus("SOLD")).toBe("sold");
    expect(normalizeStatus("On Hold")).toBe("reserved");
    expect(normalizeStatus("Mystery")).toBe("other");
    expect(normalizeStatus(undefined)).toBeNull();
  });
});

describe("buildProjectNameMatcher", () => {
  it("prefers the longest name and respects word boundaries", () => {
    const m = buildProjectNameMatcher(["Bayz", "Bayz 101", "Elz"]);
    expect(m("Welcome to BAYZ 101 by Danube")).toEqual(["Bayz 101"]);
    expect(m("Bayz101 and Bayz")).toEqual(["Bayz 101", "Bayz"]);
    expect(m("Elzbeth")).toEqual([]);
  });
});
