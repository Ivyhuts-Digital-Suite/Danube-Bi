// Coordinate validation for manually recorded project locations.

/** Generous bounding box around the United Arab Emirates (WGS84). */
export const UAE_BOUNDS = { minLat: 22.5, maxLat: 26.5, minLng: 51.0, maxLng: 56.5 } as const;

export type GeoCheck = { ok: true; lat: number; lng: number } | { ok: false; reason: string };

/** Accepts decimal degrees; rejects non-numbers, swapped or out-of-UAE coordinates. */
export function checkUaeCoordinates(latRaw: unknown, lngRaw: unknown): GeoCheck {
  const lat = typeof latRaw === "number" ? latRaw : Number(String(latRaw ?? "").trim());
  const lng = typeof lngRaw === "number" ? lngRaw : Number(String(lngRaw ?? "").trim());
  if (String(latRaw ?? "").trim() === "" || String(lngRaw ?? "").trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: "Enter latitude and longitude as decimal degrees (e.g. 25.0657, 55.1713)." };
  }
  const inside = (a: number, o: number) => a >= UAE_BOUNDS.minLat && a <= UAE_BOUNDS.maxLat && o >= UAE_BOUNDS.minLng && o <= UAE_BOUNDS.maxLng;
  if (!inside(lat, lng)) {
    if (inside(lng, lat)) return { ok: false, reason: "Latitude and longitude look swapped (Dubai is about 25° N, 55° E)." };
    return { ok: false, reason: "The position is outside the UAE. Check the coordinates." };
  }
  return { ok: true, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}
