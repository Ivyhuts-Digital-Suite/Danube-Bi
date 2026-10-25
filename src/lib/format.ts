// Display formatting. Dates are date-only values stored at UTC midnight, so they are always
// formatted in UTC to avoid shifting a calendar day.

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

export function fmtInt(v: number | null | undefined): string {
  return v == null ? "—" : nf0.format(v);
}

export function fmtNum1(v: number | null | undefined): string {
  return v == null ? "—" : nf1.format(v);
}

export function fmtAED(v: number | null | undefined): string {
  return v == null ? "—" : `AED ${nf0.format(v)}`;
}

export function fmtAEDCompact(v: number | null | undefined): string {
  return v == null ? "—" : `AED ${compact.format(v)}`;
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  return v == null ? "—" : `${(v * 100).toFixed(digits)}%`;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}

/** Timestamps (import/retrieval times) are shown in Dubai time, labelled. */
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} GST`;
}

export function fmtAgo(d: Date | string | null | undefined, now: Date): string {
  if (!d) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
