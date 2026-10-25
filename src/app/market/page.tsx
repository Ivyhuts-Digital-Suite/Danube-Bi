import { ArrowRight, Landmark, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { TimeBarChart } from "@/components/charts";
import { FilterChips, type Chip } from "@/components/filters";
import { Badge, btn, btnPrimary, DataError, EmptyState, input, KpiCard, label, link, loadDb, Notice, PageHeader, Panel, SectionHeading, Skeleton, td, tdNum, th } from "@/components/ui";
import { BarList, ChartPanel, Meter } from "@/components/viz";
import { fmtAED, fmtAEDCompact, fmtDate, fmtInt, fmtNum1, fmtPct } from "@/lib/format";
import { flatParams } from "@/lib/url";
import { attributionCoverage, linkedProjectTransactions, marketFacets, marketSummary, parseMarketFilter, propertyTypeBreakdown, SHARE_COVERAGE_THRESHOLD } from "@/server/queries/market";

export const metadata: Metadata = { title: "Market Intelligence" };

export default function MarketPage(props: PageProps<"/market">) {
  return (
    <>
      <PageHeader
        eyebrow="Market"
        title="Market Intelligence"
        description="Registered transactions from Dubai Land Department exports that you imported. These are kept strictly separate from Danube inventory listings and from public announcements; registered value is market activity, not Danube revenue."
      />
      <Suspense fallback={<Skeleton rows={3} />}>
        <Market searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

const DLD_URL = "https://dubailand.gov.ae/en/open-data/real-estate-data/";

async function Market({ searchParams }: { searchParams: PageProps<"/market">["searchParams"] }) {
  const sp = flatParams(await searchParams);
  const f = parseMarketFilter(sp);
  const r = await loadDb(async () => {
    const facets = await marketFacets();
    if (!facets.range) return { facets, summary: null, linked: [], types: [], coverage: null };
    const [summary, linked, types, coverage] = await Promise.all([marketSummary(f), linkedProjectTransactions(f), propertyTypeBreakdown(f), attributionCoverage(f)]);
    return { facets, summary, linked, types, coverage };
  });
  if (!r.ok) return <DataError error={r.error} />;
  const { facets, summary, linked, types, coverage } = r.data;

  if (!facets.range) {
    return (
      <div className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-3">
          <SourceCard title="Danube inventory listings" status="Imported" tone="good" body="Listed (asking) prices and status labels from the supplied inventory PDF. Analysed on Inventory, Pricing and Projects." href="/pricing" />
          <SourceCard title="DLD registered transactions" status="Not imported" tone="warn" body="Official registrations from the Dubai Land Department. Needed for transaction volume, value and registered price per area." href="/sources#dld" />
          <SourceCard title="Public announcements" status="Manual entry" tone="neutral" body="Launches, payment plans and handovers recorded by hand with a URL and date. Company statements are claims, not transactions." href="/timeline" />
        </div>
        <EmptyState
          icon={Landmark}
          title="No DLD transaction data has been imported"
          action={
            <Link href="/sources#dld" className={btnPrimary}>
              Import DLD CSV exports <ArrowRight aria-hidden className="size-4" />
            </Link>
          }
        >
          <p>
            Market charts appear only when real DLD exports are present — nothing is estimated from listings. The{" "}
            <a className={link} href={DLD_URL} target="_blank" rel="noopener noreferrer">
              DLD Real Estate Data page
            </a>{" "}
            protects downloads with a CAPTCHA, so this is a manual step:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              <strong className="text-ink">Projects</strong> tab → Download as CSV (gives developer names for attribution).
            </li>
            <li>
              <strong className="text-ink">Transactions</strong> tab → choose a date range (e.g. Sales, Residential) → Download as CSV.
            </li>
            <li>Upload both on Sources &amp; Imports, or place them in <code>data/incoming/dld/</code>.</li>
          </ol>
          <p className="mt-2 text-xs text-muted">DLD site terms permit personal, non-commercial use. Transactions are attributed to Danube only through the DLD project register or a reviewed alias — never by a similar-looking project name.</p>
        </EmptyState>
      </div>
    );
  }

  const period = `${f.from ? fmtDate(f.from) : fmtDate(facets.range.min)} – ${f.to ? fmtDate(f.to) : fmtDate(facets.range.max)}`;
  const filterText = [f.transactionType, f.registrationType, f.usage, f.propertyType].filter(Boolean).join(" · ") || "all transaction types";
  const params = { from: sp.from, to: sp.to, type: sp.type, reg: sp.reg, usage: sp.usage, ptype: sp.ptype };
  const chips: Chip[] = [];
  if (sp.from) chips.push({ key: "from", label: `From ${sp.from}` });
  if (sp.to) chips.push({ key: "to", label: `To ${sp.to}` });
  if (sp.type) chips.push({ key: "type", label: `Type: ${sp.type}` });
  if (sp.reg) chips.push({ key: "reg", label: `Registration: ${sp.reg}` });
  if (sp.usage) chips.push({ key: "usage", label: `Usage: ${sp.usage}` });
  if (sp.ptype) chips.push({ key: "ptype", label: `Property: ${sp.ptype}` });

  return (
    <div className="space-y-6">
      <section aria-label="Filters" className="space-y-3 rounded-panel border border-line bg-surface p-4 shadow-panel">
        <Form action="/market" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(6,minmax(0,1fr))_auto]">
          <label className={label}>
            From
            <input type="date" name="from" defaultValue={sp.from ?? ""} className={`${input} w-full`} />
          </label>
          <label className={label}>
            To (inclusive)
            <input type="date" name="to" defaultValue={sp.to ?? ""} className={`${input} w-full`} />
          </label>
          {(
            [
              ["type", "Transaction type", facets.types],
              ["reg", "Registration", facets.regs],
              ["usage", "Usage", facets.usages],
              ["ptype", "Property type", facets.ptypes],
            ] as const
          ).map(([name, text, options]) => (
            <label key={name} className={label}>
              {text}
              <select name={name} defaultValue={sp[name] ?? ""} className={`${input} w-full normal-case tracking-normal`}>
                <option value="">All</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className="flex items-end gap-2">
            <button className={btnPrimary} type="submit">
              Apply
            </button>
            <Link className={btn} href="/market">
              Reset
            </Link>
          </div>
        </Form>
        <FilterChips path="/market" params={params} chips={chips} />
        <p className="text-xs text-muted">
          Imported coverage: {fmtInt(facets.range.n)} transactions dated {fmtDate(facets.range.min)} – {fmtDate(facets.range.max)}. Results reflect only the exports imported, not the whole market.
        </p>
      </section>

      {!summary ? (
        <EmptyState icon={SearchX} title="No transactions match these filters" action={<Link className={btn} href="/market">Reset filters</Link>} />
      ) : (
        <>
          {!f.transactionType ? <Notice tone="warn">Mixed transaction types (e.g. mortgages and gifts) are included. Filter to Sales before reading price per sq ft or market share.</Notice> : null}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Registered transactions" value={fmtInt(summary.totals.count)} sub={`${period} · ${filterText}`} metric="registered_tx_count" />
            <KpiCard label="Registered transaction value" value={fmtAEDCompact(summary.totals.value)} sub="Market activity — not Danube revenue" metric="registered_tx_value" />
            <KpiCard label="Median registered AED / sq ft" value={summary.medianPsf != null ? fmtNum1(summary.medianPsf) : "—"} sub={`n = ${fmtInt(summary.psfSample)} with a DLD property size > 0`} metric="registered_psf_median" />
            <KpiCard
              label="Danube share of registered value"
              value={summary.danube.developerNames.length ? fmtPct(summary.danube.valueShare) : "—"}
              sub={
                summary.danube.developerNames.length
                  ? `${fmtInt(summary.danube.count)} transactions · attribution coverage ${fmtPct(summary.coverage)}${summary.shareReliable ? "" : " — below 80%, not reliable"}`
                  : `No transaction attributed to a Danube developer · coverage ${fmtPct(summary.coverage)}`
              }
              metric="developer_share"
              tone={summary.shareReliable ? undefined : "warn"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartPanel title="Transactions per month" metric="registered_tx_count" subtitle={`${period} · ${filterText}`} source="DLD Transactions export (Transaction Date)" table={{ head: ["Month", "Transactions", "Danube-attributed"], rows: summary.monthly.map((m) => [m._id, m.count, m.danubeCount]) }}>
              <TimeBarChart data={summary.monthly.map((m) => ({ label: m._id, value: m.count }))} valueLabel="registered transactions" ariaLabel="Registered transactions per month" />
            </ChartPanel>
            <ChartPanel title="Registered value per month" metric="registered_tx_value" subtitle={`${period} · ${filterText}`} source="DLD Transactions export (Amount)" table={{ head: ["Month", "Value (AED)", "Danube-attributed (AED)"], rows: summary.monthly.map((m) => [m._id, Math.round(m.value), Math.round(m.danubeValue)]) }}>
              <TimeBarChart data={summary.monthly.map((m) => ({ label: m._id, value: m.value }))} fmt="aed" valueLabel="registered value" ariaLabel="Registered transaction value per month" />
            </ChartPanel>
            <ChartPanel title="By property type" info="DLD Property Type as exported." subtitle="Transactions in the selection" table={{ head: ["Property type", "Transactions", "Value (AED)"], rows: types.map((t) => [t._id ?? "Not recorded", t.count, Math.round(t.value)]) }}>
              <BarList ariaLabel="Transactions by property type" items={types.slice(0, 10).map((t) => ({ key: t._id ?? "none", label: t._id ?? "Not recorded", value: t.count, display: `${fmtInt(t.count)} · ${fmtAEDCompact(t.value)}`, muted: !t._id }))} />
            </ChartPanel>
            <Panel title="Attribution coverage" subtitle="How much of the selection can be tied to a developer or to a project in this app" bodyClassName="p-4 space-y-3">
              {coverage ? (
                <>
                  <Meter label="Transactions with a DLD project name" value={coverage.named} total={coverage.total} />
                  <Meter label="Attributed to a developer (DLD register, exact name)" value={coverage.developer} total={coverage.total} tone={coverage.total && coverage.developer / coverage.total < SHARE_COVERAGE_THRESHOLD ? "warn" : undefined} />
                  <Meter label="Linked to a project here (exact name or reviewed alias)" value={coverage.linked} total={coverage.total} />
                  <p className="text-xs text-muted">
                    Unmatched names are listed on{" "}
                    <Link className={link} href="/quality?queue=dld">
                      Data Quality
                    </Link>
                    . A similar project name is never enough to attribute a transaction.
                  </p>
                </>
              ) : null}
            </Panel>
          </div>

          <SectionHeading>Developers and projects</SectionHeading>
          <Panel title="Developer share of registered value" subtitle={`Coverage ${fmtPct(summary.coverage)} of value; a share is reliable only at ≥ ${fmtPct(SHARE_COVERAGE_THRESHOLD, 0)}`} bodyClassName="p-0">
            {!summary.shareReliable ? (
              <div className="p-4 pb-0">
                <Notice tone="warn">Less than 80% of value is attributed to a developer. Shares below are lower bounds, not market share.</Notice>
              </div>
            ) : null}
            <div className="scroll-thin mt-2 overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>Developer (DLD name)</th>
                    <th className={`${th} text-right`}>Transactions</th>
                    <th className={`${th} text-right`}>Value</th>
                    <th className={`${th} text-right`}>Share of value</th>
                    <th className={`${th} text-right`}>Share of count</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.developerShares.slice(0, 20).map((d) => (
                    <tr key={d.developerName} className={d.isDanube ? "bg-brand-soft" : ""}>
                      <td className={td}>
                        {d.developerName} {d.isDanube ? <Badge tone="brand">matched as Danube</Badge> : null}
                      </td>
                      <td className={tdNum}>{fmtInt(d.count)}</td>
                      <td className={tdNum}>{fmtAEDCompact(d.value)}</td>
                      <td className={tdNum}>{fmtPct(d.valueShare)}</td>
                      <td className={tdNum}>{fmtPct(d.countShare)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className={`${td} italic text-ink-2`}>Unattributed (no exact register match)</td>
                    <td className={tdNum}>{fmtInt(summary.unattributedCount)}</td>
                    <td className={tdNum}>{fmtAEDCompact(summary.unattributedValue)}</td>
                    <td className={tdNum}>{fmtPct(summary.totals.value ? summary.unattributedValue / summary.totals.value : 0)}</td>
                    <td className={tdNum}>{fmtPct(summary.totals.count ? summary.unattributedCount / summary.totals.count : 0)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 text-xs text-muted">
              “Danube” = DLD developer names containing “danube”{summary.danube.developerNames.length ? `: ${summary.danube.developerNames.join("; ")}` : " (none in this selection)"}. Verify these names before relying on the share.
            </p>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Most active DLD project names" subtitle="By transaction count in the selection" bodyClassName="p-0">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>Project (as reported by DLD)</th>
                    <th className={th}>Developer</th>
                    <th className={`${th} text-right`}>Transactions</th>
                    <th className={`${th} text-right`}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.topProjects.map((p) => (
                    <tr key={p._id}>
                      <td className={td}>
                        {p.projectId ? (
                          <Link className={link} href={`/projects/${p.projectId}`}>
                            {p._id}
                          </Link>
                        ) : (
                          p._id
                        )}
                      </td>
                      <td className={`${td} text-ink-2`}>{p.developerName ?? "unattributed"}</td>
                      <td className={tdNum}>{fmtInt(p.count)}</td>
                      <td className={tdNum}>{fmtAEDCompact(p.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <Panel title="Transactions linked to projects here" subtitle="Exact name or reviewed alias only" bodyClassName="p-0">
              {linked.length === 0 ? (
                <p className="p-4 text-sm text-muted">
                  None linked yet. Review{" "}
                  <Link className={link} href="/quality?queue=dld">
                    unmatched DLD names
                  </Link>{" "}
                  and add confirmed aliases on project pages.
                </p>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>Project</th>
                      <th className={`${th} text-right`}>Transactions</th>
                      <th className={`${th} text-right`}>Value</th>
                      <th className={th}>Dates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linked.map((l) => (
                      <tr key={l.projectId}>
                        <td className={td}>
                          <Link className={link} href={`/projects/${l.projectId}`}>
                            {l.name}
                          </Link>
                        </td>
                        <td className={tdNum}>{fmtInt(l.count)}</td>
                        <td className={tdNum}>{fmtAED(l.value)}</td>
                        <td className={`${td} text-xs text-ink-2`}>
                          {fmtDate(l.first)} – {fmtDate(l.last)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function SourceCard({ title, status, tone, body, href }: { title: string; status: string; tone: "good" | "warn" | "neutral"; body: string; href: string }) {
  return (
    <Link href={href} className="block rounded-panel border border-line bg-surface p-4 shadow-panel transition-colors hover:border-line-strong hover:bg-surface-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <Badge tone={tone}>{status}</Badge>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-2">{body}</p>
    </Link>
  );
}
