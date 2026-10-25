import { Building2, FileText, LayoutGrid, MapPin, Rows3, Search, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ScopeBar, SnapshotDateBadge } from "@/components/scope";
import { Badge, btn, btnPrimary, DataError, EmptyState, input, loadDb, PageHeader, Skeleton, td, tdNum, th } from "@/components/ui";
import { fmtAED, fmtAEDCompact, fmtInt } from "@/lib/format";
import { flatParams, href } from "@/lib/url";
import { getPortfolio, type PortfolioProject } from "@/server/queries/portfolio";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage(props: PageProps<"/projects">) {
  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Projects"
        description="Every project named in the imported documents, with its captured inventory, listed pricing and evidence. Names are linked only on an exact match; similar names stay separate until a person reviews them."
      />
      <Suspense fallback={<Skeleton rows={2} />}>
        <Portfolio searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

const SORTS = {
  records: "Most unit records",
  median: "Highest median price",
  value: "Largest listed value",
  name: "Name (A–Z)",
} as const;
type SortKey = keyof typeof SORTS;

const ATTRIBUTION: Record<PortfolioProject["attribution"], { label: string; tone: "good" | "warn" | "neutral"; help: string }> = {
  project_column: { label: "Project column", tone: "good", help: "Every record's project was read from the project column of the table." },
  mixed: { label: "Partly from headings", tone: "warn", help: "Some records took their project from a page heading because the page had no project column." },
  section_heading: { label: "From page headings", tone: "warn", help: "All records took their project from a page heading (no project column). Lower confidence." },
  no_inventory: { label: "No inventory records", tone: "neutral", help: "Named in brochures or other sources, but no accepted inventory record is linked." },
};

function sortItems(items: PortfolioProject[], sort: SortKey) {
  const s = [...items];
  if (sort === "name") return s.sort((a, b) => a.name.localeCompare(b.name));
  const key = (p: PortfolioProject) => (sort === "records" ? (p.stats?.records ?? 0) : sort === "median" ? (p.stats?.price.median ?? -1) : (p.stats?.listedValue ?? 0));
  return s.sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
}

async function Portfolio({ searchParams }: { searchParams: PageProps<"/projects">["searchParams"] }) {
  const sp = flatParams(await searchParams);
  const q = (sp.q ?? "").slice(0, 100);
  const sort: SortKey = sp.sort && sp.sort in SORTS ? (sp.sort as SortKey) : "records";
  const view = sp.view === "table" ? "table" : "cards";
  const show = sp.show === "all" ? "all" : "inventory";
  const r = await loadDb(() => getPortfolio(q || undefined));
  if (!r.ok) return <DataError error={r.error} />;
  const { scope, items, unlinkedRecords } = r.data;
  const visible = sortItems(show === "all" ? items : items.filter((p) => p.stats), sort);
  const params = { q: q || undefined, sort: sort !== "records" ? sort : undefined, view: view !== "cards" ? view : undefined, show: show !== "inventory" ? show : undefined };
  const withInventory = items.filter((p) => p.stats).length;

  return (
    <div className="space-y-5">
      <ScopeBar scope={scope} path="/projects" params={params} />
      <div className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-3 shadow-panel 2xl:flex-row 2xl:items-center">
        <Form action="/projects" className="flex flex-1 gap-2">
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="show" value={show} />
          <label htmlFor="project-q" className="sr-only">
            Search projects by name or alias
          </label>
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input id="project-q" name="q" defaultValue={q} placeholder="Search by name or alias" maxLength={100} className={`${input} w-full pl-8`} />
          </div>
          <button className={btnPrimary} type="submit">
            Search
          </button>
        </Form>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <nav aria-label="Sort projects" className="flex items-center gap-1">
            <span className="mr-1 text-muted">Sort</span>
            {(Object.keys(SORTS) as SortKey[]).map((k) => (
              <Link key={k} href={href("/projects", params, { sort: k === "records" ? null : k })} aria-current={sort === k ? "true" : undefined} className={`rounded-md px-2 py-1 ${sort === k ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2"}`}>
                {SORTS[k]}
              </Link>
            ))}
          </nav>
          <span className="hidden h-5 w-px bg-line 2xl:block" />
          <Link href={href("/projects", params, { show: show === "all" ? null : "all" })} className="rounded-md px-2 py-1 text-ink-2 hover:bg-surface-2" aria-pressed={show === "all"}>
            {show === "all" ? `Showing all ${items.length}` : `Show all ${items.length} (incl. brochure-only)`}
          </Link>
          <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="View">
            <Link href={href("/projects", params, { view: null })} aria-pressed={view === "cards"} className={`inline-flex items-center gap-1 px-2 py-1 ${view === "cards" ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2"}`}>
              <LayoutGrid aria-hidden className="size-3.5" /> Cards
            </Link>
            <Link href={href("/projects", params, { view: "table" })} aria-pressed={view === "table"} className={`inline-flex items-center gap-1 border-l border-line px-2 py-1 ${view === "table" ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2"}`}>
              <Rows3 aria-hidden className="size-3.5" /> Table
            </Link>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted">
        {fmtInt(visible.length)} project{visible.length === 1 ? "" : "s"} shown · {fmtInt(withInventory)} with inventory records in scope
        {unlinkedRecords ? ` · ${fmtInt(unlinkedRecords)} records have no project` : ""}
      </p>

      {visible.length === 0 ? (
        <EmptyState icon={Building2} title={q ? "No project matches this search" : "No projects yet"} action={q ? <Link className={btn} href="/projects">Clear search</Link> : undefined}>
          {q ? "Try part of the name, or search aliases." : "Projects are created when Merge1.pdf, Merge2.pdf or DLD exports are imported (Sources & Imports)."}
        </EmptyState>
      ) : view === "cards" ? (
        <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map((p) => (
            <li key={p.id}>
              <ProjectCard p={p} snapshot={scope.current} />
            </li>
          ))}
        </ul>
      ) : (
        <ProjectTable items={visible} />
      )}
    </div>
  );
}

function ProjectCard({ p, snapshot }: { p: PortfolioProject; snapshot: Parameters<typeof SnapshotDateBadge>[0]["snapshot"] | null }) {
  const s = p.stats;
  const att = ATTRIBUTION[p.attribution];
  const typTotal = s ? s.typologies.reduce((x, t) => x + t.count, 0) : 0;
  return (
    <article className="flex h-full flex-col rounded-panel border border-line bg-surface shadow-panel transition-colors hover:border-line-strong">
      <div className="border-b border-line px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-[17px] font-semibold text-ink">
              <Link href={`/projects/${p.id}`} className="hover:underline">
                {p.name}
              </Link>
            </h2>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted" title="Normalized match key">
              key: {p.normalizedName}
              {p.aliases.length ? ` · ${p.aliases.length} alias${p.aliases.length > 1 ? "es" : ""}` : ""}
            </p>
          </div>
          {p.geo ? (
            <Badge tone={p.geo.precision === "verified" ? "good" : "neutral"} icon={MapPin}>
              {p.geo.precision}
            </Badge>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={att.tone} title={att.help}>
            {att.label}
          </Badge>
          {p.possibleAliases ? (
            <Badge tone="warn" icon={TriangleAlert} title="Flagged as possibly the same project as another name. Review on Data Quality.">
              {p.possibleAliases} possible alias
            </Badge>
          ) : null}
          {s && snapshot ? <SnapshotDateBadge snapshot={snapshot} /> : null}
        </div>
      </div>
      {s ? (
        <div className="grid flex-1 gap-4 px-4 py-3">
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="text-[11px] text-muted">Unit records</dt>
              <dd className="tabular text-lg font-semibold text-ink">{fmtInt(s.records)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">Median listed</dt>
              <dd className="tabular text-lg font-semibold text-ink">{s.price.median != null ? fmtAEDCompact(s.price.median).replace("AED ", "") : "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">AED / sq ft</dt>
              <dd className="tabular text-lg font-semibold text-ink">{s.psf.median != null ? fmtInt(s.psf.median) : "—"}</dd>
            </div>
          </dl>
          <p className="tabular text-xs text-ink-2">
            {s.price.n ? `Listed AED ${fmtAEDCompact(s.price.min).replace("AED ", "")} – ${fmtAEDCompact(s.price.max).replace("AED ", "")} · n = ${fmtInt(s.price.n)} priced` : "No valid listed prices"}
          </p>
          {s.typologies.length ? (
            <div>
              <p className="mb-1.5 text-[11px] text-muted">Typology mix (top {s.typologies.length})</p>
              <ul className="space-y-1">
                {s.typologies.map((t) => (
                  <li key={t.label} className="grid grid-cols-[minmax(0,1fr)_5rem_2.5rem] items-center gap-2 text-xs">
                    <span className="truncate text-ink-2" title={t.label}>
                      {t.label}
                    </span>
                    <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-track">
                      <span className="block h-full rounded-full bg-series-3" style={{ width: `${typTotal ? (t.count / s.records) * 100 : 0}%` }} />
                    </span>
                    <span className="tabular text-right text-ink">{fmtInt(t.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3 text-[11px] text-muted">
            <span>
              Price coverage <span className="tabular text-ink">{p.coverage.records ? Math.round((p.coverage.withPrice / p.coverage.records) * 100) : 0}%</span>
            </span>
            <span>
              Size coverage <span className="tabular text-ink">{p.coverage.records ? Math.round((p.coverage.withArea / p.coverage.records) * 100) : 0}%</span>
            </span>
          </div>
        </div>
      ) : (
        <p className="flex-1 px-4 py-3 text-xs text-ink-2">
          No accepted inventory records in scope. Evidence: {fmtInt(p.brochurePages)} brochure page(s), {fmtInt(p.facts)} brochure claim(s){p.transactions ? `, ${fmtInt(p.transactions)} DLD transactions` : ""}.
        </p>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[11px] text-muted">
        <span className="flex min-w-0 items-center gap-1 truncate">
          <FileText aria-hidden className="size-3.5 shrink-0" />
          {p.sourceFiles.join(", ") || "—"}
        </span>
        <Link href={`/projects/${p.id}`} className="shrink-0 text-link hover:underline">
          Open →
        </Link>
      </div>
    </article>
  );
}

function ProjectTable({ items }: { items: PortfolioProject[] }) {
  return (
    <div className="scroll-thin overflow-x-auto rounded-panel border border-line bg-surface shadow-panel">
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            <th className={th}>Project</th>
            <th className={`${th} text-right`}>Records</th>
            <th className={`${th} text-right`}>Available</th>
            <th className={`${th} text-right`}>Median listed</th>
            <th className={`${th} text-right`}>Price range (AED)</th>
            <th className={`${th} text-right`}>Median AED/sq ft</th>
            <th className={`${th} text-right`}>Listed value</th>
            <th className={th}>Attribution</th>
            <th className={th}>Sources</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="hover:bg-surface-2">
              <td className={td}>
                <Link href={`/projects/${p.id}`} className="font-medium text-link hover:underline">
                  {p.name}
                </Link>
                {p.possibleAliases ? <TriangleAlert aria-label="Possible alias flagged" className="ml-1.5 inline size-3.5 text-warn" /> : null}
                {p.aliases.length ? <p className="text-[11px] text-muted">aka {p.aliases.join(", ")}</p> : null}
              </td>
              <td className={tdNum}>{fmtInt(p.stats?.records ?? 0)}</td>
              <td className={tdNum}>{fmtInt(p.stats?.status.available ?? 0)}</td>
              <td className={tdNum}>{fmtAED(p.stats?.price.median)}</td>
              <td className={tdNum}>{p.stats?.price.n ? `${fmtAEDCompact(p.stats.price.min).replace("AED ", "")} – ${fmtAEDCompact(p.stats.price.max).replace("AED ", "")}` : "—"}</td>
              <td className={tdNum}>{p.stats?.psf.median != null ? fmtInt(p.stats.psf.median) : "—"}</td>
              <td className={tdNum}>{p.stats?.listedValue ? fmtAEDCompact(p.stats.listedValue) : "—"}</td>
              <td className={td}>
                <Badge tone={ATTRIBUTION[p.attribution].tone} title={ATTRIBUTION[p.attribution].help}>
                  {ATTRIBUTION[p.attribution].label}
                </Badge>
              </td>
              <td className={`${td} text-xs text-ink-2`}>{p.sourceFiles.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
