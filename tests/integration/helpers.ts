import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inject } from "vitest";
import mongoose from "mongoose";
import { resetEnvCache } from "@/lib/env";
import { connectDb, disconnectDb } from "@/server/db";
import { ensureIndexes } from "@/server/models";
import { syncDataSources } from "@/server/ingest/runs";

export const mongoUri = inject("mongoUri");
export const skipReason = inject("mongoUnavailableReason");

/** Fresh database + data directory per test file. */
export async function setupTestDb(name: string) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `danube-${name}-`));
  fs.mkdirSync(path.join(dataDir, "incoming", "dld"), { recursive: true });
  process.env.MONGODB_URI = `${mongoUri}/danube_test_${name}_${Date.now()}`;
  process.env.DATA_DIR = dataDir;
  resetEnvCache();
  await connectDb(process.env.MONGODB_URI);
  await ensureIndexes();
  await syncDataSources();
  return {
    dataDir,
    incoming: path.join(dataDir, "incoming"),
    dld: path.join(dataDir, "incoming", "dld"),
    async teardown() {
      await mongoose.connection.db?.dropDatabase();
      await disconnectDb();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export function write(dir: string, name: string, content: string | Uint8Array) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}
