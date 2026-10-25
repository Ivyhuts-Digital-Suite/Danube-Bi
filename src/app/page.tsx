import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CircleDollarSign,
  ClipboardList,
  FileWarning,
  Lightbulb,
  MapPinned,
  Ruler,
  Scale,
  Tag,
  TriangleAlert,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Histogram } from "@/components/charts";
import { FreshnessBadge, ScopeBar } from "@/components/scope";
import { STATUS_COLORS } from "@/components/status-colors";
import { Badge, DataError, EmptyState, KpiCard, loadDb, Notice, PageHeader, Panel, SectionHeading, Skeleton, StatusPill, Unavailable, link } from "@/components/ui";
import { BarList, ChartPanel, Meter, RangeList, StackedBar } from "@/components/viz";
import { fmtAED, fmtAEDCompact, fmtDate, fmtInt, fmtPct } from "@/lib/format";
import { COMPARISON_MIN_SAMPLE, deriveInsights, STATUS_KEYS, STATUS_LABELS, type GroupSummary } from "@/lib/inventory-analytics";
import { UNAVAILABLE_METRICS } from "@/lib/metrics";
import { href } from "@/lib/url";
import { rejectionInfo } from "@/server/queries/analytics";
import { getCommandCenter } from "@/server/queries/overview";

export default function CommandCenter() {
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Command Center"
        description="What the imported evidence says about the inventory: how much was captured, how it is priced, and how far the data can be trusted. Every figure is computed from stored records — nothing is estimated."
      />
      <Suspense fallback={<Skeleton rows={4} />}>
        <Overview />
      </Suspense>
    </>
  );
}

const inv = (p: Record<string, string>) => href("/inventory", p);
const aedM = (v: number) => `${(v / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;

function projectBars(groups: GroupSummary[], by: "records" | "value") {
  return groups
    .filter((g) => g.key !== "none" && (by === "records" || g.listedValue > 0))
    .sort((a, b) => (by === "records" ? b.records - a.records : b.listedValue - a.listedValue))
    .slice(0, 12)
    .map((g) => ({
      key: g.key,
      label: g.label,
      value: by === "records" ? g.records : g.listedValue,
      display: by === "records" ? fmtInt(g.records) : fmtAEDCompact(g.listedValue),
      secondary: by === "records" ? `${fmtInt(g.status.available)} available · median ${g.price.median != null ? `AED ${aedM(g.price.median)}` : "—"}` : `${fmtInt(g.price.n)} priced units`,
      href: `/projects/${g.key}`,
      details: [
        ["Accepted records", fmtInt(g.records)],
        ["Priced units", fmtInt(g.price.n)],
        ["Median listed price", fmtAED(g.price.median)],
        ["Median AED / sq ft", g.psf.median != null ? fmtInt(g.psf.median) : "—"],
      ] as Array<[string, string]>,
    }));
}

async function Overview() {
  const r = await loadDb(getCommandCenter);
  if (!r.ok) return <DataError error={r.error} />;
  const now = new Date();
  const d = r.data;
  const a = d.analytics;
  const scope = d.scope.current;
  const failed = d.runs.filter((x) => x.status === "failed" || x.status === "interrupted");
  const openIssues = d.issues.reduce((s, i) => s + i.n, 0);

  if (!scope) {
    return (
      <div className="space-y-4">
        {failed.length ? <FailedRuns runs={failed} /> : null}
        <EmptyState
          icon={Upload}
          title="No inventory has been imported yet"
          action={
            <Link href="/sources" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-medium text-bg">
              Go to Sources &amp; Imports <ArrowRight aria-hidden className="size-4" />
            </Link>
          }
        >
          Put <code>Merge1.pdf</code> and <code>Merge2.pdf</code> in <code>data/incoming/</code> and import them (or run <code>npm run ingest -- pdf</code>). The Command Center fills in from the imported records.
        </EmptyState>
      </div>
    );
  }

  const linkedProjects = a.projects.filter((p) => p.key !== "none");
  const insights = deriveInsights(a, {
    snapshotDateKnown: scope.dateKnown,
    rejectedRecords: d.rejections.total,
    pagesWithoutText: scope.pagesWithoutText,
    inventoryHref: inv,
  });
  const psfRanges = linkedProjects
    .filter((g) => g.psf.n >= 3 && g.psf.min != null)
    .sort((x, y) => (y.psf.median ?? 0) - (x.psf.median ?? 0))
    .map((g) => ({
      key: g.key,
      label: g.label,
      n: g.psf.n,
      min: g.psf.min!,
      p25: g.psf.p25!,
      median: g.psf.median!,
      p75: g.psf.p75!,
      max: g.psf.max!,
      small: g.psf.n < COMPARISON_MIN_SAMPLE,
      href: href("/pricing", { project: g.key }),
    }));
  const typologyTop = a.typologies.slice(0, 10);
  const typologyRest = a.typologies.slice(10).reduce((s, t) => s + t.records, 0);
  const clean = a.records - a.coverage.reviewRequired;
  const extracted = a.records + d.rejections.total;

  return (
    <div className="space-y-6">
      <ScopeBar scope={d.scope} path="/" />
      {failed.length ? <FailedRuns runs={failed} /> : null}

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={ClipboardList}
          label="Accepted unit records"
          value={fmtInt(a.records)}
          sub={
            <>
              {fmtInt(a.dedup.distinctUnits)} distinct unit numbers · {fmtInt(d.rejections.total)} lines rejected or unplaced
            </>
          }
          source="Records captured from the document — not the total real-world inventory, which no imported source states."
          metric="accepted_records"
          href="/inventory"
        />
        <KpiCard
          icon={BadgeCheck}
          label="Recorded as available"
          value={fmtInt(a.status.available)}
          sub={`${fmtPct(a.records ? a.status.available / a.records : null)} of records · label as printed in the source`}
          source={scope.dateKnown ? `Document dated ${fmtDate(scope.snapshotDate)} — not live availability.` : "Document has no printed date — cannot be placed in time."}
          metric="status_available"
          tone={scope.dateKnown ? undefined : "warn"}
          href={inv({ status: "available" })}
        />
        <KpiCard
          icon={Tag}
          label="Recorded as sold"
          value={fmtInt(a.status.sold)}
          sub={
            a.status.sold === 0
              ? "No record carries a sold label in this document."
              : `${fmtPct(a.records ? a.status.sold / a.records : null)} of records`
          }
          source={`${fmtInt(a.status.reserved)} reserved · ${fmtInt(a.status.other)} unrecognized · ${fmtInt(a.status.missing)} without status`}
          info="Counts records whose status cell reads Sold / Sold out / Registered. An inventory document usually lists stock on offer, so few or no sold labels is expected and is not a sales figure."
          href={a.status.sold ? inv({ status: "sold" }) : undefined}
        />
        <KpiCard
          icon={CircleDollarSign}
          label="Listed inventory value"
          value={a.listedValue.units ? fmtAEDCompact(a.listedValue.sum) : <Unavailable reason="No record has a valid listed price." />}
          sub={`Sum of asking prices of ${fmtInt(a.listedValue.units)} distinct priced units`}
          source={`Not revenue or sales. Excluded: ${fmtInt(a.listedValue.excludedNoPrice)} without price, ${fmtInt(a.dedup.duplicateRowsCollapsed)} duplicate rows, ${fmtInt(a.dedup.conflictingUnits)} conflicting units.`}
          metric="listed_inventory_value"
        />
        <KpiCard
          icon={Scale}
          label="Median listed price"
          value={a.price.median != null ? `AED ${aedM(a.price.median)}` : <Unavailable reason="No valid listed prices." />}
          sub={a.price.n ? `IQR AED ${aedM(a.price.p25!)} – ${aedM(a.price.p75!)}` : undefined}
          source={`n = ${fmtInt(a.price.n)} priced units`}
          metric="listed_price_median"
          href="/pricing"
        />
        <KpiCard
          icon={Ruler}
          label="Median AED / sq ft"
          value={a.psf.median != null ? fmtInt(a.psf.median) : <Unavailable reason="No unit has both a valid price and size." />}
          sub={a.psf.n ? `IQR ${fmtInt(a.psf.p25)} – ${fmtInt(a.psf.p75)} AED/sq ft` : undefined}
          source={`n = ${fmtInt(a.psf.n)} units with price and size · listed, not transacted`}
          metric="listed_psf_median"
          href="/pricing"
        />
        <KpiCard
          icon={Building2}
          label="Projects represented"
          value={fmtInt(linkedProjects.length)}
          sub={`${fmtInt(d.geo.total)} project records in total · ${fmtInt(d.geo.located)} with a map position`}
          source="Exact-name matching only; similar names stay separate until reviewed."
          metric="distinct_projects"
          href="/projects"
        />
        <KpiCard
          icon={TriangleAlert}
          label="Records requiring review"
          value={fmtInt(a.coverage.reviewRequired)}
          sub={`${fmtPct(a.records ? a.coverage.reviewRequired / a.records : null)} of accepted records · ${fmtInt(openIssues)} open quality issues`}
          source="Missing or unreadable price/size, unrecognized status, unusual values."
          metric="review_required"
          tone={a.coverage.reviewRequired > 0 ? "warn" : undefined}
          href={inv({ flag: "review" })}
        />
      </div>

      {/* Insights + investigate next */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title={
            <>
              <Lightbulb aria-hidden className="size-4 text-brand" /> Key findings
            </>
          }
          subtitle="Generated deterministically from the records in scope. Each states its sample and caveat; none is investment advice."
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-line">
            {insights.map((i) => (
              <li key={i.id} className="px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${i.tone === "warn" ? "bg-warn" : "bg-brand"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{i.title}</p>
                    <p className="mt-0.5 text-sm text-ink-2">{i.detail}</p>
                    <p className="mt-1 text-xs text-muted">
                      {i.sample}
                      {i.caveat ? ` · ${i.caveat}` : ""}
                    </p>
                  </div>
                  {i.href ? (
                    <Link href={i.href} className="shrink-0 text-xs text-link hover:underline" aria-label={`Trace: ${i.title}`}>
                      Trace →
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title={
            <>
              <FileWarning aria-hidden className="size-4 text-warn" /> Investigate next
            </>
          }
          subtitle="Data-quality items that most affect the numbers above"
          bodyClassName="p-4 space-y-4"
          footer={
            <span className="flex flex-wrap items-center gap-2">
              Latest successful import: {d.lastSuccess ? <FreshnessBadge at={d.lastSuccess} now={now} /> : "never"}
            </span>
          }
        >
          <ul className="space-y-2.5 text-sm">
            <NextItem show={!scope.dateKnown} tone="warn" href="/quality?queue=snapshots" title="Snapshot date not printed">
              Statuses and prices cannot be placed in time; dated comparisons are disabled.
            </NextItem>
            <NextItem show={a.coverage.reviewRequired > 0} tone="warn" href={inv({ flag: "review" })} title={`${fmtInt(a.coverage.reviewRequired)} records need review`}>
              {fmtInt(a.records - a.coverage.withPrice)} without price · {fmtInt(a.records - a.coverage.withArea)} without size · {fmtInt(a.status.other + a.status.missing)} with no/unrecognized status
            </NextItem>
            <NextItem show={d.rejections.total > 0} tone="crit" href="/quality?queue=rejected" title={`${fmtInt(d.rejections.total)} PDF lines rejected or unplaced`}>
              {d.rejections.byReason.map((x) => `${fmtInt(x.count)} ${rejectionInfo(x.reason).label.toLowerCase()}`).join(" · ")}
            </NextItem>
            <NextItem show={!!scope.pagesWithoutText} tone="warn" href="/quality?queue=extraction" title={`${fmtInt(scope.pagesWithoutText)} pages without a text layer`}>
              Image-only pages were not read (no OCR). Their units are missing from every figure.
            </NextItem>
            <NextItem
              show={d.issues.some((i) => i._id.rule === "possible_project_alias")}
              tone="info"
              href="/quality?queue=aliases"
              title={`${fmtInt(d.issues.filter((i) => i._id.rule === "possible_project_alias").reduce((s, i) => s + i.n, 0))} possible project aliases`}
            >
              Similar project names kept separate until a person reviews them.
            </NextItem>
            <NextItem show={d.geo.located === 0} tone="info" href="/geography" title="No project has a map position">
              Record verified coordinates to enable the geographic view.
            </NextItem>
          </ul>
        </Panel>
      </div>

      <SectionHeading description="All charts use the analysis scope above">Inventory composition</SectionHeading>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel
          title="Recorded status labels"
          metric="status_available"
          subtitle={`${fmtInt(a.records)} accepted records · labels as printed in the document`}
          source={`${scope.filename}, ${scope.dateKnown ? `dated ${fmtDate(scope.snapshotDate)}` : "snapshot date unknown"}`}
          summary={`${fmtInt(a.status.available)} of ${fmtInt(a.records)} records are labelled available and ${fmtInt(a.status.sold)} sold.`}
          table={{ head: ["Status label", "Records", "Share"], rows: STATUS_KEYS.map((k) => [STATUS_LABELS[k], a.status[k], a.records ? `${((a.status[k] / a.records) * 100).toFixed(1)}%` : "—"]) }}
        >
          <StackedBar
            ariaLabel="Records by recorded status"
            segments={STATUS_KEYS.map((k) => ({ key: k, label: STATUS_LABELS[k], value: a.status[k], color: STATUS_COLORS[k], href: inv({ status: k }) }))}
          />
          {a.status.other > 0 ? (
            <p className="mt-3 text-xs text-muted">
              “Unrecognized label” usually means other page text was read into the status column —{" "}
              <Link className={link} href={inv({ status: "other" })}>
                review those records
              </Link>
              .
            </p>
          ) : null}
        </ChartPanel>

        <ChartPanel
          title="Extraction outcome"
          info="Every line the PDF table extractor found: accepted records (clean or needing review), rejected lines (no unit number) and unplaced lines (numbers outside the table columns). Rejected and unplaced lines are kept for review, never silently dropped."
          subtitle={`${fmtInt(extracted)} table lines read from ${scope.filename}`}
          source="Import run and rejected-record log"
          table={{
            head: ["Outcome", "Lines"],
            rows: [
              ["Accepted — clean", clean],
              ["Accepted — review required", a.coverage.reviewRequired],
              ["Rejected", d.rejections.rejected],
              ["Unplaced", d.rejections.unplaced],
            ],
          }}
        >
          <StackedBar
            ariaLabel="Extracted lines by outcome"
            unit="lines"
            segments={[
              { key: "clean", label: "Accepted · clean", value: clean, color: "var(--good)", href: inv({ warnings: "any" }) },
              { key: "review", label: "Accepted · needs review", value: a.coverage.reviewRequired, color: "var(--warn)", href: inv({ flag: "review" }) },
              { key: "rejected", label: "Rejected", value: d.rejections.rejected, color: "var(--crit)", href: "/quality?queue=rejected" },
              { key: "unplaced", label: "Unplaced", value: d.rejections.unplaced, color: "var(--series-muted)", href: "/quality?queue=rejected&reason=line_with_numbers_outside_table_columns" },
            ]}
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Meter label="Records with a valid price" value={a.coverage.withPrice} total={a.records} />
            <Meter label="Records with a valid size" value={a.coverage.withArea} total={a.records} />
            <Meter label="Records with a status label" value={a.coverage.withStatus} total={a.records} />
            <Meter label="Records linked to a project" value={a.coverage.withProject} total={a.records} />
          </div>
        </ChartPanel>

        <ChartPanel
          title="Inventory by project"
          metric="accepted_records"
          subtitle="Accepted records per project, largest first (top 12)"
          source={scope.filename}
          table={{ head: ["Project", "Records", "Available", "Priced units", "Median price (AED)"], rows: linkedProjects.map((g) => [g.label, g.records, g.status.available, g.price.n, g.price.median]) }}
        >
          <BarList ariaLabel="Accepted records by project" items={projectBars(a.projects, "records")} />
        </ChartPanel>

        <ChartPanel
          title="Listed inventory value by project"
          metric="listed_inventory_value"
          subtitle="Sum of asking prices of distinct priced units — not revenue"
          source={scope.filename}
          table={{ head: ["Project", "Listed value (AED)", "Priced units"], rows: linkedProjects.filter((g) => g.listedValue > 0).map((g) => [g.label, Math.round(g.listedValue), g.price.n]) }}
        >
          <BarList ariaLabel="Listed inventory value by project" color="var(--series-5)" items={projectBars(a.projects, "value")} />
        </ChartPanel>
      </div>

      <SectionHeading>Pricing and size</SectionHeading>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel
          title="Listed price distribution"
          metric="listed_price_median"
          subtitle={`${fmtInt(a.price.n)} distinct priced units in AED price bands`}
          source={scope.filename}
          table={{ head: ["Listed price band (AED)", "Units"], rows: a.priceBands.map((b) => [b.label, b.count]) }}
        >
          <Histogram data={a.priceBands.map((b) => ({ label: b.label, count: b.count }))} xLabel="Listed price (AED)" ariaLabel="Histogram of listed prices by band" />
        </ChartPanel>

        <ChartPanel
          title="AED / sq ft by project"
          metric="listed_psf_median"
          subtitle={`Median and middle 50% per project · projects with ≥ 3 units; < ${COMPARISON_MIN_SAMPLE} marked small sample`}
          source={scope.filename}
          table={{ head: ["Project", "n", "Min", "P25", "Median", "P75", "Max"], rows: psfRanges.map((g) => [g.label, g.n, Math.round(g.min), Math.round(g.p25), Math.round(g.median), Math.round(g.p75), Math.round(g.max)]) }}
        >
          <RangeList items={psfRanges} ariaLabel="Listed AED per square foot by project" unitLabel="units" />
          <p className="mt-3 text-xs text-muted">Projects differ in unit mix (studios, offices, villas). Compare like with like on Pricing Intelligence.</p>
        </ChartPanel>

        <ChartPanel
          title="Unit size distribution"
          info="Distinct units with a valid size, grouped in sq ft bands. Sizes are as printed; square-metre columns were converted and flagged."
          subtitle={`${fmtInt(a.area.n)} units · median ${fmtInt(a.area.median)} sq ft`}
          source={scope.filename}
          table={{ head: ["Size band (sq ft)", "Units"], rows: a.sizeBands.map((b) => [b.label, b.count]) }}
        >
          <Histogram data={a.sizeBands.map((b) => ({ label: b.label, count: b.count }))} xLabel="Size (sq ft)" ariaLabel="Histogram of unit sizes by band" />
        </ChartPanel>

        <ChartPanel
          title="Typology composition"
          info="Typology exactly as written in the document. Similar labels (e.g. truncated ones) are not merged, so a few appear separately."
          subtitle={`Top 10 of ${fmtInt(a.typologies.length)} typology labels`}
          source={scope.filename}
          table={{ head: ["Typology", "Records", "Median price (AED)"], rows: a.typologies.map((t) => [t.label, t.records, t.price.median]) }}
        >
          <BarList
            ariaLabel="Records by typology"
            color="var(--series-3)"
            items={[
              ...typologyTop.map((t) => ({
                key: t.key,
                label: t.label,
                value: t.records,
                display: `${fmtInt(t.records)} · ${fmtPct(a.records ? t.records / a.records : null)}`,
                href: t.key === "none" ? undefined : inv({ typology: t.key }),
                muted: t.key === "none",
              })),
              ...(typologyRest > 0 ? [{ key: "_other", label: `Other (${a.typologies.length - 10} labels)`, value: typologyRest, display: fmtInt(typologyRest), muted: true }] : []),
            ]}
          />
        </ChartPanel>
      </div>

      <SectionHeading>Sources, freshness and limits</SectionHeading>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Source freshness" subtitle="Latest import per source and its outcome" className="xl:col-span-2" bodyClassName="p-0" actions={<Link className={link} href="/sources">Sources &amp; Imports →</Link>}>
          <ul className="divide-y divide-line">
            {d.sources.map((s) => {
              const run = d.runs.find((x) => x._id === s.key);
              return (
                <li key={s.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{s.name}</p>
                    <p className="text-xs text-muted">{run ? `Last run ${run.status.replace(/_/g, " ")}${run.filename ? ` · ${run.filename}` : ""}` : "No import run recorded"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {s.lastSuccessfulFetchAt ? <FreshnessBadge at={s.lastSuccessfulFetchAt} now={now} /> : null}
                    <StatusPill status={s.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
        <div className="space-y-4">
          <Panel title="Market & public sources" bodyClassName="p-4 space-y-3 text-sm">
            <p className="flex items-start justify-between gap-3">
              <span className="text-ink-2">DLD registered transactions</span>
              {d.tx ? <span className="tabular text-ink">{fmtInt(d.tx.n)}</span> : <Badge tone="warn">Not imported</Badge>}
            </p>
            <p className="flex items-start justify-between gap-3">
              <span className="text-ink-2">Public announcements</span>
              {d.eventCount ? <span className="tabular text-ink">{fmtInt(d.eventCount)}</span> : <Badge>None recorded</Badge>}
            </p>
            <p className="flex items-start justify-between gap-3">
              <span className="flex items-center gap-1.5 text-ink-2">
                <MapPinned aria-hidden className="size-3.5" /> Projects with map position
              </span>
              <span className="tabular text-ink">
                {fmtInt(d.geo.located)} / {fmtInt(d.geo.total)}
              </span>
            </p>
            <p className="text-xs text-muted">Listed inventory prices are never mixed with DLD registered transactions.</p>
          </Panel>
          <Panel title="Not available from these sources" bodyClassName="p-4">
            <ul className="space-y-1 text-xs text-ink-2">
              {UNAVAILABLE_METRICS.slice(0, 5).map((m) => (
                <li key={m.name}>
                  <span className="text-ink">{m.name}</span> — needs {m.requires.toLowerCase()}
                </li>
              ))}
            </ul>
            <Link href="/methodology#unavailable" className={`${link} mt-2 inline-block text-xs`}>
              Full list →
            </Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function NextItem({ show, tone, href: to, title, children }: { show: boolean; tone: "warn" | "crit" | "info"; href: string; title: string; children: ReactNode }) {
  if (!show) return null;
  const dot = tone === "crit" ? "bg-crit" : tone === "warn" ? "bg-warn" : "bg-accent";
  return (
    <li>
      <Link href={to} className="group -mx-2 flex gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2">
        <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0">
          <span className="block font-medium text-ink group-hover:underline">{title}</span>
          <span className="block text-xs text-ink-2">{children}</span>
        </span>
      </Link>
    </li>
  );
}

function FailedRuns({ runs }: { runs: Array<{ _id: string; runId: string; error: string | null; status: string }> }) {
  return (
    <Notice tone="crit" title={`The latest import failed for ${runs.length} source(s)`}>
      {runs.map((f, i) => (
        <span key={f._id}>
          {i > 0 ? "; " : ""}
          <Link className="underline" href={`/sources/runs/${f.runId}`}>
            {f._id}
          </Link>{" "}
          — {f.error ?? f.status}
        </span>
      ))}
    </Notice>
  );
}
