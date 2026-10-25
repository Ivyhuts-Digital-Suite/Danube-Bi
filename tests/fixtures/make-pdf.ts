// Builds small, valid PDFs for tests. TEST-ONLY: the content is synthetic and is never
// imported into a real database.

export interface FixtureText {
  x: number;
  y: number;
  text: string;
  size?: number;
}

export interface FixturePage {
  texts: FixtureText[];
  /** Emit a page that has no text layer (simulates a scanned page). */
  noText?: boolean;
}

function escapePdfString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function makePdf(pages: FixturePage[], info: Record<string, string> = {}): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add("");
  const pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  for (const page of pages) {
    const ops = page.noText
      ? "0.5 g 50 50 200 100 re f"
      : page.texts.map((t) => `BT /F1 ${t.size ?? 9} Tf 1 0 0 1 ${t.x} ${t.y} Tm (${escapePdfString(t.text)}) Tj ET`).join("\n");
    const contentId = add(`<< /Length ${Buffer.byteLength(ops, "latin1")} >>\nstream\n${ops}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const infoEntries = Object.entries(info).map(([k, v]) => `/${k} (${escapePdfString(v)})`);
  const infoId = infoEntries.length ? add(`<< ${infoEntries.join(" ")} >>`) : null;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R${infoId ? ` /Info ${infoId} 0 R` : ""} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** Lay out a table: header at the top, one row per entry, fixed column x positions. */
export function tablePage(
  columns: Array<{ x: number; header: string }>,
  rows: string[][],
  opts: { top?: number; lineHeight?: number; title?: string; extra?: FixtureText[] } = {},
): FixturePage {
  const top = opts.top ?? 520;
  const lh = opts.lineHeight ?? 14;
  const texts: FixtureText[] = [];
  if (opts.title) texts.push({ x: 40, y: top + 30, text: opts.title, size: 14 });
  columns.forEach((c) => texts.push({ x: c.x, y: top, text: c.header }));
  rows.forEach((row, r) => {
    row.forEach((cell, i) => {
      if (cell !== "") texts.push({ x: columns[i].x, y: top - lh * (r + 1), text: cell });
    });
  });
  if (opts.extra) texts.push(...opts.extra);
  return { texts };
}
