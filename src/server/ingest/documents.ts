import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SourceDocument, type DocumentType } from "@/server/models";
import { upsertIssue } from "@/server/quality";

export const MAX_SOURCE_FILE_BYTES = 500 * 1024 * 1024;

export class SourceFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceFileError";
  }
}

export interface LoadedFile {
  filename: string;
  bytes: Buffer;
  sha256: string;
}

/** Read a local source file with size checks. The original file is never modified. */
export async function loadSourceFile(filePath: string): Promise<LoadedFile> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    throw new SourceFileError(`File not found: ${path.basename(filePath)}`);
  }
  if (!stat.isFile()) throw new SourceFileError(`Not a file: ${path.basename(filePath)}`);
  if (stat.size === 0) throw new SourceFileError(`File is empty: ${path.basename(filePath)}`);
  if (stat.size > MAX_SOURCE_FILE_BYTES) throw new SourceFileError(`File is larger than ${MAX_SOURCE_FILE_BYTES / 1024 / 1024} MB: ${path.basename(filePath)}`);
  const bytes = await fs.readFile(filePath);
  return { filename: path.basename(filePath), bytes, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

/**
 * Register a document by content hash. The same bytes always map to the same SourceDocument; a
 * different file with the same name becomes a new document (the earlier one is preserved) and a
 * data-quality note is recorded.
 */
export async function registerDocument(file: LoadedFile, documentType: DocumentType, metadata: Record<string, unknown> = {}) {
  const existing = await SourceDocument.findOne({ sha256: file.sha256 });
  if (existing) {
    if (existing.documentType !== documentType) {
      throw new SourceFileError(
        `This file (sha256 ${file.sha256.slice(0, 12)}…) was already imported as ${existing.documentType}; it cannot also be imported as ${documentType}.`,
      );
    }
    return { doc: existing, isNew: false };
  }
  const sameName = await SourceDocument.find({ filename: file.filename, documentType }).select("_id sha256 importedAt").lean();
  let doc;
  try {
    doc = await SourceDocument.create({
      filename: file.filename,
      sha256: file.sha256,
      documentType,
      sizeBytes: file.bytes.length,
      importedAt: new Date(),
      metadata,
    });
  } catch (err) {
    // Concurrent registration of the same bytes: return the winner.
    const again = await SourceDocument.findOne({ sha256: file.sha256 });
    if (again) return { doc: again, isNew: false };
    throw err;
  }
  if (sameName.length > 0) {
    await upsertIssue({
      key: `modified_file:${doc._id}`,
      entityType: "SourceDocument",
      entityId: String(doc._id),
      rule: "same_filename_new_content",
      severity: "info",
      details: `"${file.filename}" was imported before with different content (${sameName.length} earlier version(s)). Earlier versions and their observations are preserved.`,
    });
  }
  return { doc, isNew: true };
}
