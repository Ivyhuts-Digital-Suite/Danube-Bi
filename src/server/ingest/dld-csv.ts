// Mapping of DLD "Real Estate Data" CSV exports. Column names follow the lists published on
// https://dubailand.gov.ae/en/open-data/real-estate-data/ (read 2026-10-25). Headers are matched
// on lower-case alphanumerics so spacing/punctuation differences in real exports do not matter.
import { cleanText, normalizeName, parseDateOnly, parseNumber, sqmToSqft } from "@/lib/normalize";

export function headerKey(h: string): string {
  return h.replace(/^﻿/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const TX = {
  id: "transactionnumber",
  date: "transactiondate",
  type: "transactiontype",
  subType: "transactionsubtype",
  regType: "registrationtype",
  freehold: "isfreehold",
  usage: "usage",
  area: "area",
  propType: "propertytype",
  propSubType: "propertysubtype",
  amount: "amount",
  txSize: "transactionsizesqm",
  propSize: "propertysizesqm",
  rooms: "rooms",
  masterProject: "masterproject",
  project: "project",
} as const;

const PRJ = {
  number: "projectnumber",
  name: "projectname",
  devNumber: "developernumber",
  devName: "developername",
  start: "startdate",
  end: "enddate",
  status: "projectstatus",
  completed: "completed",
  completion: "completiondate",
  area: "area",
  masterProject: "masterproject",
  totalUnits: "totalunits",
} as const;

export const TX_REQUIRED = [TX.id, TX.date, TX.amount, TX.type];
export const PRJ_REQUIRED = [PRJ.number, PRJ.name, PRJ.devName];

export type DldKind = "transactions" | "projects";

export function detectDldKind(headers: string[]): DldKind | null {
  const keys = new Set(headers.map(headerKey));
  if (TX_REQUIRED.every((k) => keys.has(k))) return "transactions";
  if (PRJ_REQUIRED.every((k) => keys.has(k))) return "projects";
  return null;
}

export function missingColumns(headers: string[], kind: DldKind): string[] {
  const keys = new Set(headers.map(headerKey));
  return (kind === "transactions" ? TX_REQUIRED : PRJ_REQUIRED).filter((k) => !keys.has(k));
}

export type Row = Record<string, string>;

/** Build a header-keyed row from a CSV record array. */
export function toRow(headers: string[], record: string[]): Row {
  const row: Row = {};
  headers.forEach((h, i) => {
    row[headerKey(h)] = record[i] ?? "";
  });
  return row;
}

const opt = (v: string | undefined) => {
  const t = cleanText(v);
  return t === "" || t.toLowerCase() === "null" ? undefined : t;
};

export type MapResult<T> = { ok: true; value: T; warnings: string[] } | { ok: false; reasons: string[] };

export interface TransactionValue {
  externalTransactionId: string;
  transactionDate: Date;
  transactionType?: string;
  transactionSubType?: string;
  registrationType?: string;
  isFreeHold?: string;
  usage?: string;
  community?: string;
  propertyType?: string;
  propertySubType?: string;
  rooms?: string;
  transactionValueAED: number;
  transactionSizeSqm?: number;
  propertySizeSqm?: number;
  areaSqFt?: number;
  masterProject?: string;
  projectNameAsReported?: string;
  projectNormalizedName?: string;
}

export function mapTransactionRow(row: Row): MapResult<TransactionValue> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const id = opt(row[TX.id]);
  if (!id) reasons.push("missing_transaction_number");
  const date = parseDateOnly(row[TX.date]);
  if (!date) reasons.push(row[TX.date] ? "unparseable_transaction_date" : "missing_transaction_date");
  const amount = parseNumber(row[TX.amount]);
  if (amount == null) reasons.push(row[TX.amount] ? "unparseable_amount" : "missing_amount");
  if (reasons.length) return { ok: false, reasons };

  const txSize = row[TX.txSize] ? parseNumber(row[TX.txSize]) : null;
  const propSize = row[TX.propSize] ? parseNumber(row[TX.propSize]) : null;
  if (row[TX.propSize] && propSize == null) warnings.push("property_size_unparseable");
  const project = opt(row[TX.project]);
  return {
    ok: true,
    warnings,
    value: {
      externalTransactionId: id!,
      transactionDate: date!,
      transactionType: opt(row[TX.type]),
      transactionSubType: opt(row[TX.subType]),
      registrationType: opt(row[TX.regType]),
      isFreeHold: opt(row[TX.freehold]),
      usage: opt(row[TX.usage]),
      community: opt(row[TX.area]),
      propertyType: opt(row[TX.propType]),
      propertySubType: opt(row[TX.propSubType]),
      rooms: opt(row[TX.rooms]),
      transactionValueAED: amount!,
      transactionSizeSqm: txSize ?? undefined,
      propertySizeSqm: propSize ?? undefined,
      areaSqFt: propSize != null && propSize > 0 ? sqmToSqft(propSize) : undefined,
      masterProject: opt(row[TX.masterProject]),
      projectNameAsReported: project,
      projectNormalizedName: project ? normalizeName(project) : undefined,
    },
  };
}

export interface DldProjectValue {
  projectNumber: string;
  projectName: string;
  normalizedName: string;
  developerNumber?: string;
  developerName?: string;
  projectStatus?: string;
  completedPct?: number;
  startDate?: Date;
  endDate?: Date;
  completionDate?: Date;
  area?: string;
  masterProject?: string;
  totalUnits?: number;
}

export function mapProjectRow(row: Row): MapResult<DldProjectValue> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const number = opt(row[PRJ.number]);
  const name = opt(row[PRJ.name]);
  if (!number) reasons.push("missing_project_number");
  if (!name) reasons.push("missing_project_name");
  if (reasons.length) return { ok: false, reasons };
  const pct = row[PRJ.completed] ? parseNumber(row[PRJ.completed].replace("%", "")) : null;
  if (row[PRJ.completed] && pct == null) warnings.push("completed_pct_unparseable");
  if (pct != null && pct > 100) warnings.push("completed_pct_over_100");
  const date = (k: string) => {
    const raw = row[k];
    if (!raw) return undefined;
    const d = parseDateOnly(raw);
    if (!d) warnings.push(`${k}_unparseable`);
    return d ?? undefined;
  };
  const units = row[PRJ.totalUnits] ? parseNumber(row[PRJ.totalUnits]) : null;
  return {
    ok: true,
    warnings,
    value: {
      projectNumber: number!,
      projectName: name!,
      normalizedName: normalizeName(name!),
      developerNumber: opt(row[PRJ.devNumber]),
      developerName: opt(row[PRJ.devName]),
      projectStatus: opt(row[PRJ.status]),
      completedPct: pct ?? undefined,
      startDate: date(PRJ.start),
      endDate: date(PRJ.end),
      completionDate: date(PRJ.completion),
      area: opt(row[PRJ.area]),
      masterProject: opt(row[PRJ.masterProject]),
      totalUnits: units ?? undefined,
    },
  };
}

/** Developers treated as Danube for share calculations: DLD developer names containing "danube". */
export const DANUBE_DEVELOPER_PATTERN = /danube/i;
