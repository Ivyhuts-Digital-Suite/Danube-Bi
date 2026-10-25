import { describe, expect, it } from "vitest";
import { readPdfText } from "@/server/ingest/pdf-text";
import { makePdf } from "../fixtures/make-pdf";

describe("readPdfText", () => {
  it("extracts positioned text items per page", async () => {
    const pdf = makePdf(
      [
        { texts: [{ x: 40, y: 500, text: "Unit No" }, { x: 140, y: 500, text: "Price (AED)" }] },
        { texts: [{ x: 40, y: 480, text: "Second (page)" }] },
      ],
      { Title: "Fixture" },
    );
    const out = await readPdfText(pdf);
    expect(out.pageCount).toBe(2);
    expect(out.info.Title).toBe("Fixture");
    expect(out.pages[0].items.map((i) => i.str)).toEqual(["Unit No", "Price (AED)"]);
    expect(out.pages[0].items[0].x).toBeCloseTo(40);
    expect(out.pages[0].items[0].y).toBeCloseTo(500);
    expect(out.pages[1].items[0].str).toBe("Second (page)");
  });

  it("reports a page without a text layer as zero items", async () => {
    const out = await readPdfText(makePdf([{ texts: [], noText: true }]));
    expect(out.pages[0].items).toHaveLength(0);
    expect(out.pages[0].error).toBeUndefined();
  });

  it("rejects bytes that are not a PDF", async () => {
    await expect(readPdfText(new Uint8Array(Buffer.from("not a pdf")))).rejects.toThrow();
  });
});
