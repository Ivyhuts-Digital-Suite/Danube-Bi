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

## 8. Sources, formulas, provenance and limitations

Full definitions are on the in-app **Methodology** page and next to every KPI (**Definition**).
Summary:

| Metric | Formula | Notes |
|---|---|---|
| Inventory rows | count of accepted unit rows in current snapshots | includes duplicate unit rows |
| Distinct units | distinct (snapshot, project, normalized unit number) | duplicates flagged |
| Units recorded as available | distinct units with status *available* | as of the document's date, **not** current availability |
| Median listed price | exact median of `listedPriceAED` | a listed price is not a transaction price; sums of listed prices are not revenue |
| Median listed AED/sq ft | median of `listedPriceAED / areaSqFt` per row | rows need a price and a positive size |
| Registered transactions / value | count / sum of `Amount`, one per DLD Transaction Number | only the exports you imported; not Danube revenue; mortgages/gifts are not sale prices |
| Median registered AED/sq ft | median of `Amount / (Property Size m² × 10.7639104)` | rows with size > 0 |
| Developer share | developer value ÷ **all** value in the same filters | developer via exact match to the DLD project register; unattributed value stays in the denominator; flagged unreliable below 80% coverage |

Provenance: every inventory row stores its document (SHA-256), page, line and original strings;
every brochure claim stores document, page, extracted text, attribution method and confidence;
every transaction stores its DLD record and source file; every announcement stores URL, publisher,
publication date and retrieval time.

Reconciliation: project names merge only on an exact normalized key (case/spaces/punctuation
ignored). Near-matches are flagged as *possible aliases*; DLD names containing a known project name
are flagged as *unmatched project candidates*. A person adds an alias or merges projects on the
project page, with a required evidence note.

Known limitations:

- The real `Merge1.pdf` and `Merge2.pdf` have not been seen yet; extraction is verified only on
  synthetic test PDFs. Review the first real import run carefully.
- Brochure fact extraction is heuristic (regular expressions) and can miss or mis-read claims.
- No OCR for scanned pages.
- Dubai Pulse (historical DLD datasets) was unreachable from this environment (connection refused).
- Unavailable without authorized internal data: bookings, cancellations, realized revenue,
  profitability, leads/conversion, campaign spend/ROI, sales-team and customer analytics.
- The AI analyst (phase 8) is not implemented.

## 9. Tests and checks

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

## 10. Security and privacy

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
- Source files stay local. Nothing is sent to external services; no AI provider is called.
- `.env*` (except `.env.example`) and everything in `data/` (except its README) are git-ignored.

## 11. Project layout

```
src/app/                 pages (Command Center, projects, inventory, pricing, market,
                         timeline, sources, quality, methodology, search), server actions,
                         /api/health
src/components/          UI primitives, charts, tables, forms
src/lib/                 pure helpers: env, normalization, statistics, metric/source definitions
src/server/models.ts     Mongoose schemas and indexes
src/server/ingest/       PDF and CSV extraction, import runs, document registry
src/server/queries/      read-side queries used by pages
src/server/quality.ts    data-quality checks
scripts/ingest.ts        CLI
tests/                   unit and integration tests, synthetic fixtures
docs/STATUS.md           current status report
```
