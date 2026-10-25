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

export const METRICS: Record<string, MetricDefinition> = {
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
    definition: "Distinct units whose status in the document is 'available'.",
    formula: "COUNT(DISTINCT unit) WHERE statusNormalized = 'available'",
    source: "InventoryUnitObservation",
    filters: "Current snapshots",
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
    filters: "Rows with a valid price; current snapshots; optional project/typology/status filters",
    dateBasis: "Snapshot date",
    duplicates: "Each accepted row counted once; duplicated unit rows are flagged separately.",
    limitations: "A listed price is an asking/list price, not a registered transaction price, and the sum of listed prices is not revenue.",
  },
  listed_psf_median: {
    id: "listed_psf_median",
    name: "Median listed price per sq ft",
    kind: "calculated",
    definition: "Median of (listed price ÷ unit size in sq ft) per row.",
    formula: "MEDIAN(listedPriceAED / areaSqFt) for rows where both are present and area > 0",
    source: "InventoryUnitObservation",
    filters: "Rows with price and positive area",
    dateBasis: "Snapshot date",
    duplicates: "Per accepted row",
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
