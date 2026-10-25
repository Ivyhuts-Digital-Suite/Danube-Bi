import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ChartFrame } from "@/components/chart-frame";
import { TimeBarChart } from "@/components/charts";
import { btn, btnPrimary, Card, DataError, EmptyState, input, Kpi, loadDb, Notice, PageHeader, Skeleton, td, tdNum, th } from "@/components/ui";
import { fmtAED, fmtAEDCompact, fmtDate, fmtInt, fmtNum1, fmtPct } from "@/lib/format";
import { linkedProjectTransactions, marketFacets, marketSummary, parseMarketFilter, SHARE_COVERAGE_THRESHOLD } from "@/server/queries/market";

export const metadata: Metadata = { title: "Market Intelligence" };

export default function MarketPage(props: PageProps<"/market">) {
  return (
    <>
      <PageHeader
        title="Market Intelligence"
        description="Registered transactions from imported Dubai Land Department exports. Registered values are market activity — not Danube revenue — and are never mixed with listed or brochure prices."
      />
      <Suspense fallback={<Skeleton rows={5} />}>
        <Market searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Market({ searchParams }: { searchParams: PageProps<"/market">["searchParams"] }) {
  const sp = await searchParams;
  const f = parseMarketFilter(sp);
  const r = await loadDb(async () => {
    const facets = await marketFacets();
    if (!facets.range) return { facets, summary: null, linked: [] };
    const [summary, linked] = await Promise.all([marketSummary(f), linkedProjectTransactions(f)]);
    return { facets, summary, linked };
  });
  if (!r.ok) return <DataError error={r.error} />;
  const { facets, summary, linked } = r.data;
  if (!facets.range) {
    return (
      <EmptyState title="No DLD transaction data has been imported">
        Download a Transactions export from the{" "}
        <a className="text-accent underline" href="https://dubailand.gov.ae/en/open-data/real-estate-data/" target="_blank" rel="noopener noreferrer">DLD Real Estate Data page</a> (the form requires a CAPTCHA, so this is a manual step), plus a Projects export for developer attribution, then import them on{" "}
        <Link className="text-accent underline" href="/sources">Sources &amp; Imports</Link>.
      </EmptyState>
    );
  }
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const period = `${f.from ? fmtDate(f.from) : fmtDate(facets.range.min)} – ${f.to ? fmtDate(f.to) : fmtDate(facets.range.max)}`;
  const filterText = [f.transactionType, f.registrationType, f.usage, f.propertyType].filter(Boolean).join(" · ") || "all transaction types";

  return (
    <div className="space-y-6">
      <Form action="/market" className="grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-3 lg:grid-cols-7">
        <label className="text-xs text-ink-2">
          From
          <input type="date" name="from" defaultValue={str(sp.from)} className={`${input} mt-1 w-full`} />
        </label>
        <label className="text-xs text-ink-2">
          To (inclusive)
          <input type="date" name="to" defaultValue={str(sp.to)} className={`${input} mt-1 w-full`} />
        </label>
        {(
          [
            ["type", "Transaction type", facets.types],
            ["reg", "Registration", facets.regs],
            ["usage", "Usage", facets.usages],
            ["ptype", "Property type", facets.ptypes],
          ] as const
        ).map(([name, label, options]) => (
          <label key={name} className="text-xs text-ink-2">
            {label}
            <select name={name} defaultValue={str(sp[name])} className={`${input} mt-1 w-full`}>
              <option value="">All</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
        <div className="flex items-end gap-2">
          <button className={btnPrimary} type="submit">Apply</button>
          <Link className={btn} href="/market">Reset</Link>
        </div>
      </Form>

      <p className="text-xs text-muted">
        Imported coverage: {fmtInt(facets.range.n)} transactions dated {fmtDate(facets.range.min)} – {fmtDate(facets.range.max)}. Results reflect only the exports that were imported, not the whole market.
      </p>

      {!summary ? (
        <EmptyState title="No transactions match these filters" />
      ) : (
        <>
          {!f.transactionType ? (
            <Notice tone="warn">Mixed transaction types (e.g. mortgages and gifts) are included. Filter to Sales before reading price per sq ft or market share.</Notice>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Registered transactions" value={fmtInt(summary.totals.count)} sub={`${period} · ${filterText}`} metric="registered_tx_count" />
            <Kpi label="Registered transaction value" value={fmtAEDCompact(summary.totals.value)} sub="Market activity, not Danube revenue" metric="registered_tx_value" />
            <Kpi label="Median registered AED / sq ft" value={fmtNum1(summary.medianPsf)} sub={`n = ${fmtInt(summary.psfSample)} with DLD property size > 0`} metric="registered_psf_median" />
            <Kpi
              label="Danube share of registered value"
              value={summary.danube.developerNames.length ? fmtPct(summary.danube.valueShare) : "—"}
              sub={
                summary.danube.developerNames.length
                  ? `${fmtInt(summary.danube.count)} transactions · attribution coverage ${fmtPct(summary.coverage)}${summary.shareReliable ? "" : " — below 80%, not reliable"}`
                  : `No transactions attributed to a Danube developer · coverage ${fmtPct(summary.coverage)}`
              }
              metric="developer_share"
              tone={summary.shareReliable ? undefined : "warn"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartFrame
              title="Registered transactions per month"
              metric="registered_tx_count"
              period={`${period} · ${filterText}`}
              source="DLD Transactions export (Transaction Date)"
              table={{ head: ["Month", "Transactions", "Danube-attributed"], rows: summary.monthly.map((m) => [m._id, m.count, m.danubeCount]) }}
            >
              <TimeBarChart data={summary.monthly.map((m) => ({ label: m._id, value: m.count }))} valueLabel="registered transactions" ariaLabel="Registered transactions per month" />
            </ChartFrame>
            <ChartFrame
              title="Registered transaction value per month"
              metric="registered_tx_value"
              period={`${period} · ${filterText}`}
              source="DLD Transactions export (Amount)"
              table={{ head: ["Month", "Value (AED)", "Danube-attributed value (AED)"], rows: summary.monthly.map((m) => [m._id, Math.round(m.value), Math.round(m.danubeValue)]) }}
            >
              <TimeBarChart data={summary.monthly.map((m) => ({ label: m._id, value: m.value }))} fmt="aed" valueLabel="registered value" ariaLabel="Registered transaction value per month" />
            </ChartFrame>
          </div>

          <Card
            title="Developer share of registered value"
            subtitle={`Developer attributed through the DLD project register by exact project name. Coverage ${fmtPct(summary.coverage)} of value; threshold for a reliable share ${fmtPct(SHARE_COVERAGE_THRESHOLD, 0)}.`}
          >
            {!summary.shareReliable ? (
              <Notice tone="warn">Less than 80% of value is attributed to a developer. Shares below are lower bounds and should not be read as market share.</Notice>
            ) : null}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
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
                    <tr key={d.developerName} className={d.isDanube ? "bg-accent-soft" : ""}>
                      <td className={td}>{d.developerName}{d.isDanube ? " (matched as Danube)" : ""}</td>
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
            <p className="mt-2 text-xs text-muted">
              &quot;Danube&quot; = DLD developer names containing &quot;danube&quot;{summary.danube.developerNames.length ? `: ${summary.danube.developerNames.join("; ")}` : " (none found in this selection)"}. Verify these names before relying on the share.
            </p>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Most active DLD project names" subtitle="By registered transaction count in the selection">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
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
                        <td className={td}>{p.projectId ? <Link className="text-accent hover:underline" href={`/projects/${p.projectId}`}>{p._id}</Link> : p._id}</td>
                        <td className={`${td} text-ink-2`}>{p.developerName ?? "unattributed"}</td>
                        <td className={tdNum}>{fmtInt(p.count)}</td>
                        <td className={tdNum}>{fmtAEDCompact(p.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Transactions linked to projects in this app" subtitle="Linked only by exact name or a reviewed alias">
              {linked.length === 0 ? (
                <EmptyState title="No transactions linked yet">
                  Review <Link className="text-accent underline" href="/quality?rule=unmatched_project_candidate">unmatched project names</Link> and add confirmed aliases on project pages.
                </EmptyState>
              ) : (
                <table className="w-full text-sm">
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
                        <td className={td}><Link className="text-accent hover:underline" href={`/projects/${l.projectId}`}>{l.name}</Link></td>
                        <td className={tdNum}>{fmtInt(l.count)}</td>
                        <td className={tdNum}>{fmtAED(l.value)}</td>
                        <td className={`${td} text-xs text-ink-2`}>{fmtDate(l.first)} – {fmtDate(l.last)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
