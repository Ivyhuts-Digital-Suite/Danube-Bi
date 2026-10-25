/**
 * Parse the start of a CSV file for preview (RFC 4180 quoting, CRLF or LF). The last record is
 * dropped when the text was truncated mid-record. Used only for previews; imports use csv-parse.
 */
export function parseCsvPreview(text: string, maxRecords = 6, truncated = false): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let complete = true;
  for (let i = 0; i < text.length && out.length < maxRecords; i++) {
    const c = text[i];
    complete = false;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
      complete = true;
    } else cell += c;
  }
  if (!complete && out.length < maxRecords && !truncated) {
    row.push(cell);
    out.push(row);
  }
  if (out[0]?.[0]) out[0][0] = out[0][0].replace(/^﻿/, "");
  return out;
}

/**
 * One CSV cell (RFC 4180 quoting). Text starting with = + - @ or a tab/CR is prefixed with an
 * apostrophe so spreadsheet apps do not execute it as a formula. Numbers are written as-is.
 */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
