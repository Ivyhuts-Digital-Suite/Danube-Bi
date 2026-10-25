// Pure, layout-based table extraction for inventory PDFs. The real Merge2.pdf layout has not been
// seen yet, so the parser recognizes tables by their header row instead of hard-coding positions,
// and reports every line it could not place.
import { cleanText, parseDateOnly } from "@/lib/normalize";
import type { PdfPageText, PdfTextItem } from "./pdf-text";

export const INVENTORY_FIELDS = [
  "serialNumber",
  "project",
  "unitNumber",
  "unitType",
  "typology",
  "areaSqFt",
  "view",
  "listedPriceAED",
  "status",
] as const;
export type InventoryField = (typeof INVENTORY_FIELDS)[number];

// Order matters: the first pattern that matches a header cell wins.
const HEADER_PATTERNS: Array<[InventoryField, RegExp]> = [
  ["serialNumber", /^(s\.?\s*no\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|serial(\s*(no\.?|number))?|#|no\.?)$/i],
  ["unitType", /^(unit\s*type|property\s*type|type)$/i],
  ["unitNumber", /^(unit(\s*(no\.?|number|#|ref\.?))?|apt\.?\s*(no\.?)?|apartment\s*(no\.?)?|flat\s*(no\.?)?)$/i],
  ["project", /^(project(\s*name)?|building(\s*name)?|tower|development)$/i],
  ["typology", /^(typology|bed(room)?s?|configuration|layout|bhk|unit\s*typology)$/i],
  ["areaSqFt", /^((total|unit|saleable|net|gross)?\s*(size|area)|bua|sq\.?\s*ft\.?|sqft)(\s*\(?\s*(sq\.?\s*ft\.?|sqft|sq\.?\s*m\.?|sqm|m2|ft2)\s*\)?)?$/i],
  ["view", /^(view|views|facing|orientation)$/i],
  ["listedPriceAED", /^((selling|sale|list|listed|total|unit)\s*)?(price|value|amount)(\s*\(?\s*(aed|dhs?)\s*\)?)?$|^aed$/i],
  ["status", /^((unit\s*)?status|availability)$/i],
];

export function classifyHeaderCell(text: string): InventoryField | null {
  const t = cleanText(text).replace(/[:]/g, "");
  for (const [field, re] of HEADER_PATTERNS) if (re.test(t)) return field;
  return null;
}

export interface Line {
  y: number;
  items: PdfTextItem[];
  text: string;
}

/** Group text items into visual lines (top to bottom), items left to right. */
export function groupLines(items: PdfTextItem[], tolerance = 2.5): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= tolerance) last.items.push(it);
    else lines.push({ y: it.y, items: [it], text: "" });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = cleanText(l.items.map((i) => i.str).join(" "));
  }
  return lines;
}

interface Cell {
  x0: number;
  x1: number;
  text: string;
}

/** Merge items on one line into cells: a new cell starts where the horizontal gap is wide. */
export function lineCells(line: Line): Cell[] {
  const cells: Cell[] = [];
  for (const it of line.items) {
    const size = it.height > 0 ? it.height : 8;
    const last = cells[cells.length - 1];
    if (last && it.x - last.x1 < Math.max(size * 0.9, 4)) {
      last.text = cleanText(`${last.text} ${it.str}`);
      last.x1 = Math.max(last.x1, it.x + it.width);
    } else {
      cells.push({ x0: it.x, x1: it.x + it.width, text: cleanText(it.str) });
    }
  }
  return cells;
}

export interface ColumnLayout {
  columns: Array<{ field: InventoryField; x0: number; x1: number; header: string }>;
  areaUnit: "sqft" | "sqm";
  headerPage: number;
}

/**
 * A line is a header when its cells map to at least four distinct fields, including a unit number
 * (or serial number) and a price or status column.
 */
export function detectHeader(line: Line, page: number): ColumnLayout | null {
  const cells = lineCells(line);
  const columns: ColumnLayout["columns"] = [];
  const seen = new Set<InventoryField>();
  for (const c of cells) {
    const field = classifyHeaderCell(c.text);
    if (!field || seen.has(field)) continue;
    seen.add(field);
    columns.push({ field, x0: c.x0, x1: c.x1, header: c.text });
  }
  const ok =
    seen.size >= 4 &&
    (seen.has("unitNumber") || seen.has("serialNumber")) &&
    (seen.has("listedPriceAED") || seen.has("status"));
  if (!ok) return null;
  const areaHeader = columns.find((c) => c.field === "areaSqFt")?.header ?? "";
  const areaUnit = /sq\.?\s*m\b|sqm|m2/i.test(areaHeader) && !/ft/i.test(areaHeader) ? "sqm" : "sqft";
  return { columns, areaUnit, headerPage: page };
}

/** Assign a cell to the column whose header span is closest to the cell's centre. */
function assignColumn(cell: Cell, layout: ColumnLayout): InventoryField {
  const centre = (cell.x0 + cell.x1) / 2;
  let best = layout.columns[0];
  let bestDist = Infinity;
  for (const col of layout.columns) {
    const dist = centre < col.x0 ? col.x0 - centre : centre > col.x1 ? centre - col.x1 : 0;
    // Also consider overlap of the cell span with the header span (handles right-aligned numbers).
    const overlap = Math.min(cell.x1, col.x1) - Math.max(cell.x0, col.x0);
    const score = overlap > 0 ? -overlap : dist;
    if (score < bestDist) {
      bestDist = score;
      best = col;
    }
  }
  return best.field;
}

export interface ExtractedRow {
  page: number;
  lineIndex: number;
  values: Partial<Record<InventoryField, string>>;
  lineText: string;
  notes: string[];
}

export interface UnplacedLine {
  page: number;
  lineIndex: number;
  text: string;
  reason: string;
}

export interface TableExtraction {
  rows: ExtractedRow[];
  /** Lines inside a table area that look like data (contain a long number) but could not be read as a row. */
  unplaced: UnplacedLine[];
  pagesWithTable: number[];
  pagesWithoutText: number[];
  pagesWithErrors: Array<{ page: number; error: string }>;
  ignoredLineCount: number;
  headerLayouts: Array<{ page: number; fields: InventoryField[]; areaUnit: string }>;
  areaUnit: "sqft" | "sqm" | "mixed";
}

const TEXT_FIELDS: InventoryField[] = ["project", "unitType", "typology", "view"];

/**
 * Extract inventory rows from all pages. A header row defines the columns; it is carried over to
 * following pages that have no header of their own (tables that continue across pages).
 * Section headings that name a project are used when there is no project column.
 */
export function extractInventoryTable(pages: PdfPageText[], projectNameMatcher?: (text: string) => string | null): TableExtraction {
  const out: TableExtraction = {
    rows: [],
    unplaced: [],
    pagesWithTable: [],
    pagesWithoutText: [],
    pagesWithErrors: [],
    ignoredLineCount: 0,
    headerLayouts: [],
    areaUnit: "sqft",
  };
  const units = new Set<string>();
  let layout: ColumnLayout | null = null;
  let headingProject: string | null = null;

  for (const page of pages) {
    if (page.error) {
      out.pagesWithErrors.push({ page: page.page, error: page.error });
      continue;
    }
    if (page.items.length === 0) {
      out.pagesWithoutText.push(page.page);
      continue;
    }
    const lines = groupLines(page.items);
    let inTable = layout !== null;
    let pageHasRows = false;
    let lastRow: ExtractedRow | null = null;
    let lastRowY = 0;

    lines.forEach((line, lineIndex) => {
      const header = detectHeader(line, page.page);
      if (header) {
        layout = header;
        inTable = true;
        units.add(header.areaUnit);
        out.headerLayouts.push({ page: page.page, fields: header.columns.map((c) => c.field), areaUnit: header.areaUnit });
        lastRow = null;
        return;
      }
      const cells = lineCells(line);
      // Section headings such as "SERENZ BY DANUBE" give the project for tables without a project column.
      if (cells.length <= 2 && projectNameMatcher) {
        const named = projectNameMatcher(line.text);
        if (named) {
          headingProject = named;
          lastRow = null;
          return;
        }
      }
      if (!inTable || !layout) {
        out.ignoredLineCount++;
        return;
      }
      const currentLayout: ColumnLayout = layout;
      const values: Partial<Record<InventoryField, string>> = {};
      for (const cell of cells) {
        const field = assignColumn(cell, currentLayout);
        values[field] = values[field] ? `${values[field]} ${cell.text}` : cell.text;
      }
      const filled = Object.keys(values).length;
      const lineHeight = line.items[0]?.height || 9;

      // Wrapped text continuing the previous row (e.g. a long view description).
      if (
        filled <= 2 &&
        lastRow &&
        Math.abs(lastRowY - line.y) < lineHeight * 1.8 &&
        Object.keys(values).every((f) => TEXT_FIELDS.includes(f as InventoryField))
      ) {
        const prev: ExtractedRow = lastRow;
        for (const [f, v] of Object.entries(values)) {
          const key = f as InventoryField;
          prev.values[key] = prev.values[key] ? `${prev.values[key]} ${v}` : v;
        }
        prev.notes.push("wrapped_text_joined");
        lastRowY = line.y;
        return;
      }
      if (filled < 3) {
        if (/\d{4,}|\d{1,3}(,\d{3})+/.test(line.text)) {
          out.unplaced.push({ page: page.page, lineIndex, text: line.text, reason: "line_with_numbers_outside_table_columns" });
        } else {
          out.ignoredLineCount++;
        }
        return;
      }
      const row: ExtractedRow = { page: page.page, lineIndex, values, lineText: line.text, notes: [] };
      if (currentLayout.headerPage !== page.page) row.notes.push(`header_from_page_${currentLayout.headerPage}`);
      if (!values.project && headingProject) {
        values.project = headingProject;
        row.notes.push("project_from_section_heading");
      }
      if (currentLayout.areaUnit === "sqm") row.notes.push("area_in_sqm");
      out.rows.push(row);
      pageHasRows = true;
      lastRow = row;
      lastRowY = line.y;
    });
    if (pageHasRows) out.pagesWithTable.push(page.page);
  }
  out.areaUnit = units.size > 1 ? "mixed" : units.has("sqm") ? "sqm" : "sqft";
  return out;
}

export interface SnapshotDateResult {
  status: "from_document" | "unknown" | "ambiguous";
  date: Date | null;
  evidence: Array<{ page: number; text: string; date: string }>;
}

const DATE_LABEL =
  /(as\s+(?:of|on|at)|dated?|updated(?:\s+on)?|last\s+updated|inventory\s+(?:as\s+(?:of|on)|date)|report\s+date|price\s*list\s+date|valid\s+(?:as\s+of|from))\s*[:\-–]?\s*([0-9]{1,4}[-/.][0-9]{1,2}[-/.][0-9]{2,4}|[0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+[0-9]{4}|[A-Za-z]{3,9}\.?\s+[0-9]{1,2}(?:st|nd|rd|th)?,?\s+[0-9]{4})/gi;

/**
 * Find an explicit snapshot date printed in the document (e.g. "Inventory as of 12-03-2026").
 * Never falls back to file or import dates. Several different dates make the result ambiguous.
 */
export function detectSnapshotDate(pages: PdfPageText[], maxPages = 3): SnapshotDateResult {
  const evidence: SnapshotDateResult["evidence"] = [];
  const candidates = [...pages.slice(0, maxPages), ...(pages.length > maxPages ? pages.slice(-1) : [])];
  for (const page of candidates) {
    for (const line of groupLines(page.items)) {
      for (const m of line.text.matchAll(DATE_LABEL)) {
        const d = parseDateOnly(m[2]);
        if (d) evidence.push({ page: page.page, text: line.text.slice(0, 200), date: d.toISOString().slice(0, 10) });
      }
    }
  }
  const distinct = [...new Set(evidence.map((e) => e.date))];
  if (distinct.length === 1) return { status: "from_document", date: new Date(`${distinct[0]}T00:00:00.000Z`), evidence };
  if (distinct.length > 1) return { status: "ambiguous", date: null, evidence };
  return { status: "unknown", date: null, evidence };
}

/** Build a matcher that finds known project names (longest first) in free text. */
export function buildProjectNameMatcher(names: string[]): (text: string) => string[] {
  const unique = [...new Set(names.map((n) => cleanText(n)).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
  const patterns = unique.map((name) => ({
    name,
    re: new RegExp(
      `(?<![A-Za-z0-9])${name
        .split(/\s+/)
        .map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s*")}(?![A-Za-z0-9])`,
      "gi",
    ),
  }));
  return (text: string) => {
    const taken: Array<[number, number]> = [];
    const found: string[] = [];
    for (const { name, re } of patterns) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        if (taken.some(([s, e]) => start < e && end > s)) continue;
        taken.push([start, end]);
        found.push(name);
      }
    }
    return found;
  };
}
