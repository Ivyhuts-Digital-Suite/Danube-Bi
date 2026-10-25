// Small, exact statistics helpers. Inputs that are not finite numbers are ignored.

function finite(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

/** Exact quantile with linear interpolation between order statistics (Hyndman–Fan type 7, as in Excel PERCENTILE.INC). */
export function quantile(values: Array<number | null | undefined>, q: number): number | null {
  const xs = finite(values).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

export function median(values: Array<number | null | undefined>): number | null {
  return quantile(values, 0.5);
}

export function mean(values: Array<number | null | undefined>): number | null {
  const xs = finite(values);
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export interface Summary {
  n: number;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
  mean: number | null;
}

export function summarize(values: Array<number | null | undefined>): Summary {
  const xs = finite(values);
  return {
    n: xs.length,
    min: xs.length ? Math.min(...xs) : null,
    p25: quantile(xs, 0.25),
    median: quantile(xs, 0.5),
    p75: quantile(xs, 0.75),
    max: xs.length ? Math.max(...xs) : null,
    mean: mean(xs),
  };
}
