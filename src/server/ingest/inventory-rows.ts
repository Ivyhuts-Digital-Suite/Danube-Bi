import { cleanText, normalizeUnitNumber, parseNumber, pricePerSqFt, sqmToSqft } from "@/lib/normalize";
import type { ExtractedRow } from "./pdf-table";

export type NormalizedStatus = "available" | "sold" | "reserved" | "other";

export function normalizeStatus(raw: string | undefined): NormalizedStatus | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (/^(available|avail\.?|open|for\s*sale|unsold|vacant)$/.test(s)) return "available";
  if (/^(sold|sold\s*out|registered)$/.test(s)) return "sold";
  if (/^(booked|reserved|on\s*hold|hold|blocked|under\s*offer|token)$/.test(s)) return "reserved";
  return "other";
}

export interface InventoryRowResult {
  ok: true;
  value: {
    serialNumber: string | null;
    projectNameAsListed: string | null;
    unitNumber: string;
    unitKey: string;
    unitType: string | null;
    typology: string | null;
    areaSqFt: number | null;
    view: string | null;
    listedPriceAED: number | null;
    status: string | null;
    statusNormalized: NormalizedStatus | null;
    pricePerSqFt: number | null;
    originalValues: Record<string, string>;
    validationWarnings: string[];
  };
}

export interface InventoryRowRejection {
  ok: false;
  reasons: string[];
  originalValues: Record<string, string>;
}

/** Plausibility bounds used only to raise warnings, never to alter values. */
const PRICE_RANGE = { min: 50_000, max: 500_000_000 };
const AREA_RANGE = { min: 100, max: 50_000 };

export function normalizeInventoryRow(row: ExtractedRow): InventoryRowResult | InventoryRowRejection {
  const v = row.values;
  const originalValues: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (val != null) originalValues[k] = val;
  originalValues._line = row.lineText;

  const warnings = [...row.notes];
  const unitNumberRaw = cleanText(v.unitNumber);
  const price = v.listedPriceAED != null ? parseNumber(v.listedPriceAED) : null;

  if (!unitNumberRaw && price == null) {
    return { ok: false, reasons: ["missing_unit_number_and_price"], originalValues };
  }
  if (!unitNumberRaw) {
    return { ok: false, reasons: ["missing_unit_number"], originalValues };
  }

  if (v.listedPriceAED != null && price == null) warnings.push("price_unparseable");
  if (v.listedPriceAED == null) warnings.push("price_missing");
  if (price != null && (price < PRICE_RANGE.min || price > PRICE_RANGE.max)) warnings.push("price_outside_plausible_range");

  let area = v.areaSqFt != null ? parseNumber(v.areaSqFt) : null;
  if (v.areaSqFt != null && area == null) warnings.push("area_unparseable");
  if (v.areaSqFt == null) warnings.push("area_missing");
  if (area != null && row.notes.includes("area_in_sqm")) {
    area = sqmToSqft(area);
    warnings.push("area_converted_from_sqm");
  }
  if (area != null && (area < AREA_RANGE.min || area > AREA_RANGE.max)) warnings.push("area_outside_plausible_range");

  const status = cleanText(v.status) || null;
  const statusNormalized = normalizeStatus(status ?? undefined);
  if (!status) warnings.push("status_missing");
  else if (statusNormalized === "other") warnings.push("status_unrecognized");

  const project = cleanText(v.project) || null;
  if (!project) warnings.push("project_missing");

  return {
    ok: true,
    value: {
      serialNumber: cleanText(v.serialNumber) || null,
      projectNameAsListed: project,
      unitNumber: unitNumberRaw,
      unitKey: normalizeUnitNumber(unitNumberRaw),
      unitType: cleanText(v.unitType) || null,
      typology: cleanText(v.typology) || null,
      areaSqFt: area,
      view: cleanText(v.view) || null,
      listedPriceAED: price,
      status,
      statusNormalized,
      pricePerSqFt: pricePerSqFt(price, area),
      originalValues,
      validationWarnings: warnings,
    },
  };
}
