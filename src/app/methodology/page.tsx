import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ClaimBadge, link, PageHeader, Panel, td, th } from "@/components/ui";
import { COMPARISON_MIN_SAMPLE, OUTLIER_K, OUTLIER_MIN_SAMPLE, PRICE_BANDS, REVIEW_WARNING_CODES, SIZE_BANDS, warningInfo } from "@/lib/inventory-analytics";
import { METRICS, UNAVAILABLE_METRICS } from "@/lib/metrics";
import { SQFT_PER_SQM } from "@/lib/normalize";
import { SOURCE_DEFINITIONS } from "@/lib/sources";
import { REJECTION_LABELS } from "@/server/queries/analytics";
import { CLAIM_TYPES } from "@/server/models";

export const metadata: Metadata = { title: "Methodology & Definitions" };

const CLAIM_EXPLAINED: Record<string, string> = {
  documented: "Printed in a supplied document (e.g. a row in Merge2.pdf). Proves what the document says, not that it is true today.",
  marketing_claim: "A developer's promotional statement (brochure text, launch messaging). Not independently verified.",
  official_public: "Published by the company itself on an official channel.",
  reported_public: "Reported independently by a third party.",
  listed_price: "An asking/list price in an inventory document. Not a transaction price.",
  registered_transaction: "A transaction registered with the Dubai Land Department.",
  calculated: "Computed by this app from stored records with a documented formula.",
  estimated: "An estimate. Kept separate from observations; none are currently produced.",
  unverified: "Recorded but not yet checked against another source.",
  unavailable: "No suitable source exists; shown as unavailable rather than guessed.",
};

const INFO_WARNINGS = ["wrapped_text_joined", "project_from_section_heading", "area_converted_from_sqm", "header_from_page_3"];

const TOC = [
  ["counting", "Counting rules"],
  ["metrics", "Metric definitions"],
  ["warnings", "Validation checks"],
  ["insights", "Findings and comparisons"],
  ["locations", "Locations"],
  ["evidence", "Evidence classes"],
  ["conventions", "Conventions"],
  ["sources", "Sources"],
  ["unavailable", "Unavailable metrics"],
] as const;

export default function MethodologyPage() {
  return (
    <div className="grid gap-8 xl:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label="On this page" className="hidden xl:block">
        <ul className="sticky top-24 space-y-1 text-sm">
          {TOC.map(([id, text]) => (
            <li key={id}>
              <a href={`#${id}`} className="block rounded px-2 py-1 text-ink-2 hover:bg-surface-2 hover:text-ink">
                {text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 space-y-6">
        <PageHeader eyebrow="System" title="Methodology & Definitions" description="How every number in the application is produced: what is counted, what is excluded, which formula is used and what each figure cannot tell you." />

        <Panel id="counting" title="Counting rules" bodyClassName="p-4">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
            <li>
              <strong className="text-ink">Analysis scope = one snapshot.</strong> Inventory figures always describe a single inventory document (snapshot), shown in the scope bar. By default this is the snapshot with
              the latest printed date; if none is dated, the most recently imported one — its import time is still never presented as a snapshot date. A unit listed in two documents is therefore never counted twice.
            </li>
            <li>
              <strong className="text-ink">Unit records</strong> are accepted rows (they have a unit number). Status and composition counts are per record and match the Inventory Explorer row counts exactly.
            </li>
            <li>
              <strong className="text-ink">Analysis set</strong> (all prices, sizes, AED/sq ft and listed value): one record per distinct unit — project + normalized unit number. Identical duplicate rows count once;
              units whose duplicates disagree on price, size or status are excluded and counted. Exclusion counts appear beside the affected KPIs.
            </li>
            <li>
              <strong className="text-ink">Validity:</strong> a price or size counts only if it is a finite number greater than zero. AED/sq ft is computed only when both are valid. Nothing is imputed.
            </li>
            <li>
              <strong className="text-ink">Status labels</strong> are as printed in the source document. “Available” proves only what the document recorded on its own date, never current availability.
            </li>
            <li>
              <strong className="text-ink">Listed inventory value</strong> is the sum of asking prices in the analysis set. It is not revenue, sales or transaction value.
            </li>
            <li>
              <strong className="text-ink">Rejected and unplaced lines</strong> are stored with their original text and reported separately from accepted records:
              <ul className="mt-1 list-[circle] space-y-1 pl-5">
                {Object.entries(REJECTION_LABELS).map(([k, v]) => (
                  <li key={k}>
                    <span className="text-ink">{v.label}</span> ({v.kind}) — {v.explanation}
                  </li>
                ))}
              </ul>
            </li>
            <li>
              <strong className="text-ink">Bands:</strong> price bands (AED) {PRICE_BANDS.map((b) => b[2]).join(", ")}; size bands (sq ft) {SIZE_BANDS.map((b) => b[2]).join(", ")}. Lower bound inclusive, upper bound exclusive.
            </li>
          </ul>
        </Panel>

        <Panel id="metrics" title="Metric definitions" bodyClassName="p-0">
          <div className="divide-y divide-line">
            {Object.values(METRICS).map((m) => (
              <section key={m.id} id={m.id} className="px-4 py-4">
                <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {m.name} <Badge>{m.kind}</Badge>
                </h3>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[150px_1fr]">
                  <dt className="text-muted">Definition</dt>
                  <dd className="text-ink-2">{m.definition}</dd>
                  <dt className="text-muted">Formula</dt>
                  <dd className="font-mono text-xs text-ink-2">{m.formula}</dd>
                  <dt className="text-muted">Source</dt>
                  <dd className="text-ink-2">{m.source}</dd>
                  <dt className="text-muted">Filters</dt>
                  <dd className="text-ink-2">{m.filters}</dd>
                  <dt className="text-muted">Date basis</dt>
                  <dd className="text-ink-2">{m.dateBasis}</dd>
                  <dt className="text-muted">Duplicates</dt>
                  <dd className="text-ink-2">{m.duplicates}</dd>
                  <dt className="text-muted">Limitations</dt>
                  <dd className="text-ink-2">{m.limitations}</dd>
                </dl>
              </section>
            ))}
          </div>
        </Panel>

        <Panel id="warnings" title="Validation checks" subtitle="Recorded per record during extraction; the original text is always kept" bodyClassName="p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={th}>Check</th>
                <th className={th}>Level</th>
                <th className={th}>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {[...REVIEW_WARNING_CODES, ...INFO_WARNINGS].map((code) => {
                const w = warningInfo(code);
                return (
                  <tr key={code}>
                    <td className={td}>
                      <span className="text-ink">{w.label}</span>
                      <span className="block font-mono text-[11px] text-muted">{code === "header_from_page_3" ? "header_from_page_N" : code}</span>
                    </td>
                    <td className={td}>{w.review ? <Badge tone="warn">Review required</Badge> : <Badge>Informational</Badge>}</td>
                    <td className={`${td} text-ink-2`}>{w.explanation.replace("page 3", "page N")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <Panel id="insights" title="Findings and comparisons" bodyClassName="p-4">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
            <li>Key findings on the Command Center are deterministic rules over the analysis scope (largest project by records, highest median price, widest AED/sq ft spread, most common typology, share labelled available, data gaps). Each states its sample and caveat and links to the records it describes.</li>
            <li>A project&apos;s median or spread is compared with others only when it has at least {COMPARISON_MIN_SAMPLE} priced units; smaller groups are shown greyed as “small sample”.</li>
            <li>
              Outliers use Tukey fences on AED/sq ft within the current filters: below Q1 − {OUTLIER_K}×IQR or above Q3 + {OUTLIER_K}×IQR, with at least {OUTLIER_MIN_SAMPLE} units. An outlier is a value to check, not an error.
            </li>
            <li>Snapshots are compared in time only when at least two carry a printed date. No appreciation, depreciation, causal or investment conclusion is drawn.</li>
            <li>DLD transactions are attributed to Danube only through the DLD project register (developer name) or an exact project-name/reviewed-alias match — never a similar-looking name.</li>
          </ul>
        </Panel>

        <Panel id="locations" title="Locations" bodyClassName="p-4">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
            <li>Project positions are recorded by a person with a source, precision and optional URL. Nothing is geocoded automatically; projects without a position are listed, never placed at a default point.</li>
            <li>
              <strong className="text-ink">Verified</strong>: building-level position confirmed in an authoritative source. <strong className="text-ink">Approximate</strong>: community or district level.
            </li>
            <li>Coordinates must fall inside the UAE; swapped latitude/longitude is detected. Every set or removal is kept in the project&apos;s location history.</li>
            <li>
              Map tiles: © <a className={link} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>, loaded by the browser from openstreetmap.org. No paid map API is used.
            </li>
          </ul>
        </Panel>

        <Panel id="evidence" title="Evidence classes" bodyClassName="p-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            {CLAIM_TYPES.map((c) => (
              <div key={c}>
                <dt>
                  <ClaimBadge type={c} />
                </dt>
                <dd className="mt-1 text-sm text-ink-2">{CLAIM_EXPLAINED[c]}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel id="conventions" title="Conventions" bodyClassName="p-4">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
            <li>Area: 1 m² = {SQFT_PER_SQM.toFixed(7)} sq ft (international foot). DLD sizes (m²) are converted; inventory sizes are used as printed in sq ft, and sq m columns are converted and flagged.</li>
            <li>Currency: all values are AED as published. No currency conversion.</li>
            <li>Dates: calendar dates are stored date-only and displayed without time-zone shifts. Import and retrieval times are shown in Gulf Standard Time.</li>
            <li>Date filters include both the start and the end day.</li>
            <li>Medians and percentiles are exact (linear interpolation between order statistics, as Excel PERCENTILE.INC), computed from stored rows and covered by unit tests.</li>
            <li>Project names are linked only on an exact normalized key (case, spaces and punctuation ignored). Anything looser requires a person to add an alias or merge projects, and that decision is recorded.</li>
            <li>Snapshot dates come only from dates printed in the document. File or import dates are never used as substitutes.</li>
          </ul>
        </Panel>

        <Panel id="sources" title="Sources" bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {SOURCE_DEFINITIONS.map((s) => (
              <li key={s.key} className="px-4 py-3 text-sm">
                <p className="font-medium text-ink">{s.name}</p>
                <p className="mt-0.5 text-ink-2">{s.accessMethod}</p>
                <p className="mt-0.5 text-xs text-muted">{s.usageNotes}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel id="unavailable" title="Unavailable metrics" subtitle="Shown as unavailable rather than estimated" bodyClassName="p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={th}>Metric</th>
                <th className={th}>Data that would be required</th>
              </tr>
            </thead>
            <tbody>
              {UNAVAILABLE_METRICS.map((m) => (
                <tr key={m.name}>
                  <td className={`${td} text-ink`}>{m.name}</td>
                  <td className={`${td} text-ink-2`}>{m.requires}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <p className="text-xs text-muted">
          Questions about a specific number? Every KPI has an <span className="text-ink">ⓘ</span> definition, and every chart has a data table. See also{" "}
          <Link className={link} href="/system">
            System Health
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
