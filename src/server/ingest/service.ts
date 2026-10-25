import fs from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";
import { requireDb } from "@/server/db";
import { ensureIndexes } from "@/server/models";
import { importBrochurePdf } from "./brochure-import";
import { importDldCsv } from "./dld-import";
import { importInventoryPdf, type ImportResult } from "./inventory-import";
import { recordFailedAttempt, syncDataSources } from "./runs";

export type Trigger = "cli" | "ui" | "test";

export const EXPECTED_PDFS = [
  { filename: "Merge1.pdf", kind: "brochure" as const, sourceKey: "merge1_pdf" },
  { filename: "Merge2.pdf", kind: "inventory" as const, sourceKey: "merge2_pdf" },
];

export async function prepareDatabase() {
  await requireDb();
  await ensureIndexes();
  await syncDataSources();
}

export interface IncomingFile {
  name: string;
  sizeBytes: number;
  modifiedAt: Date;
}

async function listDir(dir: string, ext: RegExp): Promise<IncomingFile[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: IncomingFile[] = [];
    for (const e of entries) {
      if (!e.isFile() || !ext.test(e.name)) continue;
      const st = await fs.stat(path.join(dir, e.name));
      files.push({ name: e.name, sizeBytes: st.size, modifiedAt: st.mtime });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function listIncomingPdfs() {
  return listDir(getEnv().INCOMING_DIR, /\.pdf$/i);
}

export function listDldCsvs() {
  return listDir(getEnv().DLD_DIR, /\.csv$/i);
}

/** Resolve a user-supplied file name strictly inside a directory (no traversal, must exist in listing). */
export async function resolveListedFile(dir: string, name: string, ext: RegExp): Promise<string | null> {
  const base = path.basename(name);
  if (base !== name || !ext.test(base)) return null;
  const listed = await listDir(dir, ext);
  if (!listed.some((f) => f.name === base)) return null;
  const full = path.resolve(dir, base);
  return full.startsWith(path.resolve(dir) + path.sep) ? full : null;
}

/** Import Merge1.pdf and Merge2.pdf from data/incoming. Inventory first so its project names help brochure attribution. */
export async function importExpectedPdfs(trigger: Trigger): Promise<Array<{ filename: string; result: ImportResult }>> {
  await prepareDatabase();
  const { INCOMING_DIR } = getEnv();
  const out: Array<{ filename: string; result: ImportResult }> = [];
  for (const spec of [...EXPECTED_PDFS].reverse()) {
    const full = path.join(INCOMING_DIR, spec.filename);
    const exists = await fs.stat(full).then((s) => s.isFile()).catch(() => false);
    if (!exists) {
      const message = `${spec.filename} not found. Place it at data/incoming/${spec.filename} and run the import again.`;
      const run = await recordFailedAttempt({ sourceKey: spec.sourceKey, trigger, filename: spec.filename, message });
      out.push({ filename: spec.filename, result: { runId: String(run._id), status: "failed", message } });
      continue;
    }
    const result = spec.kind === "inventory" ? await importInventoryPdf(full, trigger) : await importBrochurePdf(full, trigger);
    out.push({ filename: spec.filename, result });
  }
  return out;
}

export async function importPdfFile(full: string, kind: "inventory" | "brochure", trigger: Trigger) {
  await prepareDatabase();
  return kind === "inventory" ? importInventoryPdf(full, trigger) : importBrochurePdf(full, trigger);
}

export async function importDldFile(full: string, trigger: Trigger) {
  await prepareDatabase();
  return importDldCsv(full, trigger);
}

/** Import every CSV in data/incoming/dld; project registers first so transactions can be attributed. */
export async function importDldFolder(trigger: Trigger) {
  await prepareDatabase();
  const { DLD_DIR } = getEnv();
  const files = await listDldCsvs();
  const ordered = [...files].sort((a, b) => Number(/project/i.test(b.name)) - Number(/project/i.test(a.name)));
  const out: Array<{ filename: string; result: ImportResult }> = [];
  for (const f of ordered) out.push({ filename: f.name, result: await importDldCsv(path.join(DLD_DIR, f.name), trigger) });
  return out;
}
