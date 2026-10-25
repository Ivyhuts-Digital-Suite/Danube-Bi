// Metric definitions displayed next to every KPI and chart. Each calculated metric here has a
// matching query in src/server/queries and tests in tests/.

export type MetricKind = "calculated" | "listed" | "registered" | "count";

export interface MetricDefinition {
  id: string;
  name: string;
  kind: MetricKind;
  definition: string;
  formula: string;
  source: string;
  filters: string;
  dateBasis: string;
  duplicates: string;
  limitations: string;
}

const LATEST_SNAPSHOTS =
  "Uses the current (non-superseded) extraction of each inventory document. When several inventory documents exist, each observation keeps its own snapshot; per-snapshot metrics never mix snapshots.";

const ONE_SNAPSHOT =
  "Computed for one inventory snapshot (the analysis scope shown on the page), so a unit listed in two documents is never counted twice.";
const ANALYSIS_SET =
  "Analysis set: one record per distinct unit (project + normalized unit number). Identical duplicate rows count once; units whose duplicate rows disagree are excluded and counted on Data Quality.";

export const METRICS: Record<string, MetricDefinition> = {
  accepted_records: {
    id: "accepted_records",
    name: "Accepted unit records",
    kind: "count",
    definition: "Unit rows extracted from the inventory document that passed validation (they have a unit number). Rejected and unplaced lines are counted separately.",
    formula: "COUNT(InventoryUnitObservation) in the scope snapshot",
    source: "Merge2-type inventory PDF rows",
    filters: `Scope snapshot plus any page filters. ${ONE_SNAPSHOT}`,
    dateBasis: "Snapshot date printed in the document (may be unknown)",
    duplicates: "Every accepted row is counted; duplicate unit numbers are reported as distinct units separately.",
    limitations: "This is what the supplied document lists and extraction could read — not the total real-world inventory of the projects, which no imported source states.",
  },
  listed_inventory_value: {
    id: "listed_inventory_value",
    name: "Listed inventory value",
    kind: "listed",
    definition: "Sum of listed (asking) prices of distinct units with a valid price in the scope snapshot.",
    formula: "SUM(listedPriceAED) over the analysis set WHERE listedPriceAED > 0",
    source: "InventoryUnitObservation.listedPriceAED",
    filters: "Scope snapshot plus any page filters",
    dateBasis: "Snapshot date (may be unknown)",
    duplicates: ANALYSIS_SET,
    limitations: "A snapshot-derived total of asking prices. It is NOT revenue, sales or transaction value, and includes every listed status (available and otherwise).",
  },
  review_required: {
    id: "review_required",
    name: "Records requiring review",
    kind: "count",
    definition: "Accepted records carrying at least one review-level validation warning: missing or unreadable price or size, unusual value, missing or unrecognized status, or no project.",
    formula: "COUNT(records WHERE validationWarnings ∩ review codes ≠ ∅)",
    source: "InventoryUnitObservation.validationWarnings",
    filters: "Scope snapshot",
    dateBasis: "Not time-based",
    duplicates: "Per record",
    limitations: "Informational notes (wrapped text, header carried from another page) do not count.",
  },
  distinct_projects: {
    id: "distinct_projects",
    name: "Projects represented",
    kind: "count",
    definition: "Distinct project records that have at least one accepted unit record in the scope snapshot.",
    formula: "COUNT(DISTINCT projectId) in the scope snapshot",
    source: "InventoryUnitObservation.projectId → Project",
    filters: "Scope snapshot",
    dateBasis: "Snapshot date",
    duplicates: "Project names are linked only on an exact normalized match; similar spellings remain separate until reviewed.",
    limitations: "Extraction artefacts can appear as project names (for example letter-spaced headings); these are flagged as possible aliases for review, not merged automatically.",
  },
  location_coverage: {
    id: "location_coverage",
    name: "Location coverage",
    kind: "count",
    definition: "Projects with a map position recorded by an analyst, split into verified and approximate positions.",
    formula: "COUNT(Project WHERE geo exists) by geo.precision",
    source: "Project.geo (manual entry with source and note)",
    filters: "None",
    dateBasis: "Time the position was recorded",
    duplicates: "One position per project; every change is kept in its location history.",
    limitations: "Positions are never geocoded automatically from project names.",
  },
  projects_identified: {
    id: "projects_identified",
    name: "Projects identified",
    kind: "count",
    definition: "Distinct project records created from names found in the supplied documents or DLD exports.",
    formula: "COUNT(Project)",
    source: "Project collection (created by Merge1/Merge2/DLD imports and user-confirmed aliases)",
    filters: "None",
    dateBasis: "Not time-based",
    duplicates: "Names are merged only on an exact normalized match (case, spaces and punctuation ignored). Near-matches are flagged for review, never merged automatically.",
    limitations: "Coverage is limited to projects named in the imported sources.",
  },
  inventory_observations: {
    id: "inventory_observations",
    name: "Inventory observations",
    kind: "count",
    definition: "Unit rows extracted and accepted from inventory documents.",
    formula: "COUNT(InventoryUnitObservation) in current snapshots",
    source: "InventoryUnitObservation",
    filters: "Current (non-superseded) snapshots",
    dateBasis: "Snapshot date of the source document (may be unknown)",
    duplicates: "Every accepted row is counted, including duplicate unit numbers (see Distinct units).",
    limitations: LATEST_SNAPSHOTS,
  },
  distinct_units: {
    id: "distinct_units",
    name: "Distinct units in snapshot",
    kind: "count",
    definition: "Distinct (project, unit number) pairs within one snapshot.",
    formula: "COUNT(DISTINCT projectId + normalized unitNumber) per snapshot",
    source: "InventoryUnitObservation",
    filters: "Rows with a unit number",
    dateBasis: "Snapshot date",
    duplicates: "Repeated unit numbers within a snapshot count once and are reported as data-quality issues.",
    limitations: "Rows without a unit number are excluded from this count.",
  },
  status_available: {
    id: "status_available",
    name: "Units recorded as available",
    kind: "listed",
    definition: "Accepted records whose status label in the document reads as available (Available, Open, For sale, …). Sold, reserved, unrecognized and missing labels are counted separately.",
    formula: "COUNT(records) WHERE statusNormalized = 'available'",
    source: "InventoryUnitObservation",
    filters: "Scope snapshot",
    dateBasis: "Snapshot date of the document — NOT today",
    duplicates: "Distinct units",
    limitations: "Only proves the document recorded that status on its own date. It does not prove current availability.",
  },
  listed_price_median: {
    id: "listed_price_median",
    name: "Median listed price",
    kind: "listed",
    definition: "Median of listed prices (AED) in the inventory document.",
    formula: "MEDIAN(listedPriceAED), linear interpolation (type 7)",
    source: "InventoryUnitObservation.listedPriceAED",
    filters: "Units with a price > 0; scope snapshot; optional page filters",
    dateBasis: "Snapshot date",
    duplicates: ANALYSIS_SET,
    limitations: "A listed price is an asking/list price, not a registered transaction price, and the sum of listed prices is not revenue.",
  },
  listed_psf_median: {
    id: "listed_psf_median",
    name: "Median listed price per sq ft",
    kind: "calculated",
    definition: "Median of (listed price ÷ unit size in sq ft) per row.",
    formula: "MEDIAN(listedPriceAED / areaSqFt) for units where price > 0 and area > 0",
    source: "InventoryUnitObservation",
    filters: "Units with price and positive area; scope snapshot",
    dateBasis: "Snapshot date",
    duplicates: ANALYSIS_SET,
    limitations: "Uses the size printed in the document (assumed sq ft as labelled). Not comparable to DLD price per sq ft, which is based on registered amounts and DLD-recorded sizes.",
  },
  registered_tx_count: {
    id: "registered_tx_count",
    name: "Registered transactions",
    kind: "registered",
    definition: "DLD-registered transactions in the imported CSV exports matching the filters.",
    formula: "COUNT(DISTINCT externalTransactionId)",
    source: "MarketTransaction (DLD Transactions CSV)",
    filters: "Transaction type, registration type, usage, date range as selected",
    dateBasis: "DLD Transaction Date (calendar date, stored date-only)",
    duplicates: "One record per DLD Transaction Number; re-imports never duplicate. Conflicting rows with the same number are kept as the first version and flagged.",
    limitations: "Limited to the date ranges and filters of the exports that were imported. Registrations are not bookings, and DLD exports may not show cancellations.",
  },
  registered_tx_value: {
    id: "registered_tx_value",
    name: "Registered transaction value",
    kind: "registered",
    definition: "Sum of DLD 'Amount' for the selected registered transactions.",
    formula: "SUM(transactionValueAED)",
    source: "MarketTransaction",
    filters: "As above",
    dateBasis: "DLD Transaction Date",
    duplicates: "As above",
    limitations: "Market transaction value is not Danube revenue. Mortgage and gift amounts are not sale prices — filter to Sales for price analysis.",
  },
  registered_psf_median: {
    id: "registered_psf_median",
    name: "Median registered price per sq ft",
    kind: "calculated",
    definition: "Median of (Amount ÷ property size in sq ft) for registered transactions.",
    formula: "MEDIAN(transactionValueAED / (propertySizeSqm × 10.7639104))",
    source: "MarketTransaction",
    filters: "Rows with positive property size; defaults to Sales",
    dateBasis: "DLD Transaction Date",
    duplicates: "One per Transaction Number",
    limitations: "Size conversion: 1 m² = 10.7639104 sq ft. Land and building transactions distort per-sq-ft values; filter to Units for apartment comparisons.",
  },
  developer_share: {
    id: "developer_share",
    name: "Developer share of registered value",
    kind: "calculated",
    definition: "Share of registered transaction value attributed to a developer, within identical filters.",
    formula: "SUM(value WHERE developer = X) ÷ SUM(value of all transactions in filter); attribution coverage = SUM(value WHERE developer known) ÷ SUM(all value)",
    source: "MarketTransaction joined to DLD Project register by exact project name",
    filters: "Same transaction type, registration type, usage, date range for numerator and denominator",
    dateBasis: "DLD Transaction Date",
    duplicates: "One per Transaction Number",
    limitations: "Unattributed transactions stay in the denominator and are shown separately; shares are flagged as unreliable when attribution coverage is below 80%.",
  },
};

/** Metrics that cannot be calculated from public research data, and what would be needed. */
export const UNAVAILABLE_METRICS: Array<{ name: string; requires: string }> = [
  { name: "Internal bookings", requires: "Authorized export from Danube's sales/booking system" },
  { name: "Internal cancellations", requires: "Authorized booking and cancellation records" },
  { name: "Realized revenue", requires: "Audited or authorized financial statements" },
  { name: "Company profitability", requires: "Authorized financial statements" },
  { name: "Lead volumes and conversion rates", requires: "Authorized CRM data" },
  { name: "Campaign spend and ROI", requires: "Authorized marketing spend and attribution data" },
  { name: "Sales-team performance", requires: "Authorized sales-team records" },
  { name: "Customer-level analytics", requires: "Authorized, lawfully processed customer data" },
];
