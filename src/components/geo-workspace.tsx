"use client";

import { Crosshair, List, Map as MapIcon, MapPin, MapPinOff } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { GeoProject } from "@/server/queries/geography";
import type { MapPoint } from "./project-map";

const ProjectMap = dynamic(() => import("./project-map").then((m) => m.ProjectMap), {
  ssr: false,
  loading: () => <div className="h-[560px] w-full animate-pulse rounded-lg border border-line bg-surface-2" aria-label="Loading map" />,
});

type Precision = "all" | "verified" | "approximate";
type View = "both" | "map" | "list";

/** Map and project list kept in sync: selecting either highlights the other. */
export function GeoWorkspace({ items }: { items: GeoProject[] }) {
  const [precision, setPrecision] = useState<Precision>("all");
  const [view, setView] = useState<View>("both");
  const [selected, setSelected] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState("init");
  const [withInventory, setWithInventory] = useState(true);

  const located = items.filter((p) => p.geo && (precision === "all" || p.geo.precision === precision) && (!withInventory || p.units > 0));
  const unlocated = items.filter((p) => !p.geo && (!withInventory || p.units > 0)).sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
  const points: MapPoint[] = useMemo(
    () =>
      located.map((p) => ({
        id: p.id,
        name: p.name,
        lat: p.geo!.lat,
        lng: p.geo!.lng,
        precision: p.geo!.precision,
        units: p.units,
        medianPrice: p.medianPrice,
        medianPsf: p.medianPsf,
        typologies: p.typologies,
        source: p.geo!.source,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- located is derived from these inputs
    [items, precision, withInventory],
  );

  const seg = (active: boolean) => `inline-flex items-center gap-1 px-2.5 py-1 text-xs ${active ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2"}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Coordinate precision">
          {(["all", "verified", "approximate"] as const).map((p, i) => (
            <button key={p} type="button" onClick={() => (setPrecision(p), setFitKey(`${p}-${Date.now()}`))} aria-pressed={precision === p} className={`${seg(precision === p)} ${i ? "border-l border-line" : ""}`}>
              {p === "all" ? "All positions" : p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-ink-2">
          <input type="checkbox" checked={withInventory} onChange={(e) => (setWithInventory(e.target.checked), setFitKey(`inv-${Date.now()}`))} className="accent-[var(--series-1)]" />
          Only projects with inventory records
        </label>
        <button type="button" onClick={() => setFitKey(`fit-${Date.now()}`)} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2.5 text-xs text-ink-2 hover:bg-surface-2">
          <Crosshair aria-hidden className="size-3.5" /> Fit to visible
        </button>
        <div className="ml-auto flex overflow-hidden rounded-md border border-line" role="group" aria-label="Layout">
          <button type="button" onClick={() => setView("both")} aria-pressed={view === "both"} className={seg(view === "both")}>
            Map + list
          </button>
          <button type="button" onClick={() => setView("map")} aria-pressed={view === "map"} className={`${seg(view === "map")} border-l border-line`}>
            <MapIcon aria-hidden className="size-3.5" /> Map
          </button>
          <button type="button" onClick={() => setView("list")} aria-pressed={view === "list"} className={`${seg(view === "list")} border-l border-line`}>
            <List aria-hidden className="size-3.5" /> List
          </button>
        </div>
      </div>

      <div className={`grid gap-4 ${view === "both" ? "xl:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
        {view !== "list" ? (
          <div className="relative">
            <ProjectMap points={points} selectedId={selected} onSelect={setSelected} fitKey={fitKey} height={560} />
            {points.length === 0 ? (
              <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center p-6">
                <div className="pointer-events-auto max-w-md rounded-lg border border-line-strong bg-surface/95 p-5 text-sm shadow-panel">
                  <p className="flex items-center gap-2 font-medium text-ink">
                    <MapPinOff aria-hidden className="size-4 text-warn" /> No project positions to plot
                  </p>
                  <p className="mt-1.5 leading-relaxed text-ink-2">
                    None of the imported sources contains coordinates, and positions are never invented or geocoded silently from project names. Open a project below and record its position with a
                    source — verified (building-level) or approximate (community-level).
                  </p>
                </div>
              </div>
            ) : null}
            <p className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-3 rounded-full border-2 border-surface bg-series-1" /> Verified position
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-3 rounded-full border-2 border-dashed border-series-1 bg-series-1/25" /> Approximate position
              </span>
              <span>Marker area ∝ accepted unit records</span>
            </p>
          </div>
        ) : null}

        {view !== "map" ? (
          <div className="space-y-4">
            <section aria-label="Located projects" className="rounded-panel border border-line bg-surface shadow-panel">
              <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-ink">
                On the map <span className="tabular font-normal text-muted">({points.length})</span>
              </h2>
              {points.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted">No positioned projects match.</p>
              ) : (
                <ul className="scroll-thin max-h-72 divide-y divide-line overflow-y-auto">
                  {located.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(p.id)}
                        aria-pressed={selected === p.id}
                        className={`flex w-full items-start justify-between gap-2 px-4 py-2 text-left text-sm ${selected === p.id ? "bg-surface-3" : "hover:bg-surface-2"}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-ink">{p.name}</span>
                          <span className="block text-[11px] text-muted">
                            {p.geo!.precision} · {p.units.toLocaleString("en-US")} records
                          </span>
                        </span>
                        <MapPin aria-hidden className={`mt-0.5 size-4 shrink-0 ${p.geo!.precision === "verified" ? "text-good" : "text-muted"}`} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Projects needing a position" className="rounded-panel border border-line bg-surface shadow-panel">
              <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-ink">
                Needs a position <span className="tabular font-normal text-muted">({unlocated.length})</span>
              </h2>
              <ul className="scroll-thin max-h-96 divide-y divide-line overflow-y-auto">
                {unlocated.map((p) => (
                  <li key={p.id} className="px-4 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">{p.name}</span>
                        <span className="block text-[11px] text-muted">
                          {p.units.toLocaleString("en-US")} records{p.hints.length ? ` · hint: ${p.hints.join("; ")}` : ""}
                        </span>
                      </span>
                      <Link href={`/projects/${p.id}#location`} className="shrink-0 text-xs text-link hover:underline">
                        Locate →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
