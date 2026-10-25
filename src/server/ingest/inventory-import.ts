import path from "node:path";
import type { Types } from "mongoose";
import { PROJECT_NAME_HINTS } from "@/lib/project-hints";
import { InventorySnapshot, InventoryUnitObservation, Project, RejectedRecord, SourceDocument } from "@/server/models";
import { resolveOrCreateProject } from "@/server/projects";
import { runInventoryChecks, runProjectAliasChecks, upsertIssue } from "@/server/quality";
import { loadSourceFile, registerDocument, SourceFileError } from "./documents";
import { normalizeInventoryRow } from "./inventory-rows";
import { buildProjectNameMatcher, detectSnapshotDate, extractInventoryTable } from "./pdf-table";
import { readPdfText } from "./pdf-text";
import { errorMessage, finishRun, recordFailedAttempt, startRun, type RunHandle } from "./runs";

export const INVENTORY_EXTRACTION_VERSION = "inventory-pdf@1";
const SOURCE_KEY = "merge2_pdf";
const BATCH = 500;

export interface ImportResult {
  runId: string;
  status: string;
  message: string;
  sourceDocumentId?: string;
}

function pdfMetadata(info: Record<string, unknown>) {
  const pick = (k: string) => (typeof info[k] === "string" ? (info[k] as string) : undefined);
  return {
    pdfTitle: pick("Title"),
    pdfAuthor: pick("Author"),
    pdfProducer: pick("Producer"),
    pdfCreator: pick("Creator"),
    // Recorded for reference only; never used as the inventory snapshot date.
    pdfCreationDateRaw: pick("CreationDate"),
    pdfModDateRaw: pick("ModDate"),
  };
}

export async function importInventoryPdf(filePath: string, trigger: "cli" | "ui" | "test"): Promise<ImportResult> {
  let run: RunHandle | null = null;
  let docId: Types.ObjectId | undefined;
  try {
    const file = await loadSourceFile(filePath);
    const { doc } = await registerDocument(file, "merge2_inventory");
    docId = doc._id;
    run = await startRun({ sourceKey: SOURCE_KEY, trigger, filename: file.filename, sourceDocumentId: doc._id });

    if (doc.extractionVersion === INVENTORY_EXTRACTION_VERSION && (doc.extractionStatus === "completed" || doc.extractionStatus === "completed_with_warnings")) {
      run.warnings.push(`Identical file (sha256 ${file.sha256.slice(0, 12)}…) was already imported with ${INVENTORY_EXTRACTION_VERSION}; nothing to do.`);
      await finishRun(run, "skipped", { sourceDocumentId: doc._id });
      return { runId: String(run.id), status: "skipped", message: run.warnings[0], sourceDocumentId: String(doc._id) };
    }

    await SourceDocument.updateOne({ _id: doc._id }, { $set: { extractionStatus: "running", extractionVersion: INVENTORY_EXTRACTION_VERSION } });
    const pdf = await readPdfText(new Uint8Array(file.bytes));
    await SourceDocument.updateOne({ _id: doc._id }, { $set: { pageCount: pdf.pageCount, metadata: { ...doc.metadata, ...pdfMetadata(pdf.info) } } });

    const existingNames = (await Project.find().select("name aliases").lean()).flatMap((p) => [p.name, ...p.aliases.map((a) => a.name ?? "")]);
    const matcher = buildProjectNameMatcher([...PROJECT_NAME_HINTS, ...existingNames]);
    const headingMatcher = (text: string) => {
      const found = [...new Set(matcher(text))];
      return found.length === 1 ? found[0] : null;
    };
    const table = extractInventoryTable(pdf.pages, headingMatcher);

    for (const p of table.pagesWithErrors) run.errors.push(`Page ${p.page} could not be parsed: ${p.error}`);
    if (table.pagesWithoutText.length > 0) {
      run.warnings.push(
        `${table.pagesWithoutText.length} page(s) have no text layer (${table.pagesWithoutText.slice(0, 20).join(", ")}${table.pagesWithoutText.length > 20 ? ", …" : ""}). OCR is not supported, so any data on them was not extracted.`,
      );
    }
    if (table.rows.length === 0) {
      run.errors.push(
        table.headerLayouts.length === 0
          ? "No inventory table header was recognized (expected columns such as Unit No, Type, Size, View, Price, Status). The PDF layout needs review; nothing was imported."
          : "A table header was found but no data rows could be read.",
      );
      await SourceDocument.updateOne({ _id: doc._id }, { $set: { extractionStatus: "failed", warnings: run.warnings } });
      await finishRun(run, "failed", { sourceDocumentId: doc._id });
      return { runId: String(run.id), status: "failed", message: run.errors[0], sourceDocumentId: String(doc._id) };
    }

    const snapDate = detectSnapshotDate(pdf.pages);
    if (snapDate.status !== "from_document") {
      run.warnings.push(
        snapDate.status === "ambiguous"
          ? `Several different dates are printed (${[...new Set(snapDate.evidence.map((e) => e.date))].join(", ")}); snapshot date left unknown.`
          : "No snapshot date is printed in the document; snapshot date is unknown (the import date is NOT used).",
      );
    }
    const snapshot = await InventorySnapshot.findOneAndUpdate(
      { sourceDocumentId: doc._id, extractionVersion: INVENTORY_EXTRACTION_VERSION },
      {
        $setOnInsert: { importedAt: new Date() },
        $set: {
          snapshotDate: snapDate.date,
          snapshotDateStatus: snapDate.status,
          snapshotDateEvidence: snapDate.evidence[0] ? { page: snapDate.evidence[0].page, text: snapDate.evidence[0].text } : undefined,
          superseded: false,
        },
      },
      { upsert: true, new: true },
    );
    // Older extraction versions of the same document stay stored but leave the metrics.
    await InventorySnapshot.updateMany(
      { sourceDocumentId: doc._id, extractionVersion: { $ne: INVENTORY_EXTRACTION_VERSION } },
      { $set: { superseded: true } },
    );

    const projectCache = new Map<string, Types.ObjectId | null>();
    const projectFor = async (name: string | null, page: number) => {
      if (!name) return null;
      if (!projectCache.has(name)) {
        projectCache.set(
          name,
          await resolveOrCreateProject(name, { sourceType: "local_document", sourceDocumentId: doc._id, page, claimType: "documented" }),
        );
      }
      return projectCache.get(name) ?? null;
    };

    run.counts.recordsDiscovered = table.rows.length + table.unplaced.length;
    let accepted = 0;
    let rejected = 0;
    const obsOps: Parameters<typeof InventoryUnitObservation.bulkWrite>[0] = [];
    const rejOps: Parameters<typeof RejectedRecord.bulkWrite>[0] = [];

    const flush = async () => {
      if (obsOps.length) {
        const res = await InventoryUnitObservation.bulkWrite(obsOps.splice(0), { ordered: false });
        run!.counts.recordsCreated += res.upsertedCount;
        run!.counts.recordsSkipped += res.matchedCount;
      }
      if (rejOps.length) await RejectedRecord.bulkWrite(rejOps.splice(0), { ordered: false });
      await run!.heartbeat();
    };

    for (const row of table.rows) {
      const result = normalizeInventoryRow(row);
      if (!result.ok) {
        rejected++;
        rejOps.push({
          updateOne: {
            filter: { sourceDocumentId: doc._id, extractionVersion: INVENTORY_EXTRACTION_VERSION, locator: `p${row.page}:l${row.lineIndex}` },
            update: { $set: { documentType: "merge2_inventory", ingestionRunId: run.id, raw: result.originalValues, reasons: result.reasons } },
            upsert: true,
          },
        });
      } else {
        accepted++;
        const projectId = await projectFor(result.value.projectNameAsListed, row.page);
        obsOps.push({
          updateOne: {
            filter: { snapshotId: snapshot._id, sourcePage: row.page, lineIndex: row.lineIndex },
            update: { $setOnInsert: { ...result.value, projectId, sourceDocumentId: doc._id, snapshotId: snapshot._id, sourcePage: row.page, lineIndex: row.lineIndex } },
            upsert: true,
          },
        });
      }
      if (obsOps.length + rejOps.length >= BATCH) await flush();
    }
    for (const u of table.unplaced) {
      rejected++;
      rejOps.push({
        updateOne: {
          filter: { sourceDocumentId: doc._id, extractionVersion: INVENTORY_EXTRACTION_VERSION, locator: `p${u.page}:l${u.lineIndex}` },
          update: { $set: { documentType: "merge2_inventory", ingestionRunId: run.id, raw: { _line: u.text }, reasons: [u.reason] } },
          upsert: true,
        },
      });
    }
    await flush();
    run.counts.recordsRejected = rejected;

    if (table.areaUnit === "mixed") run.warnings.push("Area columns use different units on different pages; sq m values were converted to sq ft (flagged per row).");
    const snapshotWarnings = [...run.warnings];
    await InventorySnapshot.updateOne(
      { _id: snapshot._id },
      { $set: { recordCount: accepted, rejectedCount: rejected, warnings: snapshotWarnings } },
    );

    await runInventoryChecks(snapshot._id, doc._id);
    await runProjectAliasChecks();
    if (snapDate.status !== "from_document") {
      await upsertIssue({
        key: `snapshot_date:${snapshot._id}`,
        entityType: "InventorySnapshot",
        entityId: String(snapshot._id),
        rule: "snapshot_date_unknown",
        severity: "warning",
        details: `${file.filename}: ${snapshotWarnings.find((w) => w.includes("date")) ?? "Snapshot date unknown."} Prices and statuses cannot be placed in time; comparisons across snapshots are disabled for it.`,
        sourceReferences: [{ sourceType: "local_document", sourceDocumentId: doc._id, claimType: "documented" }],
      });
    }

    const hasProblems = rejected > 0 || run.errors.length > 0 || table.pagesWithoutText.length > 0;
    await SourceDocument.updateOne(
      { _id: doc._id },
      {
        $set: {
          extractionStatus: hasProblems ? "completed_with_warnings" : "completed",
          recordsExtracted: table.rows.length + table.unplaced.length,
          recordsAccepted: accepted,
          recordsRejected: rejected,
          warnings: snapshotWarnings,
        },
      },
    );
    const status = hasProblems ? "completed_with_errors" : "completed";
    await finishRun(run, status, { sourceDocumentId: doc._id, publishedDate: snapDate.date });
    return {
      runId: String(run.id),
      status,
      message: `${accepted} unit rows accepted (${run.counts.recordsCreated} new, ${run.counts.recordsSkipped} already stored), ${rejected} rejected or unplaced, from ${pdf.pageCount} pages.`,
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
      const failed = await recordFailedAttempt({ sourceKey: SOURCE_KEY, trigger, filename: path.basename(filePath), message: msg });
      return { runId: String(failed._id), status: "failed", message: msg };
    }
    throw err;
  }
}
