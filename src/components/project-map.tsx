"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";

export interface MapPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  precision: "verified" | "approximate";
  units: number;
  medianPrice: number | null;
  medianPsf: number | null;
  typologies: Array<{ label: string; count: number }>;
  source: string;
}

/** Dubai, used only as the initial view when no project has a position (no marker is placed there). */
const DUBAI_VIEW: [number, number] = [25.13, 55.22];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

function popupHtml(p: MapPoint) {
  const typ = p.typologies
    .slice(0, 3)
    .map((t) => `<li>${esc(t.label)} <span style="color:var(--muted)">· ${fmt(t.count)}</span></li>`)
    .join("");
  return `<div style="min-width:220px;font-size:12px;line-height:1.45">
    <p style="margin:0;font-weight:600;font-size:13px;color:var(--ink)">${esc(p.name)}</p>
    <p style="margin:2px 0 8px;color:var(--muted)">${p.precision === "verified" ? "Verified position" : "Approximate position"} · ${esc(p.source)}</p>
    <p style="margin:0;color:var(--ink-2)">Unit records: <b style="color:var(--ink)">${fmt(p.units)}</b></p>
    <p style="margin:0;color:var(--ink-2)">Median listed price: <b style="color:var(--ink)">${p.medianPrice != null ? `AED ${fmt(p.medianPrice)}` : "—"}</b></p>
    <p style="margin:0;color:var(--ink-2)">Median AED/sq ft: <b style="color:var(--ink)">${p.medianPsf != null ? fmt(p.medianPsf) : "—"}</b></p>
    ${typ ? `<ul style="margin:6px 0 0;padding-left:16px;color:var(--ink-2)">${typ}</ul>` : ""}
    <a href="/projects/${esc(p.id)}" style="display:inline-block;margin-top:8px;color:var(--link)">Open project →</a>
  </div>`;
}

export function ProjectMap({
  points,
  selectedId,
  onSelect,
  onPick,
  pick,
  height = 520,
  fitKey,
}: {
  points: MapPoint[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Click-to-place: called with the clicked coordinates when `pick` is set. */
  onPick?: (lat: number, lng: number) => void;
  pick?: { lat: number; lng: number } | null;
  height?: number;
  /** Changing this value re-fits the view to the visible points. */
  fitKey?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const pickLayer = useRef<Leaflet.LayerGroup | null>(null);
  const markers = useRef(new Map<string, Leaflet.CircleMarker>());
  const handlers = useRef({ onSelect, onPick });

  useEffect(() => {
    handlers.current = { onSelect, onPick };
  }, [onSelect, onPick]);

  // Create the map once (Leaflet touches window, so it is imported in the browser only).
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || !el.current || map.current) return;
      const lf = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as unknown as typeof Leaflet);
      L.current = lf;
      const m = lf.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView(DUBAI_VIEW, 10);
      lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        className: "map-tiles",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      }).addTo(m);
      m.on("click", (e: Leaflet.LeafletMouseEvent) => handlers.current.onPick?.(e.latlng.lat, e.latlng.lng));
      m.on("focus", () => m.scrollWheelZoom.enable());
      m.on("blur", () => m.scrollWheelZoom.disable());
      layer.current = lf.layerGroup().addTo(m);
      pickLayer.current = lf.layerGroup().addTo(m);
      map.current = m;
      m.fire("ready");
      setTimeout(() => m.invalidateSize(), 0);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Draw markers whenever the points change.
  useEffect(() => {
    const draw = () => {
      const lf = L.current;
      const m = map.current;
      if (!lf || !m || !layer.current) return;
      layer.current.clearLayers();
      markers.current.clear();
      const css = getComputedStyle(document.documentElement);
      const series = css.getPropertyValue("--series-1").trim() || "#3987e5";
      const surface = css.getPropertyValue("--surface").trim() || "#0f1829";
      const maxUnits = Math.max(1, ...points.map((p) => p.units));
      for (const p of points) {
        const radius = 6 + 16 * Math.sqrt(p.units / maxUnits);
        const verified = p.precision === "verified";
        const mk = lf
          .circleMarker([p.lat, p.lng], {
            radius,
            color: verified ? surface : series,
            weight: 2,
            dashArray: verified ? undefined : "4 3",
            fillColor: series,
            fillOpacity: verified ? 0.75 : 0.25,
          })
          .bindPopup(popupHtml(p), { maxWidth: 300 })
          .bindTooltip(`${esc(p.name)} · ${fmt(p.units)} records`, { direction: "top", offset: [0, -radius] });
        mk.on("click", () => handlers.current.onSelect?.(p.id));
        mk.addTo(layer.current);
        markers.current.set(p.id, mk);
      }
    };
    if (map.current) draw();
    else {
      const t = setInterval(() => {
        if (map.current) {
          clearInterval(t);
          draw();
        }
      }, 50);
      return () => clearInterval(t);
    }
  }, [points]);

  // Fit to the visible points when asked.
  useEffect(() => {
    const fit = () => {
      const lf = L.current;
      const m = map.current;
      if (!lf || !m) return false;
      if (points.length === 0) m.setView(DUBAI_VIEW, 10);
      else if (points.length === 1) m.setView([points[0].lat, points[0].lng], 14);
      else m.fitBounds(lf.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 15 });
      return true;
    };
    if (fit()) return;
    const t = setInterval(() => fit() && clearInterval(t), 60);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fit only on explicit request
  }, [fitKey]);

  // Highlight and pan to the selected project.
  useEffect(() => {
    const m = map.current;
    for (const [id, mk] of markers.current) mk.setStyle({ weight: id === selectedId ? 4 : 2 });
    const mk = selectedId ? markers.current.get(selectedId) : undefined;
    if (m && mk) {
      m.panTo(mk.getLatLng());
      mk.openPopup();
    }
  }, [selectedId, points]);

  // Show the position being placed in the location editor.
  useEffect(() => {
    const lf = L.current;
    if (!lf || !pickLayer.current) return;
    pickLayer.current.clearLayers();
    if (pick) {
      const css = getComputedStyle(document.documentElement);
      lf.circleMarker([pick.lat, pick.lng], { radius: 8, color: css.getPropertyValue("--brand").trim() || "#d2b07a", weight: 3, fillOpacity: 0.2 }).addTo(pickLayer.current);
    }
  }, [pick]);

  return (
    <div
      ref={el}
      style={{ height }}
      className={`w-full overflow-hidden rounded-lg border border-line ${onPick ? "cursor-crosshair" : ""}`}
      role="region"
      aria-label={`Map of ${points.length} project position(s). Use the project list for keyboard access.`}
      tabIndex={0}
    />
  );
}
