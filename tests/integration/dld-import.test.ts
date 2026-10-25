import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importDldCsv } from "@/server/ingest/dld-import";
import { DataQualityIssue, IngestionRun, MarketTransaction, Project, RejectedRecord } from "@/server/models";
import { addProjectAlias, mergeProjects, resolveOrCreateProject } from "@/server/projects";
import { marketSummary, parseMarketFilter } from "@/server/queries/market";
import { mongoUri, setupTestDb, write } from "./helpers";

// Synthetic, test-only DLD-style exports.
const TX_HEADER =
  "Transaction Number,Transaction Date,Transaction Type,Transaction sub type,Registration type,Is Free Hold?,Usage,Area,Property Type,Property Sub Type,Amount,Transaction Size (sq.m),Property Size (sq.m),Room(s),Parking,Nearest Metro,Nearest Mall,Nearest Landmark,No. of Buyer,No. of Seller,Master Project,Project";
const tx = (id: string, date: string, amount: string, size: string, project: string, type = "Sales") =>
  `${id},${date},${type},Sell,Off-Plan,Free Hold,Residential,Test Area,Unit,Flat,${amount},${size},${size},1 B/R,,,,,1,1,,${project}`;

const TX_CSV = [
  TX_HEADER,
  tx("T1", "05-01-2026", "1000000", "100", "ALPHAZ TOWER"),
  tx("T2", "20-01-2026", "2000000", "100", "ALPHAZ TOWER"),
  tx("T3", "03-02-2026", "3000000", "200", "OTHER TOWER"),
  tx("T4", "10-02-2026", "4000000", "0", "UNREGISTERED TOWER"),
  tx("T1", "05-01-2026", "1000000", "100", "ALPHAZ TOWER"), // exact duplicate row in the same file
  "T5,bad-date,Sales,Sell,Off-Plan,Free Hold,Residential,Test Area,Unit,Flat,5000,10,10,,,,,,1,1,,X",
  'T6,05-02-2026,"Sales,Sell', // malformed: unterminated quote
].join("\n");

const PRJ_CSV = [
  "Project Number,Project Name,Developer Number,Developer Name,Project Status,Completed (%)",
  "P1,Alphaz Tower,D1,DANUBE PROPERTIES DEVELOPMENT LLC,Active,40",
  "P2,Other Tower,D2,OTHER DEVELOPER LLC,Active,90",
].join("\n");

describe.skipIf(!mongoUri)("DLD CSV ingestion against MongoDB", () => {
  let env: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => {
    env = await setupTestDb("dld");
  });
  afterAll(async () => env?.teardown());

  it("imports transactions, rejects bad rows, and never attributes without evidence", async () => {
    const r = await importDldCsv(write(env.dld, "transactions.csv", TX_CSV), "test");
    expect(r.status).toBe("completed_with_errors");
    expect(await MarketTransaction.countDocuments()).toBe(4);
    const rejected = await RejectedRecord.find().lean();
    expect(rejected.map((x) => x.reasons[0]).sort()).toEqual([expect.stringMatching(/^csv_parse_error/), "unparseable_transaction_date"].sort());
    const run = await IngestionRun.findById(r.runId).lean();
    expect(run).toMatchObject({ recordsCreated: 4, recordsSkipped: 1, recordsRejected: 2 });
    // No project register yet: nothing is attributed to any developer.
    expect(await MarketTransaction.countDocuments({ developerName: { $ne: null } })).toBe(0);
    const t1 = await MarketTransaction.findOne({ externalTransactionId: "T1" }).lean();
    expect(t1!.transactionDate.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect(t1!.areaSqFt).toBeCloseTo(1076.391, 2);
  });

  it("attributes developers only after a project register import, by exact name", async () => {
    const r = await importDldCsv(write(env.dld, "projects.csv", PRJ_CSV), "test");
    expect(r.status).toBe("completed");
    const attributed = await MarketTransaction.find({ developerName: { $ne: null } }).select("externalTransactionId developerName").lean();
    expect(attributed.map((t) => t.externalTransactionId).sort()).toEqual(["T1", "T2", "T3"]);
    const t4 = await MarketTransaction.findOne({ externalTransactionId: "T4" }).lean();
    expect(t4!.developerName ?? null).toBeNull();
  });

  it("computes market totals, share and coverage that a person can verify by hand", async () => {
    const s = await marketSummary(parseMarketFilter({}));
    expect(s!.totals).toMatchObject({ count: 4, value: 10_000_000 });
    // Danube = T1 + T2 = 3,000,000 of 10,000,000 total. Attributed = 6,000,000 -> coverage 60%.
    expect(s!.danube.value).toBe(3_000_000);
    expect(s!.danube.valueShare).toBeCloseTo(0.3, 10);
    expect(s!.coverage).toBeCloseTo(0.6, 10);
    expect(s!.shareReliable).toBe(false);
    expect(s!.unattributedValue).toBe(4_000_000);
    // psf: T1 1,000,000/1076.39 = 929.03; T2 1858.06; T3 3,000,000/2152.78 = 1393.55; T4 has size 0 -> excluded
    expect(s!.psfSample).toBe(3);
    expect(s!.medianPsf).toBeCloseTo(3_000_000 / (200 * 10.763910416709722), 6);
    expect(s!.monthly.map((m) => [m._id, m.count])).toEqual([["2026-01", 2], ["2026-02", 2]]);
    expect(s!.monthly.map((m) => [m.danubeCount, m.danubeValue])).toEqual([[2, 3_000_000], [0, 0]]);

    const jan = await marketSummary(parseMarketFilter({ from: "2026-01-01", to: "2026-01-20" }));
    expect(jan!.totals.count).toBe(2); // "to" is inclusive of 20 Jan
  });

  it("re-imports idempotently and keeps the first version when a record conflicts", async () => {
    const again = await importDldCsv(`${env.dld}/transactions.csv`, "test");
    expect(again.status).toBe("skipped");
    const modified = [TX_HEADER, tx("T1", "05-01-2026", "1111111", "100", "ALPHAZ TOWER"), tx("T9", "01-03-2026", "500000", "50", "OTHER TOWER")].join("\n");
    const r = await importDldCsv(write(env.dld, "transactions-v2.csv", modified), "test");
    expect(r.status).toBe("completed");
    expect(await MarketTransaction.countDocuments()).toBe(5);
    const t1 = await MarketTransaction.findOne({ externalTransactionId: "T1" }).lean();
    expect(t1!.transactionValueAED).toBe(1_000_000);
    expect(await DataQualityIssue.countDocuments({ rule: "conflicting_transaction_record" })).toBe(1);
  });

  it("links transactions to a project only after a reviewed alias", async () => {
    const id = await resolveOrCreateProject("Alphaz", { sourceType: "local_document", claimType: "documented" });
    expect(await MarketTransaction.countDocuments({ projectId: id })).toBe(0);
    const linked = await addProjectAlias(id!, "Alphaz Tower", "DLD name confirmed against brochure");
    expect(linked).toBe(2);
    await expect(addProjectAlias((await resolveOrCreateProject("Gammaz", { sourceType: "local_document", claimType: "documented" }))!, "ALPHAZ TOWER")).rejects.toThrow(/already identifies/);
  });

  it("merges projects after review without losing observations", async () => {
    const a = (await Project.findOne({ normalizedName: "alphaz" }))!._id;
    const g = (await Project.findOne({ normalizedName: "gammaz" }))!._id;
    await mergeProjects(g, a, "test merge");
    expect(await Project.countDocuments({ _id: g })).toBe(0);
    const merged = await Project.findById(a).lean();
    expect(merged!.matchKeys).toEqual(expect.arrayContaining(["alphaz", "alphaztower", "gammaz"]));
    expect(await MarketTransaction.countDocuments({ projectId: a })).toBe(2);
  });

  it("fails truthfully on unrecognized, header-only and empty files", async () => {
    const unknown = await importDldCsv(write(env.dld, "random.csv", "a,b\n1,2"), "test");
    expect(unknown).toMatchObject({ status: "failed", message: expect.stringMatching(/Unrecognized CSV/) });
    const headerOnly = await importDldCsv(write(env.dld, "header.csv", TX_HEADER), "test");
    expect(headerOnly).toMatchObject({ status: "failed" });
    const empty = await importDldCsv(write(env.dld, "empty.csv", ""), "test");
    expect(empty).toMatchObject({ status: "failed", message: expect.stringMatching(/empty/) });
  });
});
