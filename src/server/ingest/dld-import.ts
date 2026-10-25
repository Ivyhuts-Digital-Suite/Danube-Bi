import crypto from "node:crypto";
import { Readable } from "node:stream";
import { parse } from "csv-parse";
import type { Types } from "mongoose";
import { DldProjectObservation, MarketTransaction, Project, RejectedRecord, SourceDocument } from "@/server/models";
import { runTransactionMatchChecks, upsertIssue } from "@/server/quality";
import { detectDldKind, mapProjectRow, mapTransactionRow, toRow, type DldKind } from "./dld-csv";
import { loadSourceFile, registerDocument, SourceFileError } from "./documents";
import type { ImportResult } from "./inventory-import";
import { errorMessage, finishRun, recordFailedAttempt, startRun, type RunHandle } from "./runs";

export const DLD_EXTRACTION_VERSION = "dld-csv@1";
const BATCH = 1000;

const SOURCE_KEYS: Record<DldKind, string> = { transactions: "dld_transactions_csv", projects: "dld_projects_csv" };

function hashRecord(record: string[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

/** Read only the header line to decide which DLD export this is. */
async function readHeader(bytes: Buffer): Promise<string[]> {
  const parser = Readable.from([bytes]).pipe(parse({ bom: true, to_line: 1, relax_column_count: true, relax_quotes: true }));
  for await (const rec of parser) return rec as string[];
  return [];
}

export async function importDldCsv(filePath: string, trigger: "cli" | "ui" | "test"): Promise<ImportResult> {
  let run: RunHandle | null = null;
  let docId: Types.ObjectId | undefined;
  let kind: DldKind | null = null;
  try {
    const file = await loadSourceFile(filePath);
    const headers = await readHeader(file.bytes);
    kind = detectDldKind(headers);
    if (!kind) {
      throw new SourceFileError(
        `Unrecognized CSV: expected a DLD Transactions export (Transaction Number, Transaction Date, Transaction Type, Amount, …) or a DLD Projects export (Project Number, Project Name, Developer Name, …). Found columns: ${headers.slice(0, 25).join(", ") || "(none)"}`,
      );
    }
    const { doc } = await registerDocument(file, kind === "transactions" ? "dld_transactions_csv" : "dld_projects_csv", { columns: headers });
    docId = doc._id;
    run = await startRun({ sourceKey: SOURCE_KEYS[kind], trigger, filename: file.filename, sourceDocumentId: doc._id });
    if (doc.extractionVersion === DLD_EXTRACTION_VERSION && (doc.extractionStatus === "completed" || doc.extractionStatus === "completed_with_warnings")) {
      run.warnings.push(`Identical file (sha256 ${file.sha256.slice(0, 12)}…) was already imported; nothing to do.`);
      await finishRun(run, "skipped", { sourceDocumentId: doc._id });
      return { runId: String(run.id), status: "skipped", message: run.warnings[0], sourceDocumentId: String(doc._id) };
    }
    await SourceDocument.updateOne({ _id: doc._id }, { $set: { extractionStatus: "running", extractionVersion: DLD_EXTRACTION_VERSION } });

    const retrievedAt = doc.importedAt;
    const rejections: Array<{ locator: string; raw: unknown; reasons: string[] }> = [];
    const parser = Readable.from([file.bytes]).pipe(
      parse({
        bom: true,
        from_line: 2,
        skip_empty_lines: true,
        relax_column_count: true,
        skip_records_with_error: true,
        info: true,
        on_skip: (err, raw) => {
          rejections.push({
            locator: `line:${err?.lines ?? "?"}`,
            raw: { _raw: (raw ?? "").slice(0, 2000) },
            reasons: [`csv_parse_error: ${err?.message ?? "unknown"}`],
          });
          return undefined;
        },
      }),
    );

    const projectKeys = new Map<string, Types.ObjectId>();
    for (const p of await Project.find().select("_id matchKeys").lean()) for (const k of p.matchKeys) projectKeys.set(k, p._id);
    const developers = await developerRegister();

    let batch: Array<{ line: number; record: string[] }> = [];
    let accepted = 0;
    let latestDate: Date | null = null;

    const processBatch = async () => {
      if (batch.length === 0) return;
      const items = batch;
      batch = [];
      if (kind === "transactions") {
        const mapped: Array<{ line: number; record: string[]; value: ReturnType<typeof mapTransactionRow> }> = items.map((it) => ({
          ...it,
          value: it.record.length !== headers.length ? { ok: false as const, reasons: [`column_count_mismatch: expected ${headers.length}, got ${it.record.length}`] } : mapTransactionRow(toRow(headers, it.record)),
        }));
        const ids = mapped.flatMap((m) => (m.value.ok ? [m.value.value.externalTransactionId] : []));
        const existing = new Map((await MarketTransaction.find({ externalTransactionId: { $in: ids } }).select("externalTransactionId rowHash").lean()).map((t) => [t.externalTransactionId, t.rowHash]));
        const toInsert: Record<string, unknown>[] = [];
        for (const m of mapped) {
          if (!m.value.ok) {
            rejections.push({ locator: `line:${m.line}`, raw: m.record, reasons: m.value.reasons });
            continue;
          }
          const v = m.value.value;
          const rowHash = hashRecord(m.record);
          const prior = existing.get(v.externalTransactionId);
          if (prior !== undefined) {
            if (prior === rowHash) run!.counts.recordsSkipped++;
            else {
              run!.counts.recordsSkipped++;
              await upsertIssue({
                key: `tx_conflict:${v.externalTransactionId}:${rowHash}`,
                entityType: "MarketTransaction",
                entityId: v.externalTransactionId,
                rule: "conflicting_transaction_record",
                severity: "warning",
                details: `Transaction ${v.externalTransactionId} appears again (${file.filename}, line ${m.line}) with different values. The first stored version was kept unchanged.`,
                sourceReferences: [{ sourceType: "official_open_data", sourceDocumentId: doc._id, recordId: v.externalTransactionId, claimType: "registered_transaction" }],
              });
            }
            continue;
          }
          existing.set(v.externalTransactionId, rowHash);
          const projectId = v.projectNormalizedName ? projectKeys.get(v.projectNormalizedName) : undefined;
          const dev = v.projectNormalizedName ? developers.get(v.projectNormalizedName) : undefined;
          toInsert.push({
            ...v,
            projectId: projectId ?? null,
            matchMethod: projectId ? "exact_alias" : "none",
            matchConfidence: projectId ? "high" : "none",
            developerName: dev?.developerName,
            developerNumber: dev?.developerNumber,
            developerMatchMethod: dev ? "dld_project_register_exact" : "none",
            sourceKey: SOURCE_KEYS.transactions,
            sourceDocumentId: doc._id,
            rowHash,
            originalValues: toRow(headers, m.record),
          });
          if (!latestDate || v.transactionDate > latestDate) latestDate = v.transactionDate;
          if (m.value.warnings.length) run!.warnings.push(`line ${m.line}: ${m.value.warnings.join(", ")}`);
        }
        if (toInsert.length) {
          try {
            const res = await MarketTransaction.insertMany(toInsert, { ordered: false });
            run!.counts.recordsCreated += res.length;
          } catch (err) {
            // A concurrent/duplicate insert of the same id is safe to skip; anything else is a real error.
            const e = err as { insertedDocs?: unknown[]; writeErrors?: Array<{ code?: number; err?: { code?: number } }> };
            const dupOnly = e.writeErrors?.every((w) => (w.code ?? w.err?.code) === 11000);
            if (!dupOnly) throw err;
            run!.counts.recordsCreated += e.insertedDocs?.length ?? 0;
            run!.counts.recordsSkipped += e.writeErrors?.length ?? 0;
          }
          accepted += toInsert.length;
        }
      } else {
        const ops = [];
        for (const it of items) {
          const res = it.record.length !== headers.length ? { ok: false as const, reasons: [`column_count_mismatch: expected ${headers.length}, got ${it.record.length}`] } : mapProjectRow(toRow(headers, it.record));
          if (!res.ok) {
            rejections.push({ locator: `line:${it.line}`, raw: it.record, reasons: res.reasons });
            continue;
          }
          if (res.warnings.length) run!.warnings.push(`line ${it.line}: ${res.warnings.join(", ")}`);
          const rowHash = hashRecord(it.record);
          ops.push({
            updateOne: {
              filter: { projectNumber: res.value.projectNumber, rowHash },
              update: { $setOnInsert: { ...res.value, sourceDocumentId: doc._id, retrievedAt, rowHash, originalValues: toRow(headers, it.record) } },
              upsert: true,
            },
          });
        }
        if (ops.length) {
          const res = await DldProjectObservation.bulkWrite(ops, { ordered: false });
          run!.counts.recordsCreated += res.upsertedCount;
          run!.counts.recordsSkipped += res.matchedCount;
          accepted += ops.length;
        }
      }
      await run!.heartbeat();
    };

    for await (const entry of parser as AsyncIterable<{ record: string[]; info: { lines: number } }>) {
      run.counts.recordsDiscovered++;
      batch.push({ line: entry.info.lines, record: entry.record });
      if (batch.length >= BATCH) await processBatch();
    }
    await processBatch();
    run.counts.recordsDiscovered += rejections.filter((r) => r.reasons[0].startsWith("csv_parse_error")).length;

    for (const r of rejections) {
      await RejectedRecord.updateOne(
        { sourceDocumentId: doc._id, extractionVersion: DLD_EXTRACTION_VERSION, locator: r.locator },
        { $set: { documentType: kind === "transactions" ? "dld_transactions_csv" : "dld_projects_csv", ingestionRunId: run.id, raw: r.raw, reasons: r.reasons } },
        { upsert: true },
      );
    }
    run.counts.recordsRejected = rejections.length;

    if (kind === "projects") await relinkDevelopers();
    await relinkProjects();
    await runTransactionMatchChecks();

    if (run.counts.recordsDiscovered === 0) run.errors.push("The file has a header but no data rows.");
    const usable = accepted + run.counts.recordsSkipped;
    const status = run.errors.length || rejections.length ? (usable === 0 ? "failed" : "completed_with_errors") : "completed";
    await SourceDocument.updateOne(
      { _id: doc._id },
      {
        $set: {
          extractionStatus: status === "failed" ? "failed" : status === "completed" ? "completed" : "completed_with_warnings",
          recordsExtracted: run.counts.recordsDiscovered,
          recordsAccepted: accepted,
          recordsRejected: rejections.length,
          warnings: run.warnings.slice(0, 50),
        },
      },
    );
    await finishRun(run, status, { sourceDocumentId: doc._id, publishedDate: latestDate });
    return {
      runId: String(run.id),
      status,
      message: `${kind === "transactions" ? "Transactions" : "Project register"}: ${run.counts.recordsCreated} new, ${run.counts.recordsSkipped} already stored, ${rejections.length} rejected (of ${run.counts.recordsDiscovered} rows).`,
      sourceDocumentId: String(doc._id),
    };
  } catch (err) {
    const msg = errorMessage(err);
    if (docId) await SourceDocument.updateOne({ _id: docId }, { $set: { extractionStatus: "failed" } }).catch(() => undefined);
    if (run) {
      run.errors.push(msg);
      await finishRun(run, "failed", { sourceDocumentId: docId }).catch(() => undefined);
      return { runId: String(run.id), status: "failed", message: msg, sourceDocumentId: docId ? String(docId) : undefined };
    }
    if (err instanceof SourceFileError) {
      const failed = await recordFailedAttempt({ sourceKey: kind ? SOURCE_KEYS[kind] : "dld_transactions_csv", trigger, filename: filePath.split(/[\\/]/).pop(), message: msg });
      return { runId: String(failed._id), status: "failed", message: msg };
    }
    throw err;
  }
}

/**
 * Normalized DLD project name -> developer, from the latest observation of each project number.
 * Names claimed by more than one developer are left out (ambiguous) and flagged.
 */
export async function developerRegister(): Promise<Map<string, { developerName?: string; developerNumber?: string }>> {
  const latest = await DldProjectObservation.aggregate<{ _id: string; normalizedName: string; developerName?: string; developerNumber?: string }>([
    { $sort: { retrievedAt: -1, _id: -1 } },
    { $group: { _id: "$projectNumber", normalizedName: { $first: "$normalizedName" }, developerName: { $first: "$developerName" }, developerNumber: { $first: "$developerNumber" } } },
  ]);
  const byName = new Map<string, Array<{ developerName?: string; developerNumber?: string }>>();
  for (const p of latest) {
    if (!p.developerName) continue;
    const list = byName.get(p.normalizedName) ?? [];
    if (!list.some((d) => d.developerName === p.developerName)) list.push({ developerName: p.developerName, developerNumber: p.developerNumber });
    byName.set(p.normalizedName, list);
  }
  const out = new Map<string, { developerName?: string; developerNumber?: string }>();
  for (const [name, devs] of byName) {
    if (devs.length === 1) out.set(name, devs[0]);
    else {
      await upsertIssue({
        key: `ambiguous_developer:${name}`,
        entityType: "DldProjectObservation",
        entityId: name,
        rule: "ambiguous_developer_for_project_name",
        severity: "warning",
        details: `The DLD project name "${name}" belongs to several developers (${devs.map((d) => d.developerName).join(", ")}); transactions with this name are left unattributed.`,
      });
    }
  }
  return out;
}

/** Attribute previously unattributed transactions once the project register is available. */
export async function relinkDevelopers() {
  const register = await developerRegister();
  for (const [name, dev] of register) {
    await MarketTransaction.updateMany(
      { projectNormalizedName: name, developerMatchMethod: "none" },
      { $set: { developerName: dev.developerName, developerNumber: dev.developerNumber, developerMatchMethod: "dld_project_register_exact" } },
    );
  }
}

/** Link unlinked transactions to projects by exact name/alias key. */
export async function relinkProjects() {
  for (const p of await Project.find().select("_id matchKeys").lean()) {
    await MarketTransaction.updateMany(
      { projectNormalizedName: { $in: p.matchKeys }, projectId: null },
      { $set: { projectId: p._id, matchMethod: "exact_alias", matchConfidence: "high" } },
    );
  }
}
