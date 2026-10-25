import { FileCheck2, FileStack, FileX2, Landmark, LifeBuoy, Megaphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { importDldFolderAction, importExpectedPdfsAction, importIncomingPdfAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { DldUpload } from "@/components/dld-upload";
import { FreshnessBadge } from "@/components/scope";
import { Badge, DataError, EmptyState, input, link, loadDb, Notice, PageHeader, Panel, SectionHeading, Skeleton, StatusPill, td, tdNum, th } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import { getEnv } from "@/lib/env";
import { EXPECTED_PDFS, listDldCsvs, listIncomingPdfs } from "@/server/ingest/service";
import { listDataSources, listDocuments, listRuns } from "@/server/queries/catalog";
import { listScopeSnapshots } from "@/server/queries/analytics";

export const metadata: Metadata = { title: "Sources & Imports" };

export default function SourcesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Data management"
        title="Sources & Imports"
        description="Bring in the supplied PDFs, official DLD exports and public announcements, and see exactly what each import produced. Files stay on this computer; nothing is sent to external services."
        actions={
          <Link href="/sources/runs" className="text-sm text-link hover:underline">
            Ingestion history →
          </Link>
        }
      />
      <Suspense fallback={<Skeleton rows={3} />}>
        <Sources />
      </Suspense>
    </>
  );
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

async function Sources() {
  await connection();
  const now = new Date();
  let pdfs: Awaited<ReturnType<typeof listIncomingPdfs>>;
  let csvs: Awaited<ReturnType<typeof listDldCsvs>>;
  let maxMb: number;
  try {
    [pdfs, csvs] = await Promise.all([listIncomingPdfs(), listDldCsvs()]);
    maxMb = Math.round(getEnv().MAX_UPLOAD_BYTES / 1024 / 1024);
  } catch (err) {
    return <DataError error={err} />;
  }
  const r = await loadDb(async () => {
    const [sources, docs, runs, snapshots] = await Promise.all([listDataSources(), listDocuments(), listRuns(10), listScopeSnapshots()]);
    return { sources, docs, runs, snapshots };
  });
  const expected = EXPECTED_PDFS.map((e) => ({ ...e, file: pdfs.find((p) => p.name === e.filename) }));
  const otherPdfs = pdfs.filter((p) => !EXPECTED_PDFS.some((e) => e.filename === p.name));
  const source = (key: string) => (r.ok ? r.data.sources.find((s) => s.key === key) : undefined);

  return (
    <div className="space-y-6">
      <SectionHeading>Import</SectionHeading>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title={
            <>
              <FileStack aria-hidden className="size-4 text-brand" /> Supplied PDFs
            </>
          }
          subtitle="Merge1.pdf (brochures) and Merge2.pdf (inventory) from data/incoming/"
          bodyClassName="p-4 space-y-4"
          footer={
            <>
              CLI: <code>npm run ingest -- pdf</code>. An unchanged file is skipped; a changed file becomes a new snapshot and the earlier one is kept. Pages without a text layer are reported (no OCR).
            </>
          }
        >
          <ul className="space-y-2.5">
            {expected.map((e) => {
              const s = source(e.sourceKey);
              return (
                <li key={e.filename} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium text-ink">
                      {e.file ? <FileCheck2 aria-hidden className="size-4 text-good" /> : <FileX2 aria-hidden className="size-4 text-crit" />}
                      {e.filename}
                    </span>
                    {s?.lastSuccessfulFetchAt ? <FreshnessBadge at={s.lastSuccessfulFetchAt} now={now} /> : <Badge tone="warn">Not imported</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-ink-2">
                    {e.kind === "inventory" ? "Unit inventory & listed prices" : "Project brochures"} ·{" "}
                    {e.file ? `${mb(e.file.sizeBytes)}, modified ${fmtDateTime(e.file.modifiedAt)}` : `missing — place it at data/incoming/${e.filename}`}
                  </p>
                </li>
              );
            })}
          </ul>
          <ActionForm action={importExpectedPdfsAction} submitLabel="Import Merge1.pdf and Merge2.pdf" pendingLabel="Importing… large PDFs can take a few minutes" primary />
          {otherPdfs.length ? (
            <div className="border-t border-line pt-3">
              <p className="mb-2 text-xs font-medium text-ink-2">Other PDFs in data/incoming</p>
              <ActionForm action={importIncomingPdfAction} submitLabel="Import selected PDF">
                <div className="flex flex-wrap gap-2">
                  <select name="name" className={input} aria-label="PDF file">
                    {otherPdfs.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} ({mb(p.sizeBytes)})
                      </option>
                    ))}
                  </select>
                  <select name="kind" className={input} aria-label="Document type">
                    <option value="inventory">Unit inventory / price list</option>
                    <option value="brochure">Project brochure</option>
                  </select>
                </div>
              </ActionForm>
            </div>
          ) : null}
        </Panel>

        <Panel
          id="dld"
          title={
            <>
              <Landmark aria-hidden className="size-4 text-brand" /> DLD Real Estate Data (CSV)
            </>
          }
          subtitle="Official Dubai Land Department exports, downloaded manually"
          bodyClassName="p-4 space-y-4"
          footer="DLD site terms allow viewing and downloading for personal, non-commercial use. Obtain DLD permission before any commercial or published use."
        >
          <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-2">
            <li>
              Open the{" "}
              <a className={link} href="https://dubailand.gov.ae/en/open-data/real-estate-data/" target="_blank" rel="noopener noreferrer">
                DLD Real Estate Data page
              </a>{" "}
              (CAPTCHA — solved by you, never automated).
            </li>
            <li>
              <strong className="text-ink">Projects</strong> tab → Download as CSV (developer names for attribution).
            </li>
            <li>
              <strong className="text-ink">Transactions</strong> tab → choose dates → Download as CSV.
            </li>
          </ol>
          <DldUpload maxMb={maxMb} />
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-xs text-ink-2">{csvs.length ? `${csvs.length} CSV file(s) in data/incoming/dld: ${csvs.map((c) => c.name).join(", ")}` : "No CSV files in data/incoming/dld yet."}</p>
            <ActionForm action={importDldFolderAction} submitLabel="Import all CSVs in data/incoming/dld" pendingLabel="Importing…" />
          </div>
        </Panel>

        <Panel
          title={
            <>
              <Megaphone aria-hidden className="size-4 text-brand" /> Public announcements
            </>
          }
          subtitle="Recorded by hand with URL and publication date"
          bodyClassName="p-4 space-y-3 text-sm text-ink-2"
        >
          <p>Danube&apos;s website Terms &amp; Conditions (§5) prohibit automated access, so there is no scraper. Read the news page or reputable coverage and record each item in your own words.</p>
          <Link href="/timeline" className="inline-flex h-9 items-center rounded-md border border-line-strong px-3 text-sm font-medium text-ink hover:bg-surface-2">
            Record an announcement
          </Link>
        </Panel>
      </div>

      {!r.ok ? (
        <DataError error={r.error} />
      ) : (
        <>
          <SectionHeading>Imported documents</SectionHeading>
          {r.data.docs.length === 0 ? (
            <EmptyState title="No documents imported yet">Import the supplied PDFs above.</EmptyState>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {r.data.docs.map((d) => {
                const snap = r.data.snapshots.find((s) => s.sourceDocumentId === String(d._id));
                return (
                  <Panel
                    key={String(d._id)}
                    title={d.filename}
                    subtitle={`${d.documentType.replace(/_/g, " ")} · imported ${fmtDateTime(d.importedAt)}`}
                    actions={<StatusPill status={d.extractionStatus} />}
                    footer={
                      <span className="break-all font-mono">
                        SHA-256 {d.sha256} · {d.extractionVersion ?? "—"} · {mb(d.sizeBytes)}
                      </span>
                    }
                  >
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        ["Pages", d.pageCount ?? "—"],
                        ["Lines / pages read", fmtInt(d.recordsExtracted)],
                        ["Accepted", fmtInt(d.recordsAccepted)],
                        ["Rejected / unplaced", fmtInt(d.recordsRejected)],
                      ].map(([k, v]) => (
                        <div key={String(k)}>
                          <dt className="text-[11px] text-muted">{k}</dt>
                          <dd className="tabular text-lg font-semibold text-ink">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {snap ? (
                      <p className={`mt-3 text-xs ${snap.dateKnown ? "text-ink-2" : "text-warn"}`}>
                        Snapshot date: {snap.dateKnown ? `${fmtDate(snap.snapshotDate)} (printed: “${snap.dateEvidence ?? ""}”)` : "not printed in the document — unknown"}
                      </p>
                    ) : null}
                    {d.warnings.length ? (
                      <ul className="mt-3 space-y-1 text-xs text-ink-2">
                        {d.warnings.map((w, i) => (
                          <li key={i} className="flex gap-1.5">
                            <span aria-hidden className="text-warn">
                              !
                            </span>
                            {w}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </Panel>
                );
              })}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-3">
            <Panel className="xl:col-span-2" title="Recent import runs" subtitle="Every attempt, with a truthful final status" bodyClassName="p-0" actions={<Link className={link} href="/sources/runs">All runs →</Link>}>
              {r.data.runs.length === 0 ? (
                <p className="p-4 text-sm text-muted">No imports have been run.</p>
              ) : (
                <div className="scroll-thin overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr>
                        <th className={th}>Started</th>
                        <th className={th}>Source · file</th>
                        <th className={th}>Status</th>
                        <th className={`${th} text-right`}>Found</th>
                        <th className={`${th} text-right`}>New</th>
                        <th className={`${th} text-right`}>Already stored</th>
                        <th className={`${th} text-right`}>Rejected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.data.runs.map((run) => (
                        <tr key={String(run._id)} className="hover:bg-surface-2">
                          <td className={`${td} whitespace-nowrap`}>
                            <Link className={link} href={`/sources/runs/${run._id}`}>
                              {fmtDateTime(run.startedAt)}
                            </Link>
                          </td>
                          <td className={td}>
                            {run.sourceKey}
                            <span className="block text-xs text-muted">{run.filename ?? "—"}</span>
                          </td>
                          <td className={td}>
                            <StatusPill status={run.status} />
                            {run.errors[0] ? <span className="mt-0.5 block max-w-80 truncate text-xs text-crit">{run.errors[0]}</span> : null}
                          </td>
                          <td className={tdNum}>{fmtInt(run.recordsDiscovered)}</td>
                          <td className={tdNum}>{fmtInt(run.recordsCreated)}</td>
                          <td className={tdNum}>{fmtInt(run.recordsSkipped)}</td>
                          <td className={tdNum}>{fmtInt(run.recordsRejected)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel
              title={
                <>
                  <LifeBuoy aria-hidden className="size-4 text-muted" /> When an import fails
                </>
              }
              bodyClassName="p-4"
            >
              <ul className="space-y-2.5 text-xs leading-relaxed text-ink-2">
                <li>
                  <strong className="text-ink">File not found / empty:</strong> place the file at the stated path and run again.
                </li>
                <li>
                  <strong className="text-ink">No table header recognised:</strong> the PDF layout differs from the parser vocabulary; nothing was imported. Share a sample page to extend it.
                </li>
                <li>
                  <strong className="text-ink">Interrupted:</strong> the run stopped heart-beating (e.g. the server restarted). Re-run — stored rows are never duplicated.
                </li>
                <li>
                  <strong className="text-ink">Another import is running:</strong> wait for it to finish; one run per source at a time.
                </li>
                <li>
                  <strong className="text-ink">Rejected rows:</strong> kept for review on{" "}
                  <Link className={link} href="/quality?queue=rejected">
                    Data Quality
                  </Link>
                  ; accepted rows are unaffected.
                </li>
              </ul>
            </Panel>
          </div>

          <SectionHeading>Source registry</SectionHeading>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {r.data.sources.map((s) => (
              <Panel key={s.key} title={s.name} subtitle={s.publisher} actions={<StatusPill status={s.status} />} bodyClassName="p-4 space-y-2 text-xs text-ink-2">
                <p>{s.accessMethod}</p>
                <p className="text-muted">{s.usageNotes}</p>
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-muted">
                  <span>Last attempt: {fmtDateTime(s.lastAttemptAt)}</span>
                  <span>Last success: {fmtDateTime(s.lastSuccessfulFetchAt)}</span>
                  <span>Latest source date: {s.lastPublishedDate ? fmtDate(s.lastPublishedDate) : "unknown"}</span>
                </p>
                {s.url ? (
                  <a className={link} href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.url}
                  </a>
                ) : null}
                {s.errors.length ? <Notice tone="crit">{s.errors[s.errors.length - 1].message}</Notice> : null}
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
