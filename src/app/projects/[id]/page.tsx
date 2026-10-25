import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { addAliasAction, mergeProjectAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Card, ClaimBadge, DataError, EmptyState, Kpi, loadDb, Notice, PageHeader, Skeleton, input, td, tdNum, th } from "@/components/ui";
import { fmtAED, fmtDate, fmtInt, fmtNum1 } from "@/lib/format";
import { FACT_CATEGORIES } from "@/server/models";
import { getProject } from "@/server/queries/catalog";
import { groupStats } from "@/server/queries/inventory";

export const metadata: Metadata = { title: "Project" };

export default function ProjectPage(props: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<Skeleton rows={5} />}>
      <ProjectDetail params={props.params} />
    </Suspense>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  location: "Location",
  configuration: "Configurations",
  amenity: "Amenities",
  positioning: "Positioning",
  payment_plan: "Payment plans",
  handover: "Handover / completion",
  price_claim: "Price claims",
  other: "Other",
};

async function ProjectDetail({ params }: { params: PageProps<"/projects/[id]">["params"] }) {
  const { id } = await params;
  const r = await loadDb(async () => {
    const detail = await getProject(id);
    if (!detail) return null;
    const stats = await groupStats("project", { project: id });
    return { ...detail, stats: stats[0] ?? null };
  });
  if (!r.ok) return <DataError error={r.error} />;
  if (!r.data) notFound();
  const { project, facts, pages, events, docs, transactions, dldRegister, otherProjects, stats } = r.data;
  const docName = (docId: unknown) => docs.get(String(docId))?.filename ?? "document";

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        description={
          <>
            {project.aliases.length ? <>Also recorded as: {project.aliases.map((a) => a.name).join(", ")}. </> : null}
            First seen in: {[...new Set(project.sourceReferences.map((s) => (s.sourceDocumentId ? docName(s.sourceDocumentId) : s.sourceType)))].join(", ") || "—"}.
          </>
        }
        actions={<Link href={`/inventory?project=${project._id}`} className="text-sm text-accent underline">Open in Inventory Explorer</Link>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Inventory rows (current snapshots)" value={fmtInt(stats?.rows ?? 0)} sub={`${fmtInt(stats?.distinctUnits ?? 0)} distinct units`} metric="inventory_observations" />
        <Kpi label="Median listed price" value={fmtAED(stats?.price.median)} sub={`n = ${fmtInt(stats?.price.n ?? 0)} rows with a price`} metric="listed_price_median" />
        <Kpi label="Median listed AED / sq ft" value={fmtNum1(stats?.psf.median)} sub={`n = ${fmtInt(stats?.psf.n ?? 0)}; IQR ${fmtNum1(stats?.psf.p25)}–${fmtNum1(stats?.psf.p75)}`} metric="listed_psf_median" />
        <Kpi
          label="Linked DLD transactions"
          value={transactions ? fmtInt(transactions.count) : "—"}
          sub={transactions ? `${fmtDate(transactions.first)} – ${fmtDate(transactions.last)} · ${fmtAED(transactions.value)} registered value` : "None linked (exact name or reviewed alias required)"}
          metric="registered_tx_count"
        />
      </div>

      {stats ? (
        <Card title="Recorded status in inventory documents" subtitle="As printed in the source document at its own date — not current availability">
          <ul className="flex flex-wrap gap-4 text-sm">
            {Object.entries(stats.status).map(([k, v]) => (
              <li key={k}>
                <span className="font-medium">{k}</span>: <span className="tabular">{fmtInt(v)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Brochure claims" subtitle="Extracted automatically from Merge1.pdf text. These are developer marketing claims, not verified facts; check the cited page.">
        {facts.length === 0 ? (
          <EmptyState title="No brochure claims extracted for this project" />
        ) : (
          <div className="space-y-4">
            {FACT_CATEGORIES.filter((c) => facts.some((f) => f.category === c)).map((cat) => (
              <div key={cat}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{CATEGORY_LABEL[cat]}</h3>
                <ul className="space-y-1.5 text-sm">
                  {facts
                    .filter((f) => f.category === cat)
                    .map((f) => (
                      <li key={String(f._id)} className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium">{f.value}</span>
                        <ClaimBadge type={f.claimType} />
                        <span className="text-xs text-muted">
                          {docName(f.sourceDocumentId)} p.{f.sourcePage} · attribution: {f.attributionMethod?.replace(/_/g, " ")} · confidence {f.confidence}
                        </span>
                        {f.extractedText ? (
                          <details className="w-full text-xs text-ink-2">
                            <summary className="cursor-pointer text-muted">Source text</summary>
                            <blockquote className="mt-1 border-l-2 border-line pl-2">{f.extractedText}</blockquote>
                          </details>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="DLD project register" subtitle="Observations from imported DLD Projects exports whose name exactly matches this project or an alias">
          {dldRegister.length === 0 ? (
            <EmptyState title="No matching DLD register entry">Import a DLD Projects export, or add the DLD project name as an alias after checking it.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>DLD name</th>
                    <th className={th}>Developer</th>
                    <th className={th}>Status</th>
                    <th className={`${th} text-right`}>Completed</th>
                    <th className={th}>Completion date</th>
                    <th className={th}>Retrieved</th>
                  </tr>
                </thead>
                <tbody>
                  {dldRegister.map((d) => (
                    <tr key={String(d._id)}>
                      <td className={td}>{d.projectName}</td>
                      <td className={td}>{d.developerName ?? "—"}</td>
                      <td className={td}>{d.projectStatus ?? "—"}</td>
                      <td className={tdNum}>{d.completedPct != null ? `${d.completedPct}%` : "—"}</td>
                      <td className={td}>{fmtDate(d.completionDate)}</td>
                      <td className={td}>{fmtDate(d.retrievedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Public announcements" subtitle="Linked manually when recording an announcement">
          {events.length === 0 ? (
            <EmptyState title="No linked announcements" />
          ) : (
            <ul className="space-y-2 text-sm">
              {events.map((e) => (
                <li key={String(e._id)}>
                  <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:underline">{e.title}</a>{" "}
                  <ClaimBadge type={e.claimType} />
                  <p className="text-xs text-muted">{e.publisher} · {fmtDate(e.publicationDate)}{e.retractedAt ? " · retracted" : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Brochure pages mentioning this project" subtitle="Page-level attribution from Merge1.pdf">
        {pages.length === 0 ? (
          <EmptyState title="No brochure pages linked" />
        ) : (
          <ul className="flex flex-wrap gap-2 text-xs">
            {pages.map((p) => (
              <li key={String(p._id)} className="rounded border border-line px-2 py-1">
                {docName(p.sourceDocumentId)} p.{p.page} <span className="text-muted">({p.attribution.replace(/_/g, " ")})</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Add an alias (human review)" subtitle="Use when a source spells this project differently (e.g. a DLD project name). Transactions with exactly that name are then linked.">
          <ActionForm action={addAliasAction} submitLabel="Add alias">
            <input type="hidden" name="projectId" value={String(project._id)} />
            <div className="grid gap-2">
              <label className="text-xs text-ink-2">
                Alias exactly as written in the source
                <input name="alias" required maxLength={200} className={`${input} mt-1 w-full`} />
              </label>
              <label className="text-xs text-ink-2">
                Evidence (why this is the same project)
                <input name="note" required minLength={5} maxLength={500} className={`${input} mt-1 w-full`} />
              </label>
            </div>
          </ActionForm>
        </Card>
        <Card title="Merge into another project (human review)" subtitle="Moves all observations of this project to the target and keeps this name as an alias. Use only when the sources confirm they are the same project.">
          {otherProjects.length === 0 ? (
            <Notice>No other projects exist.</Notice>
          ) : (
            <ActionForm action={mergeProjectAction} submitLabel="Merge" confirm={`Merge "${project.name}" into the selected project? This cannot be undone automatically.`}>
              <input type="hidden" name="sourceId" value={String(project._id)} />
              <div className="grid gap-2">
                <label className="text-xs text-ink-2">
                  Merge into
                  <select name="targetId" required className={`${input} mt-1 w-full`}>
                    {otherProjects.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-ink-2">
                  Evidence
                  <input name="note" required minLength={5} maxLength={500} className={`${input} mt-1 w-full`} />
                </label>
              </div>
            </ActionForm>
          )}
        </Card>
      </div>
    </div>
  );
}
