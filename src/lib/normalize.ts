// Pure normalization helpers shared by ingestion and analytics.
// Every function returns null rather than guessing when the input is ambiguous.

/** Exact conversion factor: 1 square metre = 10.763910416709722 square feet (international foot). */
export const SQFT_PER_SQM = 10.763910416709722;

export function sqmToSqft(sqm: number): number {
  return sqm * SQFT_PER_SQM;
}

/**
 * Parse a numeric string such as "1,234,567", "AED 1,234,567.00", "1 234 567" or "850.5 sq.ft".
 * Returns null for empty, non-numeric, negative or multi-number strings ("1,000 - 2,000").
 */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw
    // Unit labels may touch the number ("AED1,050,000"), so use letter lookarounds, not \b.
    .replace(/(?<![a-z])(aed|dhs?|sq\.?\s*ft\.?|sqft|sq\.?\s*m\.?|sqm|ft2|m2)(?![a-z])/gi, "")
    .replace(/[\s ]/g, "")
    .trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "—") return null;
  // Reject ranges or several numbers in one cell.
  if (/\d[-–—/]\d/.test(cleaned)) return null;
  if (!/^\d{1,3}(,\d{3})+(\.\d+)?$|^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned.replace(/,/g, ""));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Price per square foot, or null when either input is missing or area is not positive. */
export function pricePerSqFt(priceAED: number | null | undefined, areaSqFt: number | null | undefined): number | null {
  if (priceAED == null || areaSqFt == null || !(areaSqFt > 0) || !(priceAED >= 0)) return null;
  return priceAED / areaSqFt;
}

/** Key used for exact project-name matching: lower-case alphanumerics only ("BAYZ101" == "Bayz 101"). */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Unit numbers are compared case-insensitively with whitespace removed ("b-1204 " == "B-1204"). */
export function normalizeUnitNumber(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Collapse whitespace and trim. */
export function cleanText(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function utcDate(y: number, m: number, d: number): Date | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject overflow such as 31-02-2024.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/**
 * Parse a calendar date into a UTC-midnight Date (date-only semantics, no time-zone shift).
 * Accepted: ISO "2024-03-05" (optionally with a time part), day-first "05-03-2024" / "05/03/2024"
 * (UAE convention, as used on the DLD site), and "5 March 2024" / "March 5, 2024".
 * Month-first numeric dates are deliberately NOT accepted, so "03/05/2024" is read day-first only.
 */
export function parseDateOnly(raw: unknown): Date | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : utcDate(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  }
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return utcDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s.*)?$/.exec(s);
  if (m) return utcDate(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?[\s,-]+(\d{4})$/.exec(s);
  if (m) {
    const month = monthNumber(m[2]);
    return month ? utcDate(+m[3], month, +m[1]) : null;
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = monthNumber(m[1]);
    return month ? utcDate(+m[3], month, +m[2]) : null;
  }
  return null;
}

function monthNumber(name: string): number | null {
  const lower = name.toLowerCase();
  const full = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const idx = full.findIndex((f) => f === lower || (lower.length >= 3 && f.startsWith(lower)));
  if (idx >= 0) return idx + 1;
  return MONTHS[lower] ?? null;
}

/** Escape user text for safe use inside a MongoDB $regex. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Levenshtein distance, used only to *flag* possible aliases for human review. */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
