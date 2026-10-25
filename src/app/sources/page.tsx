import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { importDldFolderAction, importExpectedPdfsAction, importIncomingPdfAction, uploadDldAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Card, DataError, EmptyState, input, loadDb, Notice, PageHeader, Skeleton, StatusPill, td, tdNum, th } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import { getEnv } from "@/lib/env";
import { EXPECTED_PDFS, listDldCsvs, listIncomingPdfs } from "@/server/ingest/service";
import { listDataSources, listDocuments, listRuns } from "@/server/queries/catalog";

export const metadata: Metadata = { title: "Sources & Imports" };

export default function SourcesPage() {
  return (
    <>
      <PageHeader
        title="Data Sources & Imports"
        description="Where every record comes from, when it was last imported, and what failed. Files stay on this computer; nothing is uploaded to external services."
      />
      <Suspense fallback={<Skeleton rows={6} />}>
        <Sources />
      </Suspense>
    </>
  );
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

async function Sources() {
  await connection();
  let pdfs: Awaited<ReturnType<typeof listIncomingPdfs>>;
  let csvs: Awaited<ReturnType<typeof listDldCsvs>>;
  let maxMb: number;
  try {
    [pdfs, csvs] = await Promise.all([listIncomingPdfs(), listDldCsvs()]);
    maxMb = Math.round(getEnv().MAX_UPLOAD_BYTES / 1024 / 1024);
  } catch (err) {
    return <DataError error={err} />;
  }
  const r = await loadDb(async () => ({ sources: await listDataSources(), docs: await listDocuments(), runs: await listRuns(40) }));
  const expected = EXPECTED_PDFS.map((e) => ({ ...e, file: pdfs.find((p) => p.name === e.filename) }));
  const otherPdfs = pdfs.filter((p) => !EXPECTED_PDFS.some((e) => e.filename === p.name));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="1 · Supplied PDFs" subtitle="Expected in data/incoming/ — imported locally with pdf.js; scanned pages are reported (no OCR)">
          <ul className="mb-3 space-y-1 text-sm">
            {expected.map((e) => (
              <li key={e.filename} className="flex flex-wrap items-center gap-2">
                <StatusPill status={e.file ? "ok" : "failed"} />
                <code>{e.filename}</code>
                <span className="text-ink-2">
                  {e.file ? `${mb(e.file.sizeBytes)}, modified ${fmtDateTime(e.file.modifiedAt)}` : `missing — place it at data/incoming/${e.filename}`}
                </span>
                <span className="text-xs text-muted">({e.kind === "inventory" ? "unit inventory & listed prices" : "project brochures"})</span>
              </li>
            ))}
          </ul>
          <ActionForm action={importExpectedPdfsAction} submitLabel="Import Merge1.pdf and Merge2.pdf" pendingLabel="Importing… (large PDFs can take a few minutes)" primary />
          <p className="mt-2 text-xs text-muted">CLI: <code>npm run ingest -- pdf</code>. Re-importing an unchanged file does nothing; a changed file becomes a new snapshot and the old one is kept.</p>
          {otherPdfs.length ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-2 text-xs font-medium text-ink-2">Other PDFs in data/incoming</p>
              <ActionForm action={importIncomingPdfAction} submitLabel="Import selected PDF">
                <div className="flex flex-wrap gap-2">
                  <select name="name" className={input} aria-label="PDF file">
                    {otherPdfs.map((p) => <option key={p.name} value={p.name}>{p.name} ({mb(p.sizeBytes)})</option>)}
                  </select>
                  <select name="kind" className={input} aria-label="Document type">
                    <option value="inventory">Unit inventory / price list</option>
                    <option value="brochure">Project brochure</option>
                  </select>
                </div>
              </ActionForm>
            </div>
          ) : null}
        </Card>

        <Card title="2 · DLD Real Estate Data (CSV)" subtitle="Official Dubai Land Department exports, downloaded manually">
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-ink-2">
            <li>
              Open the{" "}
              <a className="text-accent underline" href="https://dubailand.gov.ae/en/open-data/real-estate-data/" target="_blank" rel="noopener noreferrer">DLD Real Estate Data page</a>.
            </li>
            <li><strong>Projects</strong> tab → search → <em>Download as CSV</em> (gives developer names for attribution).</li>
            <li><strong>Transactions</strong> tab → choose dates (e.g. Sales, Residential, the areas you study) → <em>Download as CSV</em>.</li>
            <li>Save into <code>data/incoming/dld/</code> and import, or upload below. The CAPTCHA is solved by you; this app never automates it.</li>
          </ol>
          <Notice>DLD site terms allow viewing and downloading for personal, non-commercial use. Keep exports local; obtain DLD permission before any commercial or published use.</Notice>
          <div className="mt-3 space-y-3">
            <p className="text-sm">
              {csvs.length ? `${csvs.length} CSV file(s) in data/incoming/dld: ${csvs.map((c) => c.name).join(", ")}` : "No CSV files in data/incoming/dld yet."}
            </p>
            <ActionForm action={importDldFolderAction} submitLabel="Import all CSVs in data/incoming/dld" pendingLabel="Importing…" />
            <ActionForm action={uploadDldAction} submitLabel="Upload and import" pendingLabel="Uploading…">
              <label className="text-xs text-ink-2">
                Or upload one export (max {maxMb} MB; kept unchanged in data/incoming/dld)
                <input type="file" name="file" accept=".csv,text/csv" required className="mt-1 block text-sm" />
              </label>
            </ActionForm>
            <p className="text-xs text-muted">CLI: <code>npm run ingest -- dld</code> (folder) or <code>npm run ingest -- dld path/to/file.csv</code>.</p>
          </div>
        </Card>
      </div>

      <Card title="3 · Public announcements" subtitle="Danube's website prohibits automated access, so announcements are recorded by hand">
        <p className="text-sm text-ink-2">
          Record launches, payment plans and handover announcements on the <Link className="text-accent underline" href="/timeline">Announcements</Link> page with the article URL and publication date.
        </p>
      </Card>

      {!r.ok ? (
        <DataError error={r.error} />
      ) : (
        <>
          <Card title="Source registry">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Source</th>
                    <th className={th}>Status</th>
                    <th className={th}>Access method</th>
                    <th className={th}>Last attempt</th>
                    <th className={th}>Last success</th>
                    <th className={th}>Latest source date</th>
                  </tr>
                </thead>
                <tbody>
                  {r.data.sources.map((s) => (
                    <tr key={s.key}>
                      <td className={td}>
                        <p className="font-medium">{s.name}</p>
                        <p className="text-xs text-muted">{s.publisher}{s.url ? <> · <a className="underline" href={s.url} target="_blank" rel="noopener noreferrer">link</a></> : null}</p>
                        <p className="mt-1 text-xs text-ink-2">{s.usageNotes}</p>
                      </td>
                      <td className={td}>
                        <StatusPill status={s.status} />
                        {s.errors.length ? <p className="mt-1 max-w-56 text-xs text-crit">{s.errors[s.errors.length - 1].message}</p> : null}
                      </td>
                      <td className={`${td} max-w-80 text-xs text-ink-2`}>{s.accessMethod}</td>
                      <td className={`${td} whitespace-nowrap`}>{fmtDateTime(s.lastAttemptAt)}</td>
                      <td className={`${td} whitespace-nowrap`}>{fmtDateTime(s.lastSuccessfulFetchAt)}</td>
                      <td className={`${td} whitespace-nowrap`}>{s.lastPublishedDate ? fmtDate(s.lastPublishedDate) : "unknown"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Imported documents" subtitle="Identified by SHA-256; originals are never modified">
            {r.data.docs.length === 0 ? (
              <EmptyState title="No documents imported yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={th}>File</th>
                      <th className={th}>Type</th>
                      <th className={th}>SHA-256</th>
                      <th className={`${th} text-right`}>Pages</th>
                      <th className={th}>Extraction</th>
                      <th className={`${th} text-right`}>Extracted</th>
                      <th className={`${th} text-right`}>Accepted</th>
                      <th className={`${th} text-right`}>Rejected</th>
                      <th className={th}>Imported</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.docs.map((d) => (
                      <tr key={String(d._id)}>
                        <td className={td}>{d.filename}</td>
                        <td className={`${td} text-ink-2`}>{d.documentType.replace(/_/g, " ")}</td>
                        <td className={`${td} font-mono text-xs`} title={d.sha256}>{d.sha256.slice(0, 12)}…</td>
                        <td className={tdNum}>{d.pageCount ?? "—"}</td>
                        <td className={td}>
                          <StatusPill status={d.extractionStatus} />
                          <p className="text-xs text-muted">{d.extractionVersion}</p>
                        </td>
                        <td className={tdNum}>{fmtInt(d.recordsExtracted)}</td>
                        <td className={tdNum}>{fmtInt(d.recordsAccepted)}</td>
                        <td className={tdNum}>{fmtInt(d.recordsRejected)}</td>
                        <td className={`${td} whitespace-nowrap`}>{fmtDateTime(d.importedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Recent import runs" subtitle="Every attempt is recorded with a truthful final status">
            {r.data.runs.length === 0 ? (
              <EmptyState title="No imports have been run" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Started</th>
                      <th className={th}>Source</th>
                      <th className={th}>File</th>
                      <th className={th}>Status</th>
                      <th className={`${th} text-right`}>New</th>
                      <th className={`${th} text-right`}>Already stored</th>
                      <th className={`${th} text-right`}>Rejected</th>
                      <th className={th}>First error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.runs.map((run) => (
                      <tr key={String(run._id)}>
                        <td className={`${td} whitespace-nowrap`}>
                          <Link className="text-accent hover:underline" href={`/sources/runs/${run._id}`}>{fmtDateTime(run.startedAt)}</Link>
                        </td>
                        <td className={td}>{run.sourceKey}</td>
                        <td className={td}>{run.filename ?? "—"}</td>
                        <td className={td}><StatusPill status={run.status} /></td>
                        <td className={tdNum}>{fmtInt(run.recordsCreated)}</td>
                        <td className={tdNum}>{fmtInt(run.recordsSkipped)}</td>
                        <td className={tdNum}>{fmtInt(run.recordsRejected)}</td>
                        <td className={`${td} max-w-96 text-xs text-crit`}>{run.errors[0] ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
