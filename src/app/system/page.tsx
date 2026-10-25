import fs from "node:fs/promises";
import { Activity, Database, FolderOpen, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge, DataError, KpiCard, link, PageHeader, Panel, Skeleton, StatusPill, td, tdNum, th } from "@/components/ui";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { getEnv } from "@/lib/env";
import { getDbStatus, requireDb } from "@/server/db";
import { STALE_RUN_MS } from "@/server/ingest/runs";
import { ALL_MODELS, IngestionRun } from "@/server/models";

export const metadata: Metadata = { title: "System Health" };

export default function SystemPage() {
  return (
    <>
      <PageHeader eyebrow="System" title="System Health" description="Database reachability, stored collections and indexes, local data folders, running imports and the security posture of this local tool. Connection strings are never displayed." />
      <Suspense fallback={<Skeleton rows={2} />}>
        <Health />
      </Suspense>
    </>
  );
}

async function exists(p: string) {
  return fs
    .stat(p)
    .then((s) => s.isDirectory())
    .catch(() => false);
}

/** Database status with round-trip time (measured outside render). */
async function timedDbStatus() {
  const t0 = performance.now();
  const db = await getDbStatus();
  return { db, latency: Math.round(performance.now() - t0) };
}

function loadRunning() {
  return IngestionRun.find({ status: "running" }).sort({ startedAt: -1 }).lean();
}

async function Health() {
  await connection();
  const { db, latency } = await timedDbStatus();
  let env: ReturnType<typeof getEnv> | null = null;
  let envError: unknown = null;
  try {
    env = getEnv();
  } catch (err) {
    envError = err;
  }
  const folders = env ? await Promise.all([env.DATA_DIR, env.INCOMING_DIR, env.DLD_DIR].map(async (p) => ({ p, ok: await exists(p) }))) : [];

  let collections: Array<{ name: string; count: number; indexes: number; declared: number }> = [];
  let running: Awaited<ReturnType<typeof loadRunning>> = [];
  let dbError: unknown = null;
  if (db.ok) {
    try {
      await requireDb();
      collections = await Promise.all(
        ALL_MODELS.map(async (m) => {
          const [count, idx] = await Promise.all([m.estimatedDocumentCount(), m.collection.indexes().catch(() => [])]);
          return { name: m.modelName, count, indexes: idx.length, declared: m.schema.indexes().length + 1 };
        }),
      );
      running = await loadRunning();
    } catch (err) {
      dbError = err;
    }
  }
  const now = new Date().getTime();

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Database} label="Database" value={db.ok ? "Reachable" : "Unavailable"} sub={db.ok ? `Database “${db.database}” · ping ${latency} ms` : db.reason} tone={db.ok ? undefined : "crit"} />
        <KpiCard icon={Activity} label="Imports running" value={fmtInt(running.length)} sub={running.length ? "Runs without a heartbeat for 15 min are marked interrupted on the next import" : "No import in progress"} />
        <KpiCard icon={FolderOpen} label="Data folders" value={folders.length && folders.every((f) => f.ok) ? "Present" : "Check"} sub={env ? env.INCOMING_DIR : "Configuration invalid"} tone={folders.every((f) => f.ok) ? undefined : "warn"} />
        <KpiCard icon={Lock} label="Exposure" value="Local only" sub="dev and start scripts bind to 127.0.0.1; there is no login" />
      </div>
      {envError ? <DataError error={envError} /> : null}
      {dbError ? <DataError error={dbError} /> : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Collections" subtitle="Estimated document counts and index status" bodyClassName="p-0">
          {collections.length === 0 ? (
            <p className="p-4 text-sm text-muted">Unavailable while the database is unreachable.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Collection</th>
                  <th className={`${th} text-right`}>Documents</th>
                  <th className={`${th} text-right`}>Indexes</th>
                  <th className={th}>Index status</th>
                </tr>
              </thead>
              <tbody>
                {collections.map((c) => (
                  <tr key={c.name}>
                    <td className={td}>{c.name}</td>
                    <td className={tdNum}>{fmtInt(c.count)}</td>
                    <td className={tdNum}>
                      {fmtInt(c.indexes)} / {fmtInt(c.declared)}
                    </td>
                    <td className={td}>{c.indexes >= c.declared ? <Badge tone="good">in sync</Badge> : <Badge tone="warn">created on next import</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Local folders" bodyClassName="p-4">
            <ul className="space-y-2 text-xs">
              {folders.map((f) => (
                <li key={f.p} className="flex items-start justify-between gap-2">
                  <code className="break-all text-ink-2">{f.p}</code>
                  {f.ok ? <Badge tone="good">exists</Badge> : <Badge tone="warn">missing</Badge>}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted">Source PDFs and CSVs stay in these folders; they are excluded from git and never served to the browser.</p>
          </Panel>
          <Panel title="Runtime" bodyClassName="p-4 text-xs text-ink-2 space-y-1">
            <p>Node.js {process.version}</p>
            <p>Max CSV upload {env ? Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024) : "—"} MB</p>
            <p>
              Health endpoint:{" "}
              <a className={link} href="/api/health">
                /api/health
              </a>
            </p>
          </Panel>
        </div>
      </div>

      {running.length ? (
        <Panel title="Running imports" bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {running.map((r) => {
              const stale = r.heartbeatAt && now - r.heartbeatAt.getTime() > STALE_RUN_MS;
              return (
                <li key={String(r._id)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <Link className={link} href={`/sources/runs/${r._id}`}>
                    {r.sourceKey} · {r.filename ?? "—"} · started {fmtDateTime(r.startedAt)}
                  </Link>
                  {stale ? <Badge tone="warn">no heartbeat — likely interrupted</Badge> : <StatusPill status="running" />}
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
