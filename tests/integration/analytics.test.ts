import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importInventoryPdf } from "@/server/ingest/inventory-import";
import { Project } from "@/server/models";
import { rejectionSummary, resolveScope, scopedAnalytics } from "@/server/queries/analytics";
import { listUnits, parseUnitQuery } from "@/server/queries/inventory";
import { getCommandCenter } from "@/server/queries/overview";
import { getPortfolio, getProjectDetail } from "@/server/queries/portfolio";
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
  ["6", "Betaz 1", "B-202", "Apartment", "Studio", "", "City", "", "Booked"], // no price, no size
  ["7", "Betaz 1", "", "Apartment", "Studio", "", "", "", ""], // rejected
];

const pdf = (title: string, rows = ROWS) => makePdf([tablePage(COLS, rows, { title })]);

describe.skipIf(!mongoUri)("analytics over stored inventory", () => {
  let env: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => {
    env = await setupTestDb("analytics");
  });
  afterAll(async () => env?.teardown());

  it("returns an empty scope and zeros before any import", async () => {
    const s = await scopedAnalytics();
    expect(s.scope.current).toBeNull();
    expect(s.analytics.records).toBe(0);
    const cc = await getCommandCenter();
    expect(cc.rejections.total).toBe(0);
    expect(cc.lastSuccess).toBeNull();
  });

  it("analyses an undated snapshot without substituting the import date", async () => {
    await importInventoryPdf(write(env.incoming, "undated.pdf", pdf("Price List")), "test");
    const s = await scopedAnalytics();
    expect(s.scope.basis).toBe("latest_imported_undated");
    expect(s.scope.current!.dateKnown).toBe(false);
    expect(s.scope.current!.snapshotDate).toBeNull();

    const a = s.analytics;
    expect(a.records).toBe(6);
    expect(a.status).toEqual({ available: 4, sold: 1, reserved: 1, other: 0, missing: 0 });
    expect(a.dedup).toMatchObject({ distinctUnits: 5, conflictingUnits: 1, conflictingRows: 2, duplicateRowsCollapsed: 0 });
    // Conflicting B-201 is excluded from value; B-202 has no price.
    expect(a.listedValue).toEqual({ sum: 4_300_000, units: 3, excludedNoPrice: 1 });
    expect(a.price.median).toBe(1_200_000);
    expect(a.psf.median).toBe(1400);
    expect(a.coverage.reviewRequired).toBe(1); // B-202: price and area missing

    const rej = await rejectionSummary(s.scope.current);
    expect(rej).toMatchObject({ total: 1, rejected: 1, unplaced: 0 });
  });

  it("filters consistently for charts and the table", async () => {
    const scope = (await resolveScope()).current!;
    const filters = [{ flag: "missing_price" }, { status: "reserved" }, { q: "betaz" }, { flag: "review" }, { warn: "area_missing" }, { status: "missing" }] as const;
    const expected = [1, 1, 3, 1, 1, 0];
    for (const [i, f] of filters.entries()) {
      const q = parseUnitQuery({ ...f, snapshot: scope.id });
      const [table, charts] = await Promise.all([listUnits(q), scopedAnalytics(q)]);
      expect(table.total, JSON.stringify(f)).toBe(expected[i]);
      expect(charts.analytics.records, JSON.stringify(f)).toBe(expected[i]);
    }
  });

  it("prefers a dated snapshot by default and never mixes snapshots", async () => {
    await importInventoryPdf(write(env.incoming, "dated.pdf", pdf("Inventory as of 01-03-2026", ROWS.slice(0, 3))), "test");
    const s = await scopedAnalytics();
    expect(s.scope.basis).toBe("latest_dated");
    expect(s.scope.current!.snapshotDate!.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(s.analytics.records).toBe(3);
    const undated = s.scope.snapshots.find((x) => !x.dateKnown)!;
    expect((await scopedAnalytics({ snapshot: undated.id, warnings: "any" })).analytics.records).toBe(6);
  });

  it("builds portfolio and project detail from the same analytics", async () => {
    const portfolio = await getPortfolio();
    const alphaz = portfolio.items.find((p) => p.name === "Alphaz")!;
    expect(alphaz.stats?.records).toBe(3);
    expect(alphaz.attribution).toBe("project_column");
    expect(alphaz.geo).toBeNull();

    const p = await Project.findOne({ name: "Alphaz" }).lean();
    const detail = await getProjectDetail(String(p!._id));
    expect(detail!.units!.total).toBe(3);
    expect(detail!.timeline.map((t) => t.records).sort()).toEqual([3, 3]);
    expect(await getProjectDetail("000000000000000000000000")).toBeNull();
  });
});
