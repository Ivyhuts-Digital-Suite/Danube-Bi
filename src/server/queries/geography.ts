import { Project, ProjectFactObservation } from "@/server/models";
import { scopedAnalytics } from "./analytics";

export interface GeoProject {
  id: string;
  name: string;
  units: number;
  medianPrice: number | null;
  medianPsf: number | null;
  typologies: Array<{ label: string; count: number }>;
  geo: { lat: number; lng: number; precision: "verified" | "approximate"; source: string; recordedAt: string } | null;
  /** Location statements from brochures (text only, never turned into coordinates). */
  hints: string[];
}

export async function getGeography() {
  const [projects, scoped, locationFacts] = await Promise.all([
    Project.find().select("name geo").sort({ name: 1 }).lean(),
    scopedAnalytics(),
    ProjectFactObservation.find({ category: "location" }).select("projectId value sourcePage").lean(),
  ]);
  const stats = new Map(scoped.analytics.projects.map((g) => [g.key, g]));
  const items: GeoProject[] = projects.map((p) => {
    const s = stats.get(String(p._id));
    return {
      id: String(p._id),
      name: p.name,
      units: s?.records ?? 0,
      medianPrice: s?.price.median ?? null,
      medianPsf: s?.psf.median ?? null,
      typologies: s?.typologies ?? [],
      geo: p.geo
        ? { lat: p.geo.lat, lng: p.geo.lng, precision: p.geo.precision as "verified" | "approximate", source: p.geo.source, recordedAt: p.geo.recordedAt.toISOString() }
        : null,
      hints: locationFacts.filter((f) => String(f.projectId) === String(p._id)).map((f) => `${f.value} (brochure p.${f.sourcePage})`),
    };
  });
  return { scope: scoped.scope, items };
}
