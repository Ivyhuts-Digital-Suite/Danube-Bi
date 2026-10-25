import { ExternalLink, FileText, GitMerge, History, MapPin, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { addAliasAction, mergeProjectAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Histogram } from "@/components/charts";
import { InventoryTable } from "@/components/inventory-table";
import { LocationEditor } from "@/components/location-editor";
import { SnapshotDateBadge, SourceBadge } from "@/components/scope";
import { STATUS_COLORS } from "@/components/status-colors";
import {
  Badge,
  btn,
  ClaimBadge,
  DataError,
  EmptyState,
  input,
  KpiCard,
  label,
  link,
  loadDb,
  Notice,
  PageHeader,
  Pagination,
  Panel,
  SectionHeading,
  SeverityPill,
  Skeleton,
  StatusPill,
  td,
  tdNum,
  th,
} from "@/components/ui";
import { BarList, ChartPanel, RangeList, StackedBar } from "@/components/viz";
import { fmtAEDCompact, fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import { COMPARISON_MIN_SAMPLE, STATUS_KEYS, STATUS_LABELS } from "@/lib/inventory-analytics";
import { flatParams, href } from "@/lib/url";
import { FACT_CATEGORIES } from "@/server/models";
import { getProjectDetail } from "@/server/queries/portfolio";
import { toUnitRows } from "@/server/queries/unit-rows";

export const metadata: Metadata = { title: "Project" };

export default function ProjectPage(props: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<Skeleton rows={5} />}>
      <ProjectDetail params={props.params} searchParams={props.searchParams} />
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
/** Categories where several different values from different pages may contradict each other. */
const SINGLE_VALUED = new Set(["location", "payment_plan", "handover", "price_claim"]);

async function ProjectDetail({ params, searchParams }: { params: PageProps<"/projects/[id]">["params"]; searchParams: PageProps<"/projects/[id]">["searchParams"] }) {
  const { id } = await params;
  const sp = flatParams(await searchParams);
  const unitPage = Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? "1", 10) || 1));
  const r = await loadDb(() => getProjectDetail(id, unitPage));
  if (!r.ok) return <DataError error={r.error} />;
  if (!r.data) notFound();
  const { project, facts, pages, events, docs, transactions, dldRegister, otherProjects, scoped, units, timeline, runs, issues } = r.data;
  const scope = scoped.scope.current;
  const a = scoped.analytics;
  const stats = a.projects.find((g) => g.key === String(project._id)) ?? null;
  const docName = (docId: unknown) => docs.get(String(docId))?.filename ?? "document";
  const geo = project.geo;
  const locationFacts = facts.filter((f) => f.category === "location");
  const conflicts = FACT_CATEGORIES.filter((c) => SINGLE_VALUED.has(c) && new Set(facts.filter((f) => f.category === c).map((f) => f.value.toLowerCase())).size > 1);
  const typologyRanges = a.typologies
    .filter((t) => t.psf.n >= 2 && t.psf.min != null)
    .map((t) => ({ key: t.key, label: t.label, n: t.psf.n, min: t.psf.min!, p25: t.psf.p25!, median: t.psf.median!, p75: t.psf.p75!, max: t.psf.max!, small: t.psf.n < COMPARISON_MIN_SAMPLE }));

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: project.name }]}
        eyebrow="Project"
        title={project.name}
        description={
          <>
            Recorded as <span className="text-ink">“{project.name}”</span> · match key <code className="font-mono text-xs">{project.normalizedName}</code>
            {project.aliases.length ? <> · also recorded as {project.aliases.map((x) => `“${x.name}”`).join(", ")}</> : null}
          </>
        }
        actions={
          <>
            <Link href={href("/inventory", { project: String(project._id) })} className={btn}>
              Inventory Explorer
            </Link>
            <Link href={href("/pricing", { project: String(project._id) })} className={btn}>
              Pricing
            </Link>
          </>
        }
        meta={
          <>
            {[...new Set(project.sourceReferences.map((s) => (s.sourceDocumentId ? docName(s.sourceDocumentId) : s.sourceType)))].map((f) => (
              <SourceBadge key={f} filename={f} />
            ))}
            {scope && stats ? <SnapshotDateBadge snapshot={scope} /> : null}
            {geo ? (
              <Badge tone={geo.precision === "verified" ? "good" : "neutral"} icon={MapPin}>
                {geo.precision} position
              </Badge>
            ) : (
              <Badge icon={MapPin}>No map position</Badge>
            )}
          </>
        }
      />

      {issues.some((i) => i.rule === "possible_project_alias") ? (
        <Notice tone="warn" title="Unresolved possible aliases">
          This name may refer to the same project as{" "}
          {issues
            .filter((i) => i.rule === "possible_project_alias")
            .flatMap((i) => i.otherProjects)
            .map((o, k) => (
              <span key={o.id}>
                {k > 0 ? ", " : ""}
                <Link className="underline" href={`/projects/${o.id}`}>
                  {o.name}
                </Link>
              </span>
            ))}
          . Nothing is merged automatically — compare the sources and use “Merge” below only if the evidence supports it.
        </Notice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Accepted unit records" value={fmtInt(stats?.records ?? 0)} sub={stats ? `${fmtInt(stats.units)} distinct units in the analysis set` : "No inventory records in scope"} metric="accepted_records" href={href("/inventory", { project: String(project._id) })} />
        <KpiCard label="Recorded as available" value={fmtInt(stats?.status.available ?? 0)} sub={`${fmtInt(stats?.status.sold ?? 0)} sold · ${fmtInt((stats?.status.other ?? 0) + (stats?.status.missing ?? 0))} unrecognized/no status`} metric="status_available" />
        <KpiCard label="Median listed price" value={fmtAEDCompact(stats?.price.median)} sub={stats?.price.n ? `Range ${fmtAEDCompact(stats.price.min)} – ${fmtAEDCompact(stats.price.max)}` : undefined} source={`n = ${fmtInt(stats?.price.n ?? 0)} priced units`} metric="listed_price_median" />
        <KpiCard label="Median AED / sq ft" value={stats?.psf.median != null ? fmtInt(stats.psf.median) : "—"} sub={stats?.psf.n ? `IQR ${fmtInt(stats.psf.p25)} – ${fmtInt(stats.psf.p75)}` : undefined} source={`n = ${fmtInt(stats?.psf.n ?? 0)}`} metric="listed_psf_median" />
        <KpiCard
          label="Linked DLD transactions"
          value={transactions ? fmtInt(transactions.count) : "—"}
          sub={transactions ? `${fmtDate(transactions.first)} – ${fmtDate(transactions.last)} · ${fmtAEDCompact(transactions.value)}` : "None linked (exact name or reviewed alias required)"}
          metric="registered_tx_count"
        />
      </div>

      {stats ? (
        <>
          <SectionHeading>Inventory and pricing</SectionHeading>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartPanel
              title="Recorded status labels"
              metric="status_available"
              subtitle={`${fmtInt(stats.records)} records · as printed, not live availability`}
              table={{ head: ["Status", "Records"], rows: STATUS_KEYS.map((k) => [STATUS_LABELS[k], stats.status[k]]) }}
            >
              <StackedBar
                ariaLabel="Project records by status"
                segments={STATUS_KEYS.map((k) => ({ key: k, label: STATUS_LABELS[k], value: stats.status[k], color: STATUS_COLORS[k], href: href("/inventory", { project: String(project._id), status: k }) }))}
              />
            </ChartPanel>
            <ChartPanel title="Typology mix" info="Typology as written in the document." subtitle={`${fmtInt(a.typologies.length)} typology labels`} table={{ head: ["Typology", "Records", "Median price (AED)"], rows: a.typologies.map((t) => [t.label, t.records, t.price.median]) }}>
              <BarList
                ariaLabel="Project records by typology"
                color="var(--series-3)"
                items={a.typologies.slice(0, 8).map((t) => ({
                  key: t.key,
                  label: t.label,
                  value: t.records,
                  display: fmtInt(t.records),
                  secondary: t.price.median != null ? `median ${fmtAEDCompact(t.price.median)} · n = ${fmtInt(t.price.n)}` : "no prices",
                  href: t.key === "none" ? undefined : href("/inventory", { project: String(project._id), typology: t.key }),
                  muted: t.key === "none",
                }))}
              />
            </ChartPanel>
            <ChartPanel title="Listed price distribution" metric="listed_price_median" subtitle={`${fmtInt(a.price.n)} priced units`} table={{ head: ["Band (AED)", "Units"], rows: a.priceBands.map((b) => [b.label, b.count]) }}>
              <Histogram data={a.priceBands.map((b) => ({ label: b.label, count: b.count }))} xLabel="Listed price (AED)" ariaLabel="Project listed price distribution" />
            </ChartPanel>
            <ChartPanel
              title="AED / sq ft by typology"
              metric="listed_psf_median"
              subtitle={`Typologies with ≥ 2 units; < ${COMPARISON_MIN_SAMPLE} marked small sample`}
              table={{ head: ["Typology", "n", "Min", "P25", "Median", "P75", "Max"], rows: typologyRanges.map((g) => [g.label, g.n, Math.round(g.min), Math.round(g.p25), Math.round(g.median), Math.round(g.p75), Math.round(g.max)]) }}
            >
              <RangeList items={typologyRanges} ariaLabel="Listed AED per square foot by typology" unitLabel="units" />
            </ChartPanel>
          </div>

          {units && scope ? (
            <Panel id="units" title="Unit records" subtitle={`${fmtInt(units.total)} records in ${scope.filename} · 25 per page`} bodyClassName="p-0" actions={<Link className={link} href={href("/inventory", { project: String(project._id) })}>Filter in Inventory Explorer →</Link>}>
              <InventoryTable rows={toUnitRows(units.rows, new Map([[String(project._id), project.name]]), scope)} query={`project=${project._id}`} sort="sourcePage" dir="asc" />
              <div className="p-3">
                <Pagination page={unitPage} pageCount={units.pageCount} total={units.total} pageSize={25} href={(p) => `/projects/${project._id}?page=${p}#units`} />
              </div>
            </Panel>
          ) : null}
        </>
      ) : (
        <EmptyState title="No inventory records for this project in the analysis scope">
          The project is named in {fmtInt(pages.length)} brochure page(s){facts.length ? ` with ${facts.length} extracted claim(s)` : ""}, but no accepted unit record links to it.
        </EmptyState>
      )}

      <SectionHeading>Facts, claims and sources</SectionHeading>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Brochure claims" subtitle="Extracted from brochure text. Developer marketing claims, not verified facts — check the cited page.">
          {conflicts.length ? (
            <div className="mb-4">
              <Notice tone="warn" title="Differing values recorded">
                {conflicts.map((c) => CATEGORY_LABEL[c]).join(", ")}: more than one value was extracted from different pages. They are shown side by side; neither is preferred.
              </Notice>
            </div>
          ) : null}
          {facts.length === 0 ? (
            <EmptyState compact title="No brochure claims extracted for this project" />
          ) : (
            <div className="space-y-4">
              {FACT_CATEGORIES.filter((c) => facts.some((f) => f.category === c)).map((cat) => (
                <div key={cat}>
                  <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                    {CATEGORY_LABEL[cat]}
                    {conflicts.includes(cat) ? <TriangleAlert aria-label="Differing values" className="size-3.5 text-warn" /> : null}
                  </h3>
                  <ul className="space-y-2 text-sm">
                    {facts
                      .filter((f) => f.category === cat)
                      .map((f) => (
                        <li key={String(f._id)} className="rounded-md border border-line px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-ink">{f.value}</span>
                            <ClaimBadge type={f.claimType} />
                            <Badge>confidence {f.confidence}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted">
                            {docName(f.sourceDocumentId)} p.{f.sourcePage} · attribution: {f.attributionMethod?.replace(/_/g, " ") ?? "—"}
                          </p>
                          {f.extractedText ? <blockquote className="mt-1.5 border-l-2 border-line-strong pl-2 text-xs italic text-ink-2">“{f.extractedText}”</blockquote> : null}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Brochure pages" subtitle="Page-level attribution">
            {pages.length === 0 ? (
              <p className="text-sm text-muted">No brochure pages linked.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5 text-xs">
                {pages.map((p) => (
                  <li key={String(p._id)}>
                    <Badge title={p.attribution.replace(/_/g, " ")}>
                      {docName(p.sourceDocumentId)} p.{p.page}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Public announcements" subtitle="Linked when recorded">
            {events.length === 0 ? (
              <p className="text-sm text-muted">
                None linked. Record one on{" "}
                <Link className={link} href="/timeline">
                  Public Announcements
                </Link>
                .
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {events.map((e) => (
                  <li key={String(e._id)}>
                    <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-ink hover:underline">
                      {e.title}
                    </a>
                    <p className="text-xs text-muted">
                      {e.publisher} · {fmtDate(e.publicationDate)}
                      {e.retractedAt ? " · retracted" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="DLD project register" subtitle="Exact name or alias match">
            {dldRegister.length === 0 ? (
              <p className="text-sm text-muted">No matching register entry (no DLD Projects export imported, or the DLD name differs — add it as an alias after checking).</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {dldRegister.map((d) => (
                  <li key={String(d._id)}>
                    <span className="text-ink">{d.projectName}</span> · {d.developerName ?? "—"} · {d.projectStatus ?? "—"}
                    {d.completedPct != null ? ` · ${d.completedPct}%` : ""}
                    <span className="block text-xs text-muted">retrieved {fmtDate(d.retrievedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <SectionHeading id="location">Location</SectionHeading>
      <Panel
        title={
          <>
            <MapPin aria-hidden className="size-4 text-brand" /> Map position
          </>
        }
        subtitle={geo ? `${geo.precision === "verified" ? "Verified" : "Approximate"} · ${geo.source} · recorded ${fmtDateTime(geo.recordedAt)}` : "No position recorded. Place the project from an identified source."}
        footer={
          locationFacts.length ? (
            <>
              Location hints from brochures (not coordinates):{" "}
              {locationFacts.map((f) => `“${f.value}” (${docName(f.sourceDocumentId)} p.${f.sourcePage})`).join("; ")}
            </>
          ) : (
            "No location statement was extracted from brochures for this project."
          )
        }
      >
        <LocationEditor
          projectId={String(project._id)}
          current={
            geo
              ? {
                  id: String(project._id),
                  name: project.name,
                  lat: geo.lat,
                  lng: geo.lng,
                  precision: geo.precision as "verified" | "approximate",
                  units: stats?.records ?? 0,
                  medianPrice: stats?.price.median ?? null,
                  medianPsf: stats?.psf.median ?? null,
                  typologies: stats?.typologies ?? [],
                  source: geo.source,
                }
              : null
          }
        />
        {(project.geoHistory ?? []).length ? (
          <details className="mt-4 text-xs">
            <summary className="cursor-pointer text-link">Location history ({(project.geoHistory ?? []).length})</summary>
            <ul className="mt-2 space-y-1 text-ink-2">
              {[...(project.geoHistory ?? [])].reverse().map((h, i) => (
                <li key={i}>
                  {fmtDateTime(h.at)} — {h.action === "set" ? `set ${h.precision} ${h.lat}, ${h.lng} · ${h.source}${h.sourceUrl ? ` (${h.sourceUrl})` : ""}` : `removed · ${h.note}`}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Panel>

      <SectionHeading>Ingestion history and identity review</SectionHeading>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title={
            <>
              <History aria-hidden className="size-4 text-muted" /> Snapshot timeline
            </>
          }
          subtitle="Every inventory snapshot that lists this project, including older extractions"
          bodyClassName="p-0"
        >
          {timeline.length === 0 ? (
            <p className="p-4 text-sm text-muted">No inventory snapshot lists this project.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Document</th>
                  <th className={th}>Snapshot date</th>
                  <th className={th}>Imported</th>
                  <th className={`${th} text-right`}>Records</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((t) => (
                  <tr key={t.id}>
                    <td className={td}>
                      {t.filename}
                      {t.superseded ? <span className="ml-1 text-xs text-muted">(older extraction)</span> : null}
                      <span className="block font-mono text-[10.5px] text-muted">{t.sha256.slice(0, 12)}… · {t.extractionVersion}</span>
                    </td>
                    <td className={td}>{t.dateKnown ? fmtDate(t.snapshotDate) : <span className="text-warn">Unknown date</span>}</td>
                    <td className={`${td} whitespace-nowrap text-xs text-ink-2`}>{fmtDateTime(t.importedAt)}</td>
                    <td className={tdNum}>{fmtInt(t.records)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {runs.length ? (
            <ul className="divide-y divide-line border-t border-line">
              {runs.slice(0, 6).map((run) => (
                <li key={String(run._id)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs">
                  <Link className={link} href={`/sources/runs/${run._id}`}>
                    {fmtDateTime(run.startedAt)} · {run.filename ?? run.sourceKey}
                  </Link>
                  <StatusPill status={run.status} />
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel
          title={
            <>
              <GitMerge aria-hidden className="size-4 text-muted" /> Aliases and merge (human review)
            </>
          }
          subtitle="Decisions are recorded with your evidence; original names stay auditable as aliases"
          bodyClassName="p-4 space-y-5"
        >
          {issues.filter((i) => i.rule !== "possible_project_alias").length ? (
            <ul className="space-y-2">
              {issues
                .filter((i) => i.rule !== "possible_project_alias")
                .map((i) => (
                  <li key={String(i._id)} className="text-xs text-ink-2">
                    <SeverityPill severity={i.severity} /> {i.details}
                  </li>
                ))}
            </ul>
          ) : null}
          <ActionForm action={addAliasAction} submitLabel="Add alias">
            <input type="hidden" name="projectId" value={String(project._id)} />
            <p className="mb-2 text-sm text-ink-2">Add a name another source uses for this project (e.g. the DLD project name). Transactions with exactly that name are then linked.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={label}>
                Alias exactly as written
                <input name="alias" required maxLength={200} className={`${input} w-full normal-case tracking-normal`} />
              </label>
              <label className={label}>
                Evidence
                <input name="note" required minLength={5} maxLength={500} className={`${input} w-full normal-case tracking-normal`} />
              </label>
            </div>
          </ActionForm>
          <div className="border-t border-line pt-4">
            {otherProjects.length === 0 ? (
              <p className="text-sm text-muted">No other projects exist.</p>
            ) : (
              <ActionForm action={mergeProjectAction} submitLabel="Merge into selected project" confirm={`Merge "${project.name}" into the selected project? Its records move to the target and this name becomes an alias. This cannot be undone automatically.`}>
                <input type="hidden" name="sourceId" value={String(project._id)} />
                <p className="mb-2 text-sm text-ink-2">Merge only when the sources confirm both names are the same project. All observations move to the target; this name becomes an alias.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className={label}>
                    Merge into
                    <select name="targetId" required className={`${input} w-full normal-case tracking-normal`}>
                      {otherProjects.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={label}>
                    Evidence
                    <input name="note" required minLength={5} maxLength={500} className={`${input} w-full normal-case tracking-normal`} />
                  </label>
                </div>
              </ActionForm>
            )}
          </div>
        </Panel>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <FileText aria-hidden className="size-3.5" /> Figures use {scope ? `${scope.filename} (${scope.dateKnown ? `dated ${fmtDate(scope.snapshotDate)}` : "snapshot date unknown"})` : "no inventory snapshot"}.
        <Link className={`${link} inline-flex items-center gap-1`} href="/methodology">
          Methodology <ExternalLink aria-hidden className="size-3" />
        </Link>
      </p>
    </div>
  );
}
