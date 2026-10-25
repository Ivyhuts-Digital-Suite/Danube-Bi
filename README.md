# Danube Business Intelligence & Command Center

An independent research application for studying Danube Properties and the Dubai residential
market. Everything shown is computed from records you import: the supplied PDFs
(`Merge1.pdf`, `Merge2.pdf`), official Dubai Land Department (DLD) CSV exports, and public
announcements you record with their URL. It has **no access to Danube's internal systems** and
never produces estimated or illustrative figures.

Stack: Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind CSS 4 ·
MongoDB + Mongoose · Zod · Recharts · TanStack Table · pdf.js · Vitest.

> **Local, single-user tool.** There is no login. The dev and production servers bind to
> `127.0.0.1` only. Do not expose it on a network or the internet without adding authentication
> (see [Security](#security-and-privacy)).

---

## 1. Requirements

- Node.js ≥ 22 (tested on 25.9) and npm
- MongoDB ≥ 7 running locally (tested with MongoDB 8.0.11)

## 2. Install and configure

```bash
npm install
cp .env.example .env.local      # then edit if your MongoDB is not on 127.0.0.1:27017
```

`.env.local` settings:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGODB_URI` | yes | — | e.g. `mongodb://127.0.0.1:27017/danube_bi` |
| `DATA_DIR` | no | `./data` | PDFs in `<DATA_DIR>/incoming`, DLD CSVs in `<DATA_DIR>/incoming/dld` |
| `MAX_UPLOAD_MB` | no | `200` | Max DLD CSV upload through the UI (also raise `serverActions.bodySizeLimit` in `next.config.ts` if you go above 200) |

## 3. MongoDB setup and health

On this Windows machine MongoDB is installed as the service **`MongoDB`** (start type Automatic).
It was **stopped** when this project was built. Start it from an **administrator** terminal:

```powershell
net start MongoDB
```

Alternatively run a user-level instance without admin rights:

```powershell
mkdir .mongo-data
mongod --dbpath .mongo-data --port 27017 --bind_ip 127.0.0.1
```

Check health:

- **System Health** page (`/system`) shows reachability, latency, collection counts and indexes.
- `GET http://127.0.0.1:3000/api/health` → `{"ok":true,"database":"reachable"}` (HTTP 503 when unreachable)
- Every page shows a red **Database unavailable** banner when MongoDB cannot be reached; no
  page invents data in that state.

Indexes are created automatically on the first import (`syncIndexes`).

## 4. Run

```bash
npm run dev          # development, http://127.0.0.1:3000
npm run build        # production build
npm start            # production server, http://127.0.0.1:3000
```

## 5. Import the supplied PDFs

1. Copy the files to exactly:
   - `data/incoming/Merge1.pdf` — project brochures
   - `data/incoming/Merge2.pdf` — unit inventory and listed prices
2. Import, either:
   - UI: **Sources & Imports → Import Merge1.pdf and Merge2.pdf**, or
   - CLI: `npm run ingest -- pdf`
3. Review the result on **Sources & Imports → Recent import runs** (click a run for errors,
   warnings and every rejected row) and on **Data Quality**.

Other commands: `npm run ingest -- inventory <file.pdf>`, `npm run ingest -- brochure <file.pdf>`,
`npm run ingest -- status`.

What the PDF importers do:

- **Inventory (Merge2)**: finds the table by its header row (S.No, Project, Unit No, Unit Type,
  Typology, Size (Sq.Ft), View, Price (AED), Status and common variants), reads every page,
  carries the header across continuation pages, joins wrapped text, uses a section heading as the
  project when there is no project column, and converts sq m columns explicitly. Each row keeps its
  page number and the original strings. Rows without a unit number are rejected and stored, not
  dropped. Lines with numbers that do not fit the table are stored as "unplaced".
- **Snapshot date**: taken only from a date printed in the document ("as of", "updated on", …).
  If none is found it stays **unknown** and is flagged. The file or import date is never used.
- **Brochures (Merge1)**: stores the text of every page, links pages to projects by name (single
  name, a dominant name, or carried forward from the previous page for up to 12 pages; pages naming
  several projects are left ambiguous), and extracts configurations, amenities, locations, payment
  plans, handover dates and price claims as **marketing claims** with page references.
- **No OCR.** Pages without a text layer are reported per page. A fully scanned PDF fails with that
  explanation.
- **Re-runs are safe.** Files are identified by SHA-256: an identical file is skipped; a changed file
  becomes a new document and snapshot while the earlier one is preserved; a failed or interrupted run
  can simply be re-run without duplicating records.

## 6. Download and import DLD CSV exports

The DLD Real Estate Data page protects downloads with a CAPTCHA, so **you** download the files.
This app never automates that step.

1. Open <https://dubailand.gov.ae/en/open-data/real-estate-data/>.
2. **Projects** tab → search → **Download as CSV**. This export carries `Developer Name` and is
   needed to attribute transactions to developers.
3. **Transactions** tab → choose a date range (and e.g. Transaction Type *Sales*, Usage
   *Residential*) → **Download as CSV**. Repeat for further ranges; overlapping files are fine.
4. Put the files in `data/incoming/dld/` and click **Sources & Imports → Import all CSVs in
   data/incoming/dld** (or `npm run ingest -- dld`), or upload a single file on the same page.

Terms: the DLD website's terms permit viewing and downloading materials for **personal,
non-commercial use**. Obtain written permission from DLD before any commercial use or
republication.

Import behaviour: the export type is detected from its header. Transactions are unique by DLD
`Transaction Number`; re-imports skip identical rows; a later row with the same number but different
values does **not** overwrite the stored one and is flagged as a conflict. Malformed CSV lines,
wrong column counts, unparseable dates or amounts are rejected individually and listed on the run
page.

## 7. Public announcements

Danube's website Terms & Conditions (Section 5) prohibit accessing the site "through automated or
non-human means", so there is **no scraper**. Record announcements on **Announcements** with the
title, URL, publisher, publication date, a summary in your own words, and a claim classification.
Events can be retracted (kept for history), not deleted.

## 8. Application guide

The interface is a dark navy analyst workspace (a light theme is one click away in the header; the
choice is remembered per browser). The sidebar is grouped into Overview, Portfolio, Market, Data
management and System. The header search (`Ctrl K` or `/`) suggests projects (names and aliases)
and unit numbers as you type; Enter opens full results including brochure text and announcements.

| Page | What it answers |
|---|---|
| **Command Center** (`/`) | Accepted unit records vs. rejected lines, status labels, listed inventory value, median price and AED/sq ft, projects represented, records needing review; deterministic key findings (each with sample, caveat and a link to its records); an "investigate next" data-quality list; composition, price, size and typology charts; source freshness |
| **Projects** (`/projects`) | Searchable cards or table, sortable by records, median price, listed value or name; attribution confidence, alias flags, coverage and sources per project |
| **Project detail** (`/projects/[id]`) | Status and typology mix, price distribution, AED/sq ft by typology, paginated unit table, brochure claims with page excerpts and differing-value warnings, DLD register, announcements, snapshot timeline and import runs, map position with location history, alias/merge review |
| **Inventory Explorer** (`/inventory`) | Search, grouped filters, quick filters (available, sold, review required, missing price/size) and removable chips; status, price, size and project charts that use the *same* filter as the table; sortable table with configurable columns, warning explanations, source page and snapshot date, and a side panel with the original extracted text; CSV export of the current filter |
| **Pricing Intelligence** (`/pricing`) | Median/mean price and AED/sq ft, quartiles, coverage; distributions; price vs size scatter; interquartile ranges by project, typology and size band; unit-type table; Tukey outlier review; dated-snapshot comparison only when two or more dated snapshots exist |
| **Geographic Intelligence** (`/geography`) | Leaflet + OpenStreetMap map synced with a project list, marker area proportional to records, verified vs approximate positions, fit-to-visible, coverage counts, and the projects that still need a position |
| **Market Intelligence** (`/market`) | DLD registered transactions only (volume and value by month, property types, developer share with attribution coverage, linked projects). Without DLD exports it explains how to import them instead of showing charts |
| **Public Announcements** (`/timeline`) | Manually recorded public events with claim classification and retraction history |
| **Sources & Imports** (`/sources`) | PDF import, DLD CSV upload with in-browser preview (detected export type, first rows checked with the importer's own rules), document cards with SHA-256 and outcomes, recent runs, retry guidance, source registry |
| **Data Quality** (`/quality`) | Review queues: records needing review (by check, linked to the explorer), rejected and unplaced PDF lines with original text, possible aliases (mark reviewed with a note), snapshot dates, DLD matching, extraction failures, and all issues with recorded review decisions |
| **Ingestion History** (`/sources/runs`) | Every import attempt, filterable by status and source, with run detail pages |
| **Methodology & Definitions** (`/methodology`) | Counting rules, every metric definition, the validation-check glossary, insight/outlier rules, location rules, evidence classes |
| **System Health** (`/system`) | Database reachability and latency, collection counts and index status, data folders, running imports, local-only posture |

### Recording project locations

The supplied PDFs contain no coordinates, so the map starts empty — projects are never placed at a
default point or geocoded silently. On a project page (section **Location**) click the map or type
decimal coordinates, choose **verified** (building-level, checked in an authoritative source) or
**approximate** (community-level), and record the source (and URL if any). Coordinates outside the
UAE, or with latitude and longitude swapped, are rejected. Every set/remove is kept in the
project's location history. Map tiles are loaded by your browser from `tile.openstreetmap.org`
(© OpenStreetMap contributors; attribution stays visible); no paid map API is used.

## 9. Formulas, counting rules, provenance and limitations

Full definitions are on the in-app **Methodology & Definitions** page and behind the ⓘ next to
every KPI. All inventory analytics are computed in one tested module
(`src/lib/inventory-analytics.ts`) from rows loaded by `src/server/queries/analytics.ts`.

- **Analysis scope = one snapshot.** Every inventory figure describes one inventory document,
  shown in the scope bar on each page: by default the snapshot with the latest *printed* date, or,
  if none is dated, the most recently imported one (its import time is never shown as a snapshot
  date). A unit listed in two documents is therefore never double-counted.
- **Unit records** = accepted rows; status and composition counts are per record and equal the
  Inventory Explorer row counts for the same filter.
- **Analysis set** (prices, sizes, AED/sq ft, listed value) = one record per distinct unit
  (project + normalized unit number). Identical duplicates count once; units whose duplicate rows
  disagree are excluded and counted. Exclusions are shown next to the KPIs.
- A price or size is valid only if it is a finite number greater than 0; AED/sq ft needs both.
  Nothing is imputed.

| Metric | Formula | Notes |
|---|---|---|
| Accepted unit records | count of accepted rows in the scope snapshot | not the real-world total inventory, which no source states |
| Recorded as available / sold | records whose status label reads available / sold | as printed on the document's own date — **not** live availability |
| Listed inventory value | sum of valid listed prices over the analysis set | asking prices; **not** revenue, sales or transaction value |
| Median listed price / AED per sq ft | exact median (Excel PERCENTILE.INC interpolation) over the analysis set | listed, not transacted |
| Records requiring review | records with a review-level validation warning | missing/unreadable price or size, unusual values, missing/unrecognized status, no project |
| Outliers | AED/sq ft outside Q1 − 1.5·IQR … Q3 + 1.5·IQR (at least 8 units) | values to check, not errors |
| Registered transactions / value | count / sum of `Amount`, one per DLD Transaction Number | only imported exports; not Danube revenue |
| Median registered AED/sq ft | median of `Amount / (Property Size m² × 10.7639104)` | rows with size > 0 |
| Developer share | developer value ÷ **all** value in the same filters | via the DLD project register; flagged unreliable below 80% attribution coverage |

Provenance: every inventory row stores its document (SHA-256), page, line and original strings;
every rejected or unplaced line is stored with its reason and original text; every brochure claim
stores document, page, extracted text, attribution method and confidence; every transaction
stores its DLD record and source file; every announcement stores URL, publisher, publication date
and retrieval time; every location stores its source, precision and history.

Reconciliation: project names merge only on an exact normalized key. Near-matches are flagged as
*possible aliases* (Data Quality → Possible aliases); a person merges projects or adds aliases on
the project page with a required evidence note, or marks the pair reviewed.

Known limitations (as of 2026-10-25, with the real Merge1.pdf and Merge2.pdf imported):

- **Snapshot date unknown**: Merge2.pdf prints no "as of" date, so statuses and prices cannot be
  placed in time, and snapshot comparison stays unavailable until a second, dated document exists.
- **Extraction gaps**: 48 Merge2 pages and 28 Merge1 pages have no text layer (no OCR), so their
  units and claims are missing; 226 Merge2 lines were rejected or unplaced (kept for review).
- **Extraction artefacts**: letter-spaced headings were read as project names (e.g. "D A N U B E")
  and some page text as status labels. They are flagged (possible aliases, unrecognized status)
  rather than corrected automatically.
- **No sold labels**: the inventory document records no unit as sold, so sold counts are zero.
- **No map positions**: no source contains coordinates; positions must be recorded by an analyst.
- **No DLD data or announcements imported yet**: Market Intelligence shows its import guide.
- Brochure fact extraction is heuristic and can miss or mis-read claims.
- Dubai Pulse was unreachable from this environment.
- Unavailable without authorized internal data: bookings, cancellations, realized revenue,
  profitability, leads/conversion, campaign spend/ROI, sales-team and customer analytics.
- The production build downloads the Geist and Source Serif 4 fonts from Google Fonts; a build
  without internet access fails at that step (a transient timeout is fixed by re-running).

## 10. Tests and checks

```bash
npm run typecheck          # next typegen + tsc
npm run lint
npm test                   # unit + integration
npm run check              # all of the above + production build
```

Integration tests need MongoDB. They use `MONGODB_TEST_URI` if set, otherwise start a throwaway
`mongod` from your PATH (or `MONGOD_PATH`) on a random port with a temporary data directory, and
drop their databases afterwards. If neither is possible they are **skipped with a printed reason**.
They never touch your real database or `data/` folder. Test fixtures are synthetic.

## 11. Security and privacy

- No authentication: intended for local, single-user use; servers bind to `127.0.0.1`.
- Mutations are Next.js Server Actions, which reject requests whose `Origin` differs from the host
  (verified: a forged cross-site POST returned 500 and changed nothing).
- Inputs are validated with Zod; user search text is regex-escaped; sort fields are whitelisted;
  page sizes are capped.
- Uploads: `.csv` only, size-limited, binary content rejected, stored under a sanitized
  timestamped name with no-overwrite semantics.
- File imports from the UI can only reference files listed inside `data/incoming` (no path
  traversal).
- Error messages shown in the UI never include the MongoDB URI or stack traces.
- Source files stay local and are never served to the browser. Nothing is sent to external
  services; no AI provider is called. The only third-party request is the browser loading
  OpenStreetMap tiles on map views.
- CSV exports neutralise spreadsheet formulas (cells starting with `=`, `+`, `-`, `@`).
- `.env*` (except `.env.example`) and everything in `data/` (except its README) are git-ignored.

## 12. Project layout

```
src/app/                 pages (Command Center, projects, inventory, pricing, geography,
                         market, timeline, sources, runs, quality, methodology, system,
                         search), server actions, /api/health, /api/search,
                         /api/export/inventory
src/components/          design system (ui.tsx), server-rendered charts (viz.tsx), Recharts
                         charts (charts.tsx), Leaflet map, tables, filters, forms, app shell
src/lib/                 pure helpers: inventory analytics, statistics, normalization, geo
                         and CSV helpers, metric/source definitions
src/server/models.ts     Mongoose schemas and indexes
src/server/ingest/       PDF and CSV extraction, import runs, document registry
src/server/queries/      read-side queries: analysis scope, portfolio, quality queues, market
src/server/quality.ts    data-quality checks
scripts/ingest.ts        CLI
tests/                   unit and integration tests, synthetic fixtures
docs/STATUS.md           current status report
```
