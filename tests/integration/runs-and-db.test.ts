import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { resetEnvCache } from "@/lib/env";
import { connectDb, disconnectDb, getDbStatus } from "@/server/db";
import { finishRun, markStaleRuns, RunInProgressError, startRun, STALE_RUN_MS } from "@/server/ingest/runs";
import { IngestionRun } from "@/server/models";
import { getOverview } from "@/server/queries/overview";
import { mongoUri, setupTestDb } from "./helpers";

describe.skipIf(!mongoUri)("ingestion runs and empty-database behaviour", () => {
  let env: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => {
    env = await setupTestDb("runs");
  });
  afterAll(async () => env?.teardown());

  it("returns zeros and nulls, never invented values, for an empty database", async () => {
    const o = await getOverview();
    expect(o.projectCount).toBe(0);
    expect(o.totals).toEqual({ rows: 0, units: 0, available: 0, withWarnings: 0 });
    expect(o.byProject).toEqual([]);
    expect(o.tx).toBeNull();
    expect(o.eventCount).toBe(0);
    expect(o.sources.length).toBeGreaterThan(0); // source definitions only
    expect(o.sources.every((s) => !s.lastSuccessfulFetchAt)).toBe(true);
  });

  it("prevents concurrent runs of the same source", async () => {
    const run = await startRun({ sourceKey: "merge2_pdf", trigger: "test" });
    await expect(startRun({ sourceKey: "merge2_pdf", trigger: "test" })).rejects.toBeInstanceOf(RunInProgressError);
    await finishRun(run, "completed");
    const next = await startRun({ sourceKey: "merge2_pdf", trigger: "test" });
    await finishRun(next, "completed");
  });

  it("marks runs that stopped heart-beating as interrupted", async () => {
    const run = await startRun({ sourceKey: "merge1_pdf", trigger: "test" });
    await markStaleRuns(new Date(Date.now() + STALE_RUN_MS + 1000));
    const stored = await IngestionRun.findById(run.id).lean();
    expect(stored!.status).toBe("interrupted");
    expect(stored!.errors[0]).toMatch(/Re-run the import/);
    // A new run can start after the interrupted one.
    const again = await startRun({ sourceKey: "merge1_pdf", trigger: "test" });
    await finishRun(again, "completed");
  });

  it("reports a disconnected database quickly without leaking the URI", async () => {
    await disconnectDb();
    process.env.MONGODB_URI = "mongodb://user:secret@127.0.0.1:1/never";
    resetEnvCache();
    const started = Date.now();
    const status = await getDbStatus();
    expect(status.ok).toBe(false);
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(Date.now() - started).toBeLessThan(10_000);
    // Reconnect for teardown.
    await disconnectDb();
    process.env.MONGODB_URI = `${mongoUri}/${mongoose.connection.name || "x"}`;
    resetEnvCache();
  });

  it("rejects an invalid MONGODB_URI with a configuration message", async () => {
    process.env.MONGODB_URI = "postgres://nope";
    resetEnvCache();
    const status = await getDbStatus();
    expect(status).toMatchObject({ ok: false, reason: expect.stringMatching(/Invalid environment/) });
  });

  afterAll(async () => {
    // Restore a usable connection so the shared teardown can drop the test database.
    await disconnectDb();
    process.env.MONGODB_URI = `${mongoUri}/danube_test_runs_cleanup`;
    resetEnvCache();
    await connectDb(process.env.MONGODB_URI);
  });
});
