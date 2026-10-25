// Categorical colors for recorded status labels (identity, not good/bad): fixed slot order,
// validated as adjacent pairs in both themes. "No status" uses the neutral muted series.
export const STATUS_COLORS: Record<string, string> = {
  available: "var(--series-1)",
  sold: "var(--series-2)",
  reserved: "var(--series-3)",
  other: "var(--series-4)",
  missing: "var(--series-muted)",
};
