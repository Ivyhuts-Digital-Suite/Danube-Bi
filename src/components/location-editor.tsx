"use client";

import dynamic from "next/dynamic";
import { useActionState, useState } from "react";
import { clearProjectLocationAction, setProjectLocationAction, type ActionResult } from "@/app/actions";
import type { MapPoint } from "./project-map";
import { btn, btnPrimary, input, label } from "./styles";

const ProjectMap = dynamic(() => import("./project-map").then((m) => m.ProjectMap), {
  ssr: false,
  loading: () => <div className="h-[320px] w-full animate-pulse rounded-lg border border-line bg-surface-2" aria-label="Loading map" />,
});

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-good" : "text-crit"}`}>
      {state.message}
    </p>
  );
}

/**
 * Location-verification workflow: the analyst places the project from an identified source
 * (click the map or type coordinates), chooses verified/approximate and records the evidence.
 */
export function LocationEditor({ projectId, current }: { projectId: string; current: MapPoint | null }) {
  const [lat, setLat] = useState(current ? String(current.lat) : "");
  const [lng, setLng] = useState(current ? String(current.lng) : "");
  const [state, action, pending] = useActionState(setProjectLocationAction, null);
  const [clearState, clearAction, clearing] = useActionState(clearProjectLocationAction, null);
  const pick = Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng)) ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div>
        <ProjectMap
          points={current ? [current] : []}
          pick={pick}
          height={320}
          fitKey={current ? "current" : "none"}
          onPick={(a, o) => {
            setLat(a.toFixed(6));
            setLng(o.toFixed(6));
          }}
        />
        <p className="mt-2 text-xs text-muted">Click the map to place the position, or type decimal coordinates. Nothing is geocoded automatically.</p>
      </div>
      <div className="space-y-4">
        <form action={action} className="space-y-3">
          <input type="hidden" name="projectId" value={projectId} />
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>
              Latitude
              <input name="lat" value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" required placeholder="25.0657" className={`${input} w-full`} />
            </label>
            <label className={label}>
              Longitude
              <input name="lng" value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" required placeholder="55.1713" className={`${input} w-full`} />
            </label>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Precision</legend>
            <label className="flex items-start gap-2 text-sm text-ink-2">
              <input type="radio" name="precision" value="verified" defaultChecked={current?.precision !== "approximate"} className="mt-1 accent-[var(--series-1)]" />
              <span>
                <span className="text-ink">Verified</span> — building position confirmed in an authoritative source (e.g. developer site map pin, DLD map).
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-ink-2">
              <input type="radio" name="precision" value="approximate" defaultChecked={current?.precision === "approximate"} className="mt-1 accent-[var(--series-1)]" />
              <span>
                <span className="text-ink">Approximate</span> — community or district level only.
              </span>
            </label>
          </fieldset>
          <label className={label}>
            Source of the position
            <input name="source" required minLength={5} maxLength={300} placeholder="e.g. Brochure p.176 names JVC; position from Dubai REST map" className={`${input} w-full normal-case tracking-normal`} />
          </label>
          <label className={label}>
            Source URL (optional)
            <input name="sourceUrl" type="url" maxLength={2000} placeholder="https://" className={`${input} w-full normal-case tracking-normal`} />
          </label>
          <label className={label}>
            Note (optional)
            <input name="note" maxLength={500} className={`${input} w-full normal-case tracking-normal`} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Saving…" : current ? "Update position" : "Save position"}
            </button>
            <Result state={state} />
          </div>
        </form>
        {current ? (
          <form action={clearAction} className="space-y-2 border-t border-line pt-3">
            <input type="hidden" name="projectId" value={projectId} />
            <label className={label}>
              Remove position — reason
              <input name="reason" required minLength={5} maxLength={500} className={`${input} w-full normal-case tracking-normal`} />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={clearing} className={btn}>
                {clearing ? "Removing…" : "Remove position"}
              </button>
              <Result state={clearState} />
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
