import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importBrochurePdf } from "@/server/ingest/brochure-import";
import { importInventoryPdf } from "@/server/ingest/inventory-import";
import { importExpectedPdfs } from "@/server/ingest/service";
import {
  BrochurePage,
  DataQualityIssue,
  DataSource,
  IngestionRun,
  InventorySnapshot,
  InventoryUnitObservation,
  Project,
  ProjectFactObservation,
  RejectedRecord,
  SourceDocument,
} from "@/server/models";
import { groupStats, inventoryTotals, listUnits, parseUnitQuery, compareSnapshots } from "@/server/queries/inventory";
import { makePdf, tablePage } from "../fixtures/make-pdf";
import { mongoUri, setupTestDb, write } from "./helpers";

// Synthetic, test-only inventory (hand-verifiable numbers; not real Danube data).
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
const ROWS = [
  ["1", "Alphaz", "A-101", "Apartment", "1 BR", "1,000", "Pool", "1,000,000", "Available"],
  ["2", "Alphaz", "A-102", "Apartment", "2 BR", "1,500", "Sea", "2,100,000", "Sold"],
  ["3", "Alphaz", "A-103", "Apartment", "1 BR", "800", "City", "1,200,000", "Available"],
  ["4", "Betaz 1", "B-201", "Apartment", "Studio", "500", "City", "600,000", "Available"],
  ["5", "Betaz 1", "B-201", "Apartment", "Studio", "500", "City", "650,000", "Available"], // conflicting duplicate
  ["6", "Betaz 1", "", "Apartment", "Studio", "", "", "", ""], // rejected: no unit number, no price
];

function inventoryPdf(date: string | null, rows = ROWS) {
  return makePdf([tablePage(COLS, rows, { title: date ? `Inventory as of ${date}` : "Price List" })]);
}

describe.skipIf(!mongoUri)("PDF ingestion against MongoDB", () => {
  let env: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => {
    env = await setupTestDb("pdf");
  });
  afterAll(async () => env?.teardown());

  it("imports an inventory PDF with provenance, rejections and quality issues", async () => {
    const file = write(env.incoming, "Merge2.pdf", inventoryPdf("01-03-2026"));
    const r = await importInventoryPdf(file, "test");
    expect(r.status).toBe("completed_with_errors"); // one rejected row
    expect(await InventoryUnitObservation.countDocuments()).toBe(5);
    expect(await RejectedRecord.countDocuments()).toBe(1);
    const rej = await RejectedRecord.findOne().lean();
    expect(rej!.reasons).toEqual(["missing_unit_number_and_price"]);

    const snap = await InventorySnapshot.findOne().lean();
    expect(snap!.snapshotDateStatus).toBe("from_document");
    expect(snap!.snapshotDate!.toISOString().slice(0, 10)).toBe("2026-03-01");

    const obs = await InventoryUnitObservation.findOne({ unitNumber: "A-101" }).lean();
    expect(obs).toMatchObject({ sourcePage: 1, listedPriceAED: 1_000_000, areaSqFt: 1000, pricePerSqFt: 1000, statusNormalized: "available" });
    expect(obs!.originalValues.listedPriceAED).toBe("1,000,000");

    expect(await Project.countDocuments()).toBe(2);
    const conflict = await DataQualityIssue.findOne({ rule: "conflicting_unit_records" }).lean();
    expect(conflict!.details).toContain("B-201");

    const run = await IngestionRun.findById(r.runId).lean();
    expect(run).toMatchObject({ status: "completed_with_errors", recordsCreated: 5, recordsRejected: 1 });
    const src = await DataSource.findOne({ key: "merge2_pdf" }).lean();
    expect(src!.status).toBe("ok");
    expect(src!.lastSuccessfulFetchAt).toBeTruthy();
  });

  it("computes hand-verifiable metrics from the stored rows", async () => {
    const totals = await inventoryTotals();
    // 5 rows; distinct units: A-101, A-102, A-103, B-201 = 4; available distinct: A-101, A-103, B-201 = 3
    expect(totals).toMatchObject({ rows: 5, units: 4, available: 3 });
    const byProject = await groupStats("project");
    const alphaz = byProject.find((g) => g.label === "Alphaz")!;
    // prices 1.0M, 2.1M, 1.2M -> median 1.2M; psf 1000, 1400, 1500 -> median 1400
    expect(alphaz.price.median).toBe(1_200_000);
    expect(alphaz.psf.median).toBe(1400);
    expect(alphaz.status).toEqual({ available: 2, sold: 1 });
    const betaz = byProject.find((g) => g.label === "Betaz 1")!;
    expect(betaz.rows).toBe(2);
    expect(betaz.distinctUnits).toBe(1);
    expect(betaz.price.median).toBe(625_000);
  });

  it("filters, sorts and paginates units with validated input", async () => {
    const page = await listUnits(parseUnitQuery({ status: "available", sort: "listedPriceAED", dir: "desc", pageSize: "25" }));
    expect(page.total).toBe(4);
    expect(page.rows.map((r) => r.listedPriceAED)).toEqual([1_200_000, 1_000_000, 650_000, 600_000]);
    // Invalid values fall back to defaults instead of erroring or injecting operators.
    const q = parseUnitQuery({ sort: "$where", status: "bogus", pageSize: "9999", q: "a-1" });
    expect(q).toMatchObject({ sort: "sourcePage", pageSize: 50 });
    expect(q.status).toBeUndefined();
    expect((await listUnits(q)).total).toBe(3);
    expect((await listUnits(parseUnitQuery({ q: ".*" }))).total).toBe(0); // regex metacharacters are escaped
  });

  it("re-importing the identical file creates nothing", async () => {
    const before = await InventoryUnitObservation.countDocuments();
    const r = await importInventoryPdf(`${env.incoming}/Merge2.pdf`, "test");
    expect(r.status).toBe("skipped");
    expect(await InventoryUnitObservation.countDocuments()).toBe(before);
    expect(await SourceDocument.countDocuments()).toBe(1);
  });

  it("a modified file becomes a new snapshot and the earlier snapshot is preserved", async () => {
    const changed = ROWS.slice(0, 3).map((r) => [...r]);
    changed[0][7] = "1,100,000";
    changed[2][8] = "Sold";
    write(env.incoming, "Merge2.pdf", inventoryPdf("01-04-2026", changed));
    const r = await importInventoryPdf(`${env.incoming}/Merge2.pdf`, "test");
    expect(r.status).toBe("completed");
    expect(await SourceDocument.countDocuments()).toBe(2);
    expect(await InventorySnapshot.countDocuments()).toBe(2);
    expect(await InventoryUnitObservation.countDocuments()).toBe(8);
    expect(await DataQualityIssue.countDocuments({ rule: "same_filename_new_content" })).toBe(1);

    const [older, newer] = await InventorySnapshot.find().sort({ snapshotDate: 1 }).lean();
    const cmp = await compareSnapshots(String(older._id), String(newer._id));
    expect(cmp).toMatchObject({ comparable: true, inBoth: 3, onlyOld: 1, onlyNew: 0, priceChanged: 1, statusChanged: 1 });
    // The first snapshot still holds the original price.
    const orig = await InventoryUnitObservation.findOne({ snapshotId: older._id, unitNumber: "A-101" }).lean();
    expect(orig!.listedPriceAED).toBe(1_000_000);
  });

  it("an unknown snapshot date stays unknown and is flagged", async () => {
    const file = write(env.incoming, "undated.pdf", inventoryPdf(null, ROWS.slice(0, 2)));
    await importInventoryPdf(file, "test");
    const snap = await InventorySnapshot.findOne({ snapshotDateStatus: "unknown" }).lean();
    expect(snap!.snapshotDate ?? null).toBeNull();
    expect(await DataQualityIssue.countDocuments({ rule: "snapshot_date_unknown" })).toBe(1);
  });

  it("fails truthfully for scanned, non-PDF, empty and missing files", async () => {
    const scanned = await importInventoryPdf(write(env.incoming, "scan.pdf", makePdf([{ texts: [], noText: true }])), "test");
    expect(scanned.status).toBe("failed");
    expect(scanned.message).toMatch(/No inventory table header/);
    const run = await IngestionRun.findById(scanned.runId).lean();
    expect(run!.warnings.join(" ")).toMatch(/no text layer/);

    const notPdf = await importInventoryPdf(write(env.incoming, "fake.pdf", "hello"), "test");
    expect(notPdf.status).toBe("failed");

    const empty = await importInventoryPdf(write(env.incoming, "empty.pdf", ""), "test");
    expect(empty).toMatchObject({ status: "failed", message: expect.stringMatching(/empty/) });

    const missing = await importInventoryPdf(`${env.incoming}/nope.pdf`, "test");
    expect(missing).toMatchObject({ status: "failed", message: expect.stringMatching(/not found/) });
    expect(await IngestionRun.countDocuments({ status: "failed" })).toBeGreaterThanOrEqual(4);
  });

  it("reports a missing Merge1.pdf without pretending to import it", async () => {
    fs.rmSync(`${env.incoming}/Merge1.pdf`, { force: true });
    const results = await importExpectedPdfs("test");
    const m1 = results.find((r) => r.filename === "Merge1.pdf")!;
    expect(m1.result).toMatchObject({ status: "failed", message: expect.stringMatching(/Merge1\.pdf not found/) });
    const m2 = results.find((r) => r.filename === "Merge2.pdf")!;
    expect(m2.result.status).toBe("skipped");
  });

  it("imports brochure pages with page-level attribution and marketing-claim facts", async () => {
    const pdf = makePdf([
      { texts: [{ x: 40, y: 500, text: "ALPHAZ BY DANUBE" }, { x: 40, y: 470, text: "Located in Testville Heights. Studios and 1 Bedroom homes." }] },
      { texts: [{ x: 40, y: 500, text: "AMENITIES" }, { x: 40, y: 480, text: "Infinity Pool" }, { x: 40, y: 460, text: "Gym" }] },
      { texts: [{ x: 40, y: 500, text: "Alphaz and Betaz 1 both offer 1% monthly payment plan" }] },
      { texts: [], noText: true },
    ]);
    const r = await importBrochurePdf(write(env.incoming, "Merge1.pdf", pdf), "test");
    expect(r.status).toBe("completed");
    const pages = await BrochurePage.find().sort({ page: 1 }).lean();
    // An ambiguous page stops carry-forward, so the blank page after it is not linked.
    expect(pages.map((p) => p.attribution)).toEqual(["single_name_match", "carried_forward", "ambiguous", "none"]);
    expect(pages[3].hasTextLayer).toBe(false);
    const alphaz = await Project.findOne({ normalizedName: "alphaz" }).lean();
    const facts = await ProjectFactObservation.find({ projectId: alphaz!._id }).lean();
    const by = (c: string) => facts.filter((f) => f.category === c).map((f) => f.value).sort();
    expect(by("location")).toEqual(["Testville Heights"]);
    expect(by("configuration")).toEqual(["1 bedroom", "Studio"]);
    expect(by("amenity")).toEqual(["Gym", "Infinity Pool"]);
    expect(by("payment_plan")).toEqual([]); // ambiguous page: nothing attributed
    expect(facts.every((f) => f.claimType === "marketing_claim" && f.verificationStatus === "unverified")).toBe(true);
    expect(facts.find((f) => f.category === "amenity")!.confidence).toBe("low"); // carried forward

    const again = await importBrochurePdf(`${env.incoming}/Merge1.pdf`, "test");
    expect(again.status).toBe("skipped");
    expect(await ProjectFactObservation.countDocuments()).toBe(facts.length);
  });
});
