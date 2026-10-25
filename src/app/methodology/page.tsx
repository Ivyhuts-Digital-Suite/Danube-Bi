import type { Metadata } from "next";
import { Card, ClaimBadge, PageHeader } from "@/components/ui";
import { METRICS, UNAVAILABLE_METRICS } from "@/lib/metrics";
import { SQFT_PER_SQM } from "@/lib/normalize";
import { SOURCE_DEFINITIONS } from "@/lib/sources";
import { CLAIM_TYPES } from "@/server/models";

export const metadata: Metadata = { title: "Methodology" };

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

export default function MethodologyPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Methodology" description="Definitions, formulas, evidence classes and limitations used throughout the application." />

      <Card title="Evidence classes">
        <dl className="grid gap-3 sm:grid-cols-2">
          {CLAIM_TYPES.map((c) => (
            <div key={c}>
              <dt><ClaimBadge type={c} /></dt>
              <dd className="mt-1 text-sm text-ink-2">{CLAIM_EXPLAINED[c]}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Metric definitions">
        <div className="space-y-4">
          {Object.values(METRICS).map((m) => (
            <section key={m.id} id={m.id} className="border-b border-line pb-4 last:border-0">
              <h3 className="text-sm font-semibold">{m.name}</h3>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[160px_1fr]">
                <dt className="text-ink-2">Definition</dt><dd>{m.definition}</dd>
                <dt className="text-ink-2">Formula</dt><dd className="font-mono text-xs">{m.formula}</dd>
                <dt className="text-ink-2">Source</dt><dd>{m.source}</dd>
                <dt className="text-ink-2">Filters</dt><dd>{m.filters}</dd>
                <dt className="text-ink-2">Date basis</dt><dd>{m.dateBasis}</dd>
                <dt className="text-ink-2">Duplicates</dt><dd>{m.duplicates}</dd>
                <dt className="text-ink-2">Limitations</dt><dd>{m.limitations}</dd>
              </dl>
            </section>
          ))}
        </div>
      </Card>

      <Card title="Conventions">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Area: 1 m² = {SQFT_PER_SQM.toFixed(7)} sq ft (international foot). DLD sizes (m²) are converted; inventory sizes are used as printed in sq ft, and sq m columns are converted and flagged.</li>
          <li>Currency: all values are AED as published. No currency conversion is performed.</li>
          <li>Dates: calendar dates (DLD transaction dates, snapshot dates, publication dates) are stored as date-only values and displayed without time-zone shifts. Import and retrieval times are shown in Gulf Standard Time.</li>
          <li>Date filters are inclusive of both the start and end day.</li>
          <li>Medians and percentiles are exact (linear interpolation between order statistics), computed from the stored rows.</li>
          <li>Project names are matched only on an exact normalized key (case, spaces and punctuation ignored). Anything looser requires a person to add an alias or merge projects, and that decision is recorded.</li>
          <li>Snapshot dates come only from dates printed in the document. File or import dates are never used as substitutes.</li>
        </ul>
      </Card>

      <Card title="Sources">
        <ul className="space-y-3 text-sm">
          {SOURCE_DEFINITIONS.map((s) => (
            <li key={s.key}>
              <p className="font-medium">{s.name}</p>
              <p className="text-ink-2">{s.accessMethod}</p>
              <p className="text-xs text-muted">{s.usageNotes}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Unavailable metrics">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {UNAVAILABLE_METRICS.map((m) => (
            <li key={m.name}>
              <strong>{m.name}</strong> — requires {m.requires.toLowerCase()}.
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
