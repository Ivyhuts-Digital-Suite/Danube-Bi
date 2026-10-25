# Project status — 2026-10-25 (UI/UX redesign)

## Redesign summary

The whole interface was rebuilt as a dark navy analyst workspace (with a light theme), on the
existing Next.js/MongoDB stack. Ingestion, provenance, validation and security behaviour were not
changed; the only schema change is additive (`Project.geo` and `Project.geoHistory`).

- New shared design system: tokens in `globals.css`, `components/ui.tsx` (panels, KPI cards with
  definitions, badges, notices, empty/unavailable states, pagination), `components/viz.tsx`
  (server-rendered ranked bars, stacked bars, interquartile ranges, meters), `components/charts.tsx`
  (Recharts histogram, scatter, time bars following the theme), grouped sidebar, typeahead search
  (`/api/search`), theme toggle. Chart palette validated with the dataviz checker on both themes.
- Centralised, unit-tested analytics (`lib/inventory-analytics.ts`) with an explicit one-snapshot
  analysis scope (`server/queries/analytics.ts`), deduplication (identical duplicates collapsed,
  conflicting units excluded and counted), validity rules and deterministic insights.
- Pages rebuilt: Command Center, Projects (+ detail), Inventory Explorer (synchronised charts and
  table, quick filters, column picker, detail drawer, CSV export), Pricing Intelligence, new
  Geographic Intelligence (Leaflet/OSM + manual location-verification workflow with history),
  Market Intelligence, Public Announcements, Sources & Imports (DLD CSV preview), Data Quality
  (review queues), new Ingestion History, Methodology & Definitions, new System Health.

## Live data (Atlas `danube`, queried 2026-10-25)

1,061 accepted Merge2 unit records (1,027 distinct unit numbers) and 226 rejected/unplaced lines
(93 no unit number and no price, 12 no unit number, 121 unplaced); snapshot date not printed.
Status labels: 997 available, 0 sold, 0 reserved, 44 unrecognized, 20 none. Listed inventory value
AED 3.44B over 997 distinct priced units; median listed price AED 3.4M; median 2,473 AED/sq ft.
16 project records with inventory (26 in total). 64 records need review. No coordinates, DLD
transactions or announcements exist in the database.

## Verification (redesign)

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass, 0 warnings |
| `npm test` — 9 files, 120 tests (21 new: analytics, dedup, quartiles, bands, outliers, insights, coordinates, CSV, scope/filters against MongoDB) | 120 passed |
| `npm run build` | pass, 23 routes (first attempt hit a Google Fonts network timeout; re-run passed) |
| Production server, headless Chrome via CDP: 20 routes at 1440 px dark, 4 at 390 px, 2 in light theme | all rendered, no console errors, no horizontal overflow; 404 returns 404 |
| CSV export with `flag=missing_price` | 64 rows, matches the Command Center and Data Quality counts |

Not exercised end-to-end: saving a map position through the UI (it would write to the real
database); the validation it relies on is unit-tested.

# Earlier status — 2026-10-25 (initial build)

## Starting point

The repository was **empty** when this work began (no code from earlier phases existed), so the
application was built in this session within the agreed scope and then audited and verified.
`Merge1.pdf` and `Merge2.pdf` were **not present** (`data/incoming/` did not exist).

## Implemented

- Next.js 16 App Router app (TypeScript, Tailwind 4, Cache Components) with persistent sidebar,
  global search, and pages: Command Center, Project Portfolio (+ project detail), Inventory
  Explorer (+ unit detail, snapshot comparison), Pricing Intelligence, Market Intelligence,
  Announcements & Strategy Timeline, Sources & Imports (+ run detail), Data Quality, Methodology,
  Search, `/api/health`.
- MongoDB/Mongoose models with indexes: SourceDocument, DataSource, Project, ProjectFactObservation,
  BrochurePage, InventorySnapshot, InventoryUnitObservation, RejectedRecord, MarketTransaction,
  DldProjectObservation, PublicEvent, IngestionRun, DataQualityIssue.
- Ingestion (CLI `npm run ingest` and UI server actions sharing one service):
  - Inventory PDF: header-driven table extraction with page/line provenance, original values,
    rejected/unplaced rows stored, printed snapshot-date detection (never the import date),
    SHA-256 idempotency, new snapshot per changed file, superseded extraction versions kept.
  - Brochure PDF: per-page text, project attribution (single / dominant / carried-forward /
    ambiguous / none), marketing-claim facts with page and source text.
  - DLD CSV (Transactions and Projects exports): header detection, per-row rejection, streaming
    parse, conflict detection without overwrite, developer attribution by exact register match,
    re-linking after aliases or new registers.
  - Run lifecycle: per-source locks, heartbeats, stale runs marked *interrupted*, truthful final
    status and counts, failed attempts recorded even for missing/empty files.
- Data-quality checks: duplicate/conflicting units, missing-field rates, unknown snapshot dates,
  possible project aliases, unmatched DLD project candidates, conflicting transactions, ambiguous
  developers, replaced files.
- Human review: add alias (with evidence), merge projects (with evidence), mark issues reviewed,
  retract announcements (kept for history).
- Manual announcement entry (Danube site prohibits automated access).
- Metric definitions shown beside every KPI and chart; chart frames carry title, period, source,
  definition and a data table; unavailable metrics listed explicitly.

## Not implemented (by decision or scope)

- AI analyst (phase 8).
- OCR for scanned PDF pages.
- Authentication/authorization — local single-user tool bound to 127.0.0.1.
- Automated fetching of danubeproperties.com (prohibited by its Terms §5) or DLD (CAPTCHA).
- Dubai Pulse connector (host refused connections from this environment).

## Verification performed (all actually run)

| Check | Result |
|---|---|
| `npm run typecheck` (next typegen + tsc) | pass |
| `npm run lint` | pass, 0 warnings |
| `npm test` — 7 files, 99 tests (unit + integration against a throwaway mongod 8.0.11) | 99 passed, 0 skipped |
| `npm run build` | pass; 18 routes, partial prerender |
| Production server smoke test, empty DB | all 13 routes HTTP 200, unknown route 404, health 200 |
| UI PDF import via server action (synthetic test PDFs, separate DB) | 60/60 rows, 6 brochure claims, status completed |
| CLI DLD transactions import + UI CSV upload (synthetic) | 40/40 and 2/2, upload stored with timestamped name |
| Displayed values vs hand calculation | rows 60, available 46, sold 14, tx 40, value AED 48.2M, Danube share 49.8%, coverage 100%, April filter 7, median 1,215,000 — all matched |
| Alias review workflow via UI | linked transactions 0 → 20 |
| Forged cross-origin server-action POSTs | rejected (HTTP 500), no data changed |
| Binary file uploaded as .csv | rejected with message, nothing written |
| MongoDB unreachable / invalid `MONGODB_URI` | every page shows unavailable state; health 503; credential never in output or logs |
| Visual check (headless Edge screenshots, dark mode) | Command Center, Market, Inventory rendered correctly; one axis-label wrap fixed |
| `git check-ignore` | `.env.local`, `data/*`, `.next` ignored; `.env.example`, `data/README.md` tracked |

## Known limitations found in the audit

- PDF extraction is verified only on synthetic PDFs; real document layouts may need parser tuning.
- `notFound()` inside a streamed section returns HTTP 200 with the not-found content (Partial
  Prerender behaviour); the page content is correct.
- Charts render client-side; until hydration the chart area is empty (data tables are server-rendered).
- Project merge is not transactional on a standalone mongod; steps are ordered to be re-runnable,
  but an interruption between deleting the source project and copying its match keys would require
  re-adding those aliases manually.
- Interrupted runs were tested by simulating a missed heartbeat, not by killing a live import.
- Light colour scheme was not screenshotted (tokens are defined; dark mode was checked).
- Uploads above 200 MB were not tested.

## Blockers and actions required from you

1. Put the real files at `data/incoming/Merge1.pdf` and `data/incoming/Merge2.pdf`.
2. Start MongoDB: `net start MongoDB` in an administrator terminal (service is installed but stopped).
3. Run `npm run ingest -- pdf` (or use Sources & Imports) and review the run pages and Data Quality.
   If Merge2's header is not recognized, the run fails with that message — share a page and the
   parser vocabulary can be extended.
4. Optional: download DLD Projects and Transactions CSV exports manually and import them.
5. Optional: record public announcements from Danube's news page on the Announcements page.
