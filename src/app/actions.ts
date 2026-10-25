"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { checkUaeCoordinates } from "@/lib/geo";
import { cleanText, parseDateOnly } from "@/lib/normalize";
import { DatabaseUnavailableError, requireDb } from "@/server/db";
import { RunInProgressError } from "@/server/ingest/runs";
import {
  importDldFile,
  importDldFolder,
  importExpectedPdfs,
  importPdfFile,
  prepareDatabase,
  resolveListedFile,
} from "@/server/ingest/service";
import { CLAIM_TYPES, DataQualityIssue, EVENT_TYPES, GEO_PRECISIONS, Project, PublicEvent } from "@/server/models";
import { addProjectAlias, AliasConflictError, mergeProjects } from "@/server/projects";
import { toObjectId } from "@/server/queries/common";

export interface ActionResult {
  ok: boolean;
  message: string;
  details?: string[];
}

/** Map known errors to safe messages; anything unexpected is logged server-side only. */
function failure(err: unknown): ActionResult {
  if (err instanceof RunInProgressError || err instanceof AliasConflictError) return { ok: false, message: err.message };
  if (err instanceof DatabaseUnavailableError) return { ok: false, message: err.message };
  if (err instanceof Error && /^Mongo(ServerSelection|NetworkTimeout|Network)Error$/.test(err.name)) return { ok: false, message: "MongoDB is not reachable right now. Check the connection and try again." };
  if (err instanceof Error && err.message.startsWith("Invalid environment")) return { ok: false, message: err.message };
  // A plain string: raw driver errors carry objects the dev server cannot forward to the browser.
  console.error(`[action] ${err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err)}`);
  return { ok: false, message: "The action failed unexpectedly. See the server log for details." };
}

function summarize(results: Array<{ filename: string; result: { status: string; message: string } }>): ActionResult {
  if (results.length === 0) return { ok: false, message: "No files found to import." };
  const failed = results.filter((r) => r.result.status === "failed").length;
  return {
    ok: failed === 0,
    message: failed ? `${failed} of ${results.length} import(s) failed — see Recent runs.` : `${results.length} import(s) finished.`,
    details: results.map((r) => `${r.filename}: ${r.result.status.replace(/_/g, " ")} — ${r.result.message}`),
  };
}

function refreshAll() {
  revalidatePath("/", "layout");
}

export async function importExpectedPdfsAction(_prev: ActionResult | null, _form: FormData): Promise<ActionResult> {
  try {
    const res = await importExpectedPdfs("ui");
    refreshAll();
    return summarize(res);
  } catch (err) {
    return failure(err);
  }
}

const pdfImportSchema = z.object({ name: z.string().min(1).max(255), kind: z.enum(["inventory", "brochure"]) });

export async function importIncomingPdfAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = pdfImportSchema.safeParse({ name: form.get("name"), kind: form.get("kind") });
  if (!parsed.success) return { ok: false, message: "Choose a file and a document type." };
  try {
    const full = await resolveListedFile(getEnv().INCOMING_DIR, parsed.data.name, /\.pdf$/i);
    if (!full) return { ok: false, message: "That file is not in data/incoming." };
    const result = await importPdfFile(full, parsed.data.kind, "ui");
    refreshAll();
    return summarize([{ filename: parsed.data.name, result }]);
  } catch (err) {
    return failure(err);
  }
}

export async function importDldFolderAction(_prev: ActionResult | null, _form: FormData): Promise<ActionResult> {
  try {
    const res = await importDldFolder("ui");
    refreshAll();
    return res.length ? summarize(res) : { ok: false, message: "No CSV files in data/incoming/dld." };
  } catch (err) {
    return failure(err);
  }
}

export async function uploadDldAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a non-empty CSV file." };
  const { MAX_UPLOAD_BYTES, DLD_DIR } = getEnv();
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, message: `File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` };
  if (!/\.csv$/i.test(file.name)) return { ok: false, message: "Only .csv files exported from the DLD Real Estate Data page are accepted." };
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 4096).includes(0)) return { ok: false, message: "The file is not a text CSV." };
    await fs.mkdir(DLD_DIR, { recursive: true });
    const safe = path.basename(file.name).replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
    const target = path.join(DLD_DIR, `${stamp}-${safe}`);
    // The original upload is kept as-is; "wx" never overwrites an existing file.
    await fs.writeFile(target, bytes, { flag: "wx" });
    const result = await importDldFile(target, "ui");
    refreshAll();
    return summarize([{ filename: file.name, result }]);
  } catch (err) {
    return failure(err);
  }
}

const eventSchema = z.object({
  title: z.string().trim().min(5).max(300),
  eventType: z.enum(EVENT_TYPES),
  url: z
    .string()
    .trim()
    .max(2000)
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "URL must start with http:// or https://"),
  publisher: z.string().trim().min(2).max(200),
  publicationDate: z.string().optional(),
  eventDate: z.string().optional(),
  summary: z.string().trim().min(10).max(2000),
  claimType: z.enum(CLAIM_TYPES),
  projectIds: z.array(z.string()).max(50),
});

export async function createEventAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = eventSchema.safeParse({
    title: form.get("title"),
    eventType: form.get("eventType"),
    url: form.get("url"),
    publisher: form.get("publisher"),
    publicationDate: form.get("publicationDate") || undefined,
    eventDate: form.get("eventDate") || undefined,
    summary: form.get("summary"),
    claimType: form.get("claimType"),
    projectIds: form.getAll("projectIds").map(String),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`).join("; ") };
  const d = parsed.data;
  const publicationDate = d.publicationDate ? parseDateOnly(d.publicationDate) : null;
  const eventDate = d.eventDate ? parseDateOnly(d.eventDate) : null;
  if (d.publicationDate && !publicationDate) return { ok: false, message: "Publication date is not a valid date." };
  if (d.eventDate && !eventDate) return { ok: false, message: "Event date is not a valid date." };
  try {
    await prepareDatabase();
    const projectIds = d.projectIds.map(toObjectId).filter((x) => x !== null);
    const now = new Date();
    await PublicEvent.create({
      title: cleanText(d.title),
      titleNormalized: cleanText(d.title).toLowerCase(),
      eventType: d.eventType,
      url: d.url,
      publisher: d.publisher,
      publicationDate,
      eventDate,
      summary: d.summary,
      claimType: d.claimType,
      projectIds,
      retrievedAt: now,
      sourceReferences: [{ sourceType: "public_web", url: d.url, publishedAt: publicationDate ?? undefined, retrievedAt: now, claimType: d.claimType, verificationStatus: "unverified" }],
    });
    refreshAll();
    return { ok: true, message: "Announcement recorded." };
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return { ok: false, message: "An event with this URL and title already exists." };
    return failure(err);
  }
}

export async function retractEventAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = toObjectId(String(form.get("id") ?? ""));
  const reason = cleanText(form.get("reason"));
  if (!id || reason.length < 5) return { ok: false, message: "Give a reason (at least 5 characters)." };
  try {
    await requireDb();
    const res = await PublicEvent.updateOne({ _id: id, retractedAt: null }, { $set: { retractedAt: new Date(), retractionReason: reason.slice(0, 500) } });
    refreshAll();
    return res.modifiedCount ? { ok: true, message: "Event retracted (kept for history)." } : { ok: false, message: "Event not found or already retracted." };
  } catch (err) {
    return failure(err);
  }
}

export async function addAliasAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = toObjectId(String(form.get("projectId") ?? ""));
  const alias = cleanText(form.get("alias")).slice(0, 200);
  const note = cleanText(form.get("note")).slice(0, 500);
  if (!id || alias.length < 2) return { ok: false, message: "Enter the alias exactly as it appears in the source." };
  if (note.length < 5) return { ok: false, message: "Record the evidence for this alias (at least 5 characters)." };
  try {
    await prepareDatabase();
    const linked = await addProjectAlias(id, alias, note);
    refreshAll();
    return { ok: true, message: `Alias added. ${linked} DLD transaction(s) linked by exact name.` };
  } catch (err) {
    return failure(err);
  }
}

export async function mergeProjectAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const source = toObjectId(String(form.get("sourceId") ?? ""));
  const target = toObjectId(String(form.get("targetId") ?? ""));
  const note = cleanText(form.get("note")).slice(0, 500);
  if (!source || !target) return { ok: false, message: "Choose the project to merge into." };
  if (note.length < 5) return { ok: false, message: "Record why these are the same project." };
  try {
    await prepareDatabase();
    const exists = await Project.exists({ _id: target });
    if (!exists) return { ok: false, message: "Target project not found." };
    await mergeProjects(source, target, note);
    refreshAll();
    return { ok: true, message: "Projects merged. Open the target project to continue." };
  } catch (err) {
    return failure(err);
  }
}

const locationSchema = z.object({
  precision: z.enum(GEO_PRECISIONS),
  source: z.string().trim().min(5, "Describe where the position comes from (at least 5 characters).").max(300),
  sourceUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => u === "" || /^https?:\/\//i.test(u), "Source URL must start with http:// or https://")
    .optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Record a project's map position after a person checked it. The previous position stays in
 * geoHistory; nothing is geocoded automatically.
 */
export async function setProjectLocationAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = toObjectId(String(form.get("projectId") ?? ""));
  if (!id) return { ok: false, message: "Choose a project." };
  const coords = checkUaeCoordinates(form.get("lat"), form.get("lng"));
  if (!coords.ok) return { ok: false, message: coords.reason };
  const parsed = locationSchema.safeParse({
    precision: form.get("precision"),
    source: form.get("source"),
    sourceUrl: form.get("sourceUrl") ?? "",
    note: form.get("note") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  const d = parsed.data;
  try {
    await requireDb();
    const now = new Date();
    const geo = { lat: coords.lat, lng: coords.lng, precision: d.precision, source: d.source, sourceUrl: d.sourceUrl || undefined, note: d.note || undefined, recordedAt: now };
    const res = await Project.updateOne({ _id: id }, { $set: { geo }, $push: { geoHistory: { action: "set", lat: geo.lat, lng: geo.lng, precision: geo.precision, source: geo.source, sourceUrl: geo.sourceUrl, note: geo.note, at: now } } });
    if (!res.matchedCount) return { ok: false, message: "Project not found." };
    refreshAll();
    return { ok: true, message: `Position saved as ${d.precision} (${coords.lat}, ${coords.lng}).` };
  } catch (err) {
    return failure(err);
  }
}

export async function clearProjectLocationAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = toObjectId(String(form.get("projectId") ?? ""));
  const reason = cleanText(form.get("reason")).slice(0, 500);
  if (!id) return { ok: false, message: "Choose a project." };
  if (reason.length < 5) return { ok: false, message: "Give a reason for removing the position (at least 5 characters)." };
  try {
    await requireDb();
    const res = await Project.updateOne({ _id: id, geo: { $exists: true } }, { $unset: { geo: "" }, $push: { geoHistory: { action: "cleared", note: reason, at: new Date() } } });
    refreshAll();
    return res.modifiedCount ? { ok: true, message: "Position removed (kept in the location history)." } : { ok: false, message: "This project has no recorded position." };
  } catch (err) {
    return failure(err);
  }
}

export async function resolveIssueAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = toObjectId(String(form.get("id") ?? ""));
  const note = cleanText(form.get("note")).slice(0, 500);
  if (!id || note.length < 5) return { ok: false, message: "Add a resolution note (at least 5 characters)." };
  try {
    await requireDb();
    await DataQualityIssue.updateOne({ _id: id }, { $set: { resolvedAt: new Date(), resolutionNote: note } });
    refreshAll();
    return { ok: true, message: "Marked as reviewed." };
  } catch (err) {
    return failure(err);
  }
}
