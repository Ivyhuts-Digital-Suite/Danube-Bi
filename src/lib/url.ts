export type Params = Record<string, string | number | null | undefined>;

/** Build `path?query` from params, dropping empty values. `patch` overrides `base`; null removes a key. */
export function href(path: string, base: Params = {}, patch: Params = {}): string {
  const merged: Params = { ...base, ...patch };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

/** Flatten Next's searchParams object (first value of repeated keys). */
export function flatParams(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== undefined && val !== "") out[k] = val;
  }
  return out;
}
