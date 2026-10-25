import path from "node:path";
import type { Types } from "mongoose";
import { PROJECT_NAME_HINTS } from "@/lib/project-hints";
import { BrochurePage, Project, ProjectFactObservation, SourceDocument } from "@/server/models";
import { resolveOrCreateProject } from "@/server/projects";
import { runProjectAliasChecks } from "@/server/quality";
import { extractBrochureFacts } from "./brochure-facts";
import { loadSourceFile, registerDocument, SourceFileError } from "./documents";
import type { ImportResult } from "./inventory-import";
import { buildProjectNameMatcher, groupLines } from "./pdf-table";
import { readPdfText } from "./pdf-text";
import { errorMessage, finishRun, recordFailedAttempt, startRun, type RunHandle } from "./runs";

export const BROCHURE_EXTRACTION_VERSION = "brochure-pdf@1";
const SOURCE_KEY = "merge1_pdf";
/** A page with no project name inherits the previous page's project for at most this many pages. */
const MAX_CARRY_PAGES = 12;

type Attribution = "single_name_match" | "carried_forward" | "ambiguous" | "none";

/** Decide which project a page is about from the names found on it. */
export function attributePage(names: string[], carried: { name: string; pages: number } | null): { attribution: Attribution; name: string | null } {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  if (counts.size === 1) return { attribution: "single_name_match", name: names[0] };
  if (counts.size > 1) {
    // One name clearly dominating (>= 75% of mentions, at least 3) is treated as the page subject.
    const [top, topN] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return topN >= 3 && topN / names.length >= 0.75 ? { attribution: "single_name_match", name: top } : { attribution: "ambiguous", name: null };
  }
  if (carried && carried.pages < MAX_CARRY_PAGES) return { attribution: "carried_forward", name: carried.name };
  return { attribution: "none", name: null };
}

export async function importBrochurePdf(filePath: string, trigger: "cli" | "ui" | "test"): Promise<ImportResult> {
  let run: RunHandle | null = null;
  let docId: Types.ObjectId | undefined;
  try {
    const file = await loadSourceFile(filePath);
    const { doc } = await registerDocument(file, "merge1_brochure");
    docId = doc._id;
    run = await startRun({ sourceKey: SOURCE_KEY, trigger, filename: file.filename, sourceDocumentId: doc._id });
    if (doc.extractionVersion === BROCHURE_EXTRACTION_VERSION && (doc.extractionStatus === "completed" || doc.extractionStatus === "completed_with_warnings")) {
      run.warnings.push(`Identical file (sha256 ${file.sha256.slice(0, 12)}…) was already imported with ${BROCHURE_EXTRACTION_VERSION}; nothing to do.`);
      await finishRun(run, "skipped", { sourceDocumentId: doc._id });
      return { runId: String(run.id), status: "skipped", message: run.warnings[0], sourceDocumentId: String(doc._id) };
    }
    await SourceDocument.updateOne({ _id: doc._id }, { $set: { extractionStatus: "running", extractionVersion: BROCHURE_EXTRACTION_VERSION } });
    const pdf = await readPdfText(new Uint8Array(file.bytes));
    await SourceDocument.updateOne({ _id: doc._id }, { $set: { pageCount: pdf.pageCount } });

    const existingNames = (await Project.find().select("name aliases").lean()).flatMap((p) => [p.name, ...p.aliases.map((a) => a.name ?? "")]);
    const matcher = buildProjectNameMatcher([...PROJECT_NAME_HINTS, ...existingNames]);
    const now = new Date();
    let carried: { name: string; pages: number } | null = null;
    const noText: number[] = [];
    const counts = { single_name_match: 0, carried_forward: 0, ambiguous: 0, none: 0 };
    let factsCreated = 0;
    let factsExisting = 0;

    for (const page of pdf.pages) {
      if (page.error) {
        run.errors.push(`Page ${page.page} could not be parsed: ${page.error}`);
        continue;
      }
      const lines = groupLines(page.items);
      const text = lines.map((l) => l.text).join("\n");
      if (page.items.length === 0) noText.push(page.page);
      const names = matcher(text);
      const { attribution, name } = attributePage(names, carried);
      counts[attribution]++;
      carried = attribution === "single_name_match" ? { name: name!, pages: 0 } : attribution === "carried_forward" && carried ? { name: carried.name, pages: carried.pages + 1 } : attribution === "ambiguous" ? null : carried;

      const projectIds: Types.ObjectId[] = [];
      for (const n of new Set(names)) {
        const id = await resolveOrCreateProject(n, { sourceType: "local_document", sourceDocumentId: doc._id, page: page.page, claimType: "marketing_claim" });
        if (id) projectIds.push(id);
      }
      const subjectId = name ? await resolveOrCreateProject(name, { sourceType: "local_document", sourceDocumentId: doc._id, page: page.page, claimType: "marketing_claim" }) : null;

      // Page text is derived from the immutable PDF; re-extraction may refresh detection fields.
      await BrochurePage.updateOne(
        { sourceDocumentId: doc._id, page: page.page },
        { $set: { text, charCount: text.length, hasTextLayer: page.items.length > 0, detectedProjectIds: projectIds, detectedNames: [...new Set(names)], attribution } },
        { upsert: true },
      );

      if (subjectId) {
        const facts = extractBrochureFacts(lines);
        for (const f of facts) {
          const res = await ProjectFactObservation.updateOne(
            { projectId: subjectId, sourceDocumentId: doc._id, sourcePage: page.page, category: f.category, value: f.value },
            {
              $setOnInsert: {
                extractedText: f.extractedText,
                observedAt: now,
                claimType: "marketing_claim",
                verificationStatus: "unverified",
                confidence: attribution === "single_name_match" ? "medium" : "low",
                attributionMethod: attribution,
                notes: "Extracted automatically from brochure text; review against the page before relying on it.",
              },
            },
            { upsert: true },
          );
          if (res.upsertedCount) factsCreated++;
          else factsExisting++;
        }
      }
      run.counts.recordsDiscovered++;
      await run.heartbeat();
    }
    run.counts.recordsCreated = factsCreated;
    run.counts.recordsSkipped = factsExisting;
    if (noText.length) run.warnings.push(`${noText.length} page(s) have no text layer (OCR not supported): ${noText.slice(0, 30).join(", ")}${noText.length > 30 ? ", …" : ""}`);
    if (counts.ambiguous) run.warnings.push(`${counts.ambiguous} page(s) mention several projects; no facts were attributed from them.`);
    if (counts.none) run.warnings.push(`${counts.none} page(s) could not be linked to any project.`);
    await runProjectAliasChecks();

    const allBlank = noText.length === pdf.pageCount;
    const status = allBlank || run.errors.length ? (allBlank ? "failed" : "completed_with_errors") : "completed";
    if (allBlank) run.errors.push("No page has a text layer; the document appears to be scanned images. OCR is not supported.");
    await SourceDocument.updateOne(
      { _id: doc._id },
      {
        $set: {
          extractionStatus: status === "failed" ? "failed" : run.warnings.length || run.errors.length ? "completed_with_warnings" : "completed",
          recordsExtracted: pdf.pageCount,
          recordsAccepted: factsCreated + factsExisting,
          recordsRejected: 0,
          warnings: run.warnings,
          metadata: { ...doc.metadata, pageAttribution: counts },
        },
      },
    );
    await finishRun(run, status, { sourceDocumentId: doc._id });
    return {
      runId: String(run.id),
      status,
      message: `${pdf.pageCount} pages read; ${counts.single_name_match} linked by name, ${counts.carried_forward} carried forward, ${counts.ambiguous} ambiguous, ${counts.none} unlinked; ${factsCreated} new brochure claims stored.`,
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
