import type { Types } from "mongoose";
import { getSourceDefinition, SOURCE_DEFINITIONS } from "@/lib/sources";
import { DataSource, IngestionRun, type RunStatus } from "@/server/models";

/** A run with no heartbeat for this long is treated as interrupted (process died or was stopped). */
export const STALE_RUN_MS = 15 * 60 * 1000;

export class RunInProgressError extends Error {
  constructor(sourceKey: string) {
    super(`An import for "${sourceKey}" is already running. Wait for it to finish (or for it to time out after 15 minutes without progress).`);
    this.name = "RunInProgressError";
  }
}

/** Create DataSource rows for every defined source (configuration only; never touches freshness fields). */
export async function syncDataSources() {
  for (const def of SOURCE_DEFINITIONS) {
    await DataSource.updateOne(
      { key: def.key },
      {
        $set: {
          name: def.name,
          sourceType: def.sourceType,
          publisher: def.publisher,
          url: def.url,
          accessMethod: def.accessMethod,
          refreshFrequency: def.refreshFrequency,
          usageNotes: def.usageNotes,
        },
        $setOnInsert: { status: def.initialStatus },
      },
      { upsert: true },
    );
  }
}

/** Mark runs that stopped heart-beating as interrupted so their state is truthful. */
export async function markStaleRuns(now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_RUN_MS);
  await IngestionRun.updateMany(
    { status: "running", $or: [{ heartbeatAt: { $lt: cutoff } }, { heartbeatAt: null, startedAt: { $lt: cutoff } }] },
    { $set: { status: "interrupted", completedAt: now }, $push: { errors: "Run stopped reporting progress (process ended or was interrupted). Re-run the import; completed records are not duplicated." } },
  );
}

export interface RunHandle {
  id: Types.ObjectId;
  sourceKey: string;
  counts: { recordsDiscovered: number; recordsCreated: number; recordsUpdated: number; recordsSkipped: number; recordsRejected: number };
  errors: string[];
  warnings: string[];
  heartbeat: () => Promise<void>;
}

export async function startRun(opts: { sourceKey: string; trigger: "cli" | "ui" | "test"; filename?: string; sourceDocumentId?: Types.ObjectId }): Promise<RunHandle> {
  await markStaleRuns();
  const running = await IngestionRun.findOne({ sourceKey: opts.sourceKey, status: "running" }).lean();
  if (running) throw new RunInProgressError(opts.sourceKey);
  const now = new Date();
  const run = await IngestionRun.create({
    sourceKey: opts.sourceKey,
    sourceDocumentId: opts.sourceDocumentId,
    filename: opts.filename,
    trigger: opts.trigger,
    startedAt: now,
    heartbeatAt: now,
    status: "running",
  });
  if (getSourceDefinition(opts.sourceKey)) {
    await DataSource.updateOne({ key: opts.sourceKey }, { $set: { lastAttemptAt: now } });
  }
  const handle: RunHandle = {
    id: run._id,
    sourceKey: opts.sourceKey,
    counts: { recordsDiscovered: 0, recordsCreated: 0, recordsUpdated: 0, recordsSkipped: 0, recordsRejected: 0 },
    errors: [],
    warnings: [],
    heartbeat: async () => {
      await IngestionRun.updateOne({ _id: run._id }, { $set: { heartbeatAt: new Date(), ...handle.counts } });
    },
  };
  return handle;
}

export async function finishRun(run: RunHandle, status: RunStatus, extra?: { sourceDocumentId?: Types.ObjectId; publishedDate?: Date | null }) {
  const now = new Date();
  // Cap stored messages so one bad file cannot create an enormous document.
  const errors = run.errors.slice(0, 200);
  const warnings = run.warnings.slice(0, 200);
  if (run.errors.length > 200) errors.push(`… ${run.errors.length - 200} more errors not shown`);
  if (run.warnings.length > 200) warnings.push(`… ${run.warnings.length - 200} more warnings not shown`);
  await IngestionRun.updateOne(
    { _id: run.id },
    { $set: { status, completedAt: now, heartbeatAt: now, errors, warnings, ...run.counts, ...(extra?.sourceDocumentId ? { sourceDocumentId: extra.sourceDocumentId } : {}) } },
  );
  if (!getSourceDefinition(run.sourceKey)) return;
  if (status === "completed" || status === "completed_with_errors") {
    await DataSource.updateOne(
      { key: run.sourceKey },
      {
        $set: {
          lastSuccessfulFetchAt: now,
          status: "ok",
          ...(extra?.publishedDate ? { lastPublishedDate: extra.publishedDate } : {}),
        },
      },
    );
  } else if (status === "failed") {
    await DataSource.updateOne(
      { key: run.sourceKey },
      { $set: { status: "error" }, $push: { errors: { $each: [{ at: now, message: errors[0] ?? "Import failed" }], $slice: -20 } } },
    );
  }
}

/** Record an attempt that failed before a run could start (missing/empty/oversized file). */
export async function recordFailedAttempt(opts: { sourceKey: string; trigger: "cli" | "ui" | "test"; filename?: string; message: string }) {
  const now = new Date();
  const run = await IngestionRun.create({
    sourceKey: opts.sourceKey,
    filename: opts.filename,
    trigger: opts.trigger,
    startedAt: now,
    completedAt: now,
    status: "failed",
    errors: [opts.message],
  });
  if (getSourceDefinition(opts.sourceKey)) {
    await DataSource.updateOne(
      { key: opts.sourceKey },
      { $set: { lastAttemptAt: now, status: "error" }, $push: { errors: { $each: [{ at: now, message: opts.message }], $slice: -20 } } },
    );
  }
  return run;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
