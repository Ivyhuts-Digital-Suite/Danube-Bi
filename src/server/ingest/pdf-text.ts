import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPageText {
  page: number;
  width: number;
  height: number;
  items: PdfTextItem[];
  /** Set when this page could not be parsed; other pages are still processed. */
  error?: string;
}

export interface PdfText {
  pageCount: number;
  info: Record<string, unknown>;
  pages: PdfPageText[];
}

export const MAX_PDF_PAGES = 5000;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | null = null;

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((mod) => {
      // Node has no web workers: point pdf.js at its worker module so it runs it in-process.
      const require = createRequire(path.join(process.cwd(), "package.json"));
      const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
      mod.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
      return mod;
    });
  }
  return pdfjsPromise;
}

/**
 * Extract positioned text from every page. Pages that fail are reported individually.
 * No OCR is performed: a page without a text layer comes back with zero items.
 */
export async function readPdfText(data: Uint8Array): Promise<PdfText> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data,
    disableFontFace: true,
    // Text extraction never needs images; skip decoding very large ones.
    maxImageSize: 0,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    if (doc.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF has ${doc.numPages} pages; the limit is ${MAX_PDF_PAGES}.`);
    }
    let info: Record<string, unknown> = {};
    try {
      const meta = await doc.getMetadata();
      info = { ...(meta.info as Record<string, unknown>) };
    } catch {
      info = {};
    }
    const pages: PdfPageText[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      try {
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items: PdfTextItem[] = [];
        for (const it of content.items) {
          if (!("str" in it)) continue;
          if (it.str.trim() === "") continue;
          const [, , c, d, e, f] = it.transform as number[];
          items.push({ str: it.str, x: e, y: f, width: it.width, height: it.height || Math.hypot(c, d) });
        }
        pages.push({ page: p, width: viewport.width, height: viewport.height, items });
        page.cleanup();
      } catch (err) {
        pages.push({ page: p, width: 0, height: 0, items: [], error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { pageCount: doc.numPages, info, pages };
  } finally {
    await task.destroy();
  }
}
