import { describe, expect, it } from "vitest";
import { attributePage } from "@/server/ingest/brochure-import";
import { extractBrochureFacts } from "@/server/ingest/brochure-facts";
import { detectDldKind, mapProjectRow, mapTransactionRow, missingColumns, toRow } from "@/server/ingest/dld-csv";
import type { Line } from "@/server/ingest/pdf-table";

const lines = (texts: string[]): Line[] => texts.map((t, i) => ({ y: 500 - i * 12, items: [], text: t }));

describe("extractBrochureFacts (synthetic text)", () => {
  it("extracts configurations, payment plans, locations, handover and price claims", () => {
    const facts = extractBrochureFacts(
      lines([
        "Located in Testville Heights, the tower offers Studios, 1 Bedroom and 2BR homes.",
        "Enjoy a 1% monthly payment plan.",
        "Handover expected Q4 2027.",
        "Starting from AED 750,000",
      ]),
    );
    const by = (c: string) => facts.filter((f) => f.category === c).map((f) => f.value);
    expect(by("configuration")).toEqual(["Studio", "1 bedroom", "2 bedroom"]);
    expect(by("payment_plan")[0]).toMatch(/^1% monthly/);
    expect(by("location")).toEqual(["Testville Heights"]);
    expect(by("handover")).toEqual(["Q4 2027"]);
    expect(by("price_claim")).toEqual(["Starting from AED 750,000"]);
    expect(facts.every((f) => f.extractedText.length > 0)).toBe(true);
  });

  it("reads amenity lists under a heading and stops at prose", () => {
    const facts = extractBrochureFacts(lines(["AMENITIES", "• Swimming Pool", "• Gym", "Kids Play Area", "This is a long sentence that ends the list."]));
    expect(facts.filter((f) => f.category === "amenity").map((f) => f.value)).toEqual(["Swimming Pool", "Gym", "Kids Play Area"]);
  });
});

describe("attributePage", () => {
  it("links single-name pages, carries forward briefly, and refuses ambiguity", () => {
    expect(attributePage(["A", "A"], null)).toEqual({ attribution: "single_name_match", name: "A" });
    expect(attributePage(["A", "B"], null)).toEqual({ attribution: "ambiguous", name: null });
    expect(attributePage(["A", "A", "A", "B"], null)).toEqual({ attribution: "single_name_match", name: "A" });
    expect(attributePage([], { name: "A", pages: 0 })).toEqual({ attribution: "carried_forward", name: "A" });
    expect(attributePage([], { name: "A", pages: 50 })).toEqual({ attribution: "none", name: null });
    expect(attributePage([], null)).toEqual({ attribution: "none", name: null });
  });
});

describe("DLD CSV mapping", () => {
  const txHeaders = ["Transaction Number", "Transaction Date", "Transaction Type", "Transaction sub type", "Registration type", "Is Free Hold?", "Usage", "Area", "Property Type", "Property Sub Type", "Amount", "Transaction Size (sq.m)", "Property Size (sq.m)", "Room(s)", "Parking", "Nearest Metro", "Nearest Mall", "Nearest Landmark", "No. of Buyer", "No. of Seller", "Master Project", "Project"];

  it("detects export kinds and missing columns", () => {
    expect(detectDldKind(txHeaders)).toBe("transactions");
    expect(detectDldKind(["﻿Project Number", "Project Name", "Developer Number", "Developer Name"])).toBe("projects");
    expect(detectDldKind(["foo", "bar"])).toBeNull();
    expect(missingColumns(["Transaction Number"], "transactions")).toEqual(["transactiondate", "amount", "transactiontype"]);
  });

  it("maps a transaction row with explicit sq m -> sq ft conversion", () => {
    const rec = ["T-1", "05-03-2024", "Sales", "Sell - Pre registration", "Off-Plan", "Free Hold", "Residential", "Test Area", "Unit", "Flat", "1,000,000", "100", "100", "1 B/R", "", "", "", "", "1", "1", "", "Test Tower"];
    const r = mapTransactionRow(toRow(txHeaders, rec));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.transactionDate.toISOString()).toBe("2024-03-05T00:00:00.000Z");
    expect(r.value.transactionValueAED).toBe(1_000_000);
    expect(r.value.areaSqFt).toBeCloseTo(1076.391, 2);
    expect(r.value.projectNormalizedName).toBe("testtower");
  });

  it("rejects rows without id, date or amount", () => {
    const rec = ["", "bad-date", "Sales", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
    const r = mapTransactionRow(toRow(txHeaders, rec));
    expect(r).toEqual({ ok: false, reasons: ["missing_transaction_number", "unparseable_transaction_date", "missing_amount"] });
  });

  it("maps a project register row", () => {
    const headers = ["Project Number", "Project Name", "Developer Number", "Developer Name", "Project Status", "Completed (%)", "Completion Date", "Total Units"];
    const r = mapProjectRow(toRow(headers, ["P1", "Test Tower", "D9", "Test Developer LLC", "Active", "45%", "31-12-2027", "300"]));
    expect(r.ok && r.value).toMatchObject({ projectNumber: "P1", normalizedName: "testtower", developerName: "Test Developer LLC", completedPct: 45, totalUnits: 300 });
  });
});
