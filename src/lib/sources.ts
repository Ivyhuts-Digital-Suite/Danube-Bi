// Registry of the real sources this application knows how to use. These are definitions of
// *where data can come from and how*, not data. Freshness/status fields are filled by imports.

export interface SourceDefinition {
  key: string;
  name: string;
  sourceType: string;
  publisher: string;
  url?: string;
  accessMethod: string;
  refreshFrequency: string;
  /** Initial status before any import; "blocked"/"manual_only" reflect verified access constraints. */
  initialStatus: "not_yet_imported" | "manual_only" | "blocked";
  usageNotes: string;
}

export const SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    key: "merge1_pdf",
    name: "Merge1.pdf — Danube project brochures",
    sourceType: "local_document",
    publisher: "Danube Properties (marketing material, supplied by user)",
    accessMethod: "Local file in data/incoming/Merge1.pdf, imported with `npm run ingest -- pdf` or the Sources page",
    refreshFrequency: "When a new version of the file is supplied",
    initialStatus: "not_yet_imported",
    usageNotes:
      "Brochure statements are developer marketing claims. They are stored with page references and are not treated as independently verified facts.",
  },
  {
    key: "merge2_pdf",
    name: "Merge2.pdf — unit inventory and listed prices",
    sourceType: "local_document",
    publisher: "Supplied by user (origin and snapshot date to be confirmed from the document)",
    accessMethod: "Local file in data/incoming/Merge2.pdf, imported with `npm run ingest -- pdf` or the Sources page",
    refreshFrequency: "When a new inventory document is supplied",
    initialStatus: "not_yet_imported",
    usageNotes:
      "Statuses and prices are as recorded in the document at its own date. 'Available' does not prove current availability; listed prices are not transaction prices.",
  },
  {
    key: "dld_transactions_csv",
    name: "DLD Real Estate Data — Transactions (CSV export)",
    sourceType: "official_open_data",
    publisher: "Dubai Land Department",
    url: "https://dubailand.gov.ae/en/open-data/real-estate-data/",
    accessMethod:
      "Manual download: the DLD form requires a CAPTCHA, so files are downloaded by a person and imported from data/incoming/dld/ or by upload. No automated access is attempted.",
    refreshFrequency: "Manual; DLD publishes registrations continuously",
    initialStatus: "manual_only",
    usageNotes:
      "DLD site terms permit viewing/downloading for personal, non-commercial use. Transactions carry a Project name but no developer; developer attribution requires the DLD Project export.",
  },
  {
    key: "dld_projects_csv",
    name: "DLD Real Estate Data — Projects (CSV export)",
    sourceType: "official_open_data",
    publisher: "Dubai Land Department",
    url: "https://dubailand.gov.ae/en/open-data/real-estate-data/",
    accessMethod: "Manual download (CAPTCHA-protected form), then import from data/incoming/dld/ or by upload.",
    refreshFrequency: "Manual",
    initialStatus: "manual_only",
    usageNotes:
      "Provides Developer Name, Project Status, Completed (%) and dates per registered project. Used for developer attribution of transactions by exact project-name match.",
  },
  {
    key: "danube_official_news",
    name: "Danube Properties — official news page",
    sourceType: "official_company_website",
    publisher: "Danube Properties",
    url: "https://danubeproperties.com/news/",
    accessMethod:
      "Manual entry only. The site's Terms & Conditions (Section 5) prohibit access 'through automated or non-human means', so this app does not fetch it. A person reads the page and records title, date, URL and an own-words summary.",
    refreshFrequency: "Manual",
    initialStatus: "manual_only",
    usageNotes: "Company announcements are the company's own claims (claim type 'official_public' or 'marketing_claim'), not independent verification.",
  },
  {
    key: "public_press",
    name: "Reputable public reporting / press releases",
    sourceType: "public_press",
    publisher: "Various (recorded per event)",
    accessMethod: "Manual entry with URL and publication date.",
    refreshFrequency: "Manual",
    initialStatus: "manual_only",
    usageNotes: "Syndicated press releases repeat company claims; record them as 'reported_public' only when a third party reports independently.",
  },
  {
    key: "dubai_pulse",
    name: "Dubai Pulse — DLD historical datasets",
    sourceType: "official_open_data",
    publisher: "Digital Dubai",
    url: "https://www.dubaipulse.gov.ae/organisation/dld",
    accessMethod: "Not available: connection refused from this environment on 2026-10-25; access reportedly requires registration/API credentials.",
    refreshFrequency: "—",
    initialStatus: "blocked",
    usageNotes: "Not connected. If access is granted, exported CSVs with the DLD transaction columns can be imported through the DLD Transactions importer.",
  },
];

export function getSourceDefinition(key: string): SourceDefinition | undefined {
  return SOURCE_DEFINITIONS.find((s) => s.key === key);
}
