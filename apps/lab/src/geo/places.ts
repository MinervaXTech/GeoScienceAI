import type { Polygon } from "geojson";

export interface MapLocation { center: [number, number]; zoom: number; area?: Polygon }
export interface PlaceResult extends MapLocation {
  id: string;
  name: string;
  label: string;
  kind: string;
}

/** Keep provider geometry and display text bounded before returning it to the UI. */
export function photonPlaces(data: unknown): PlaceResult[] {
  if (!data || typeof data !== "object" || !Array.isArray((data as { features?: unknown }).features)) throw Error("Invalid place search response.");
  const features = (data as { features: unknown[] }).features;
  const results: PlaceResult[] = [];
  const zooms: Record<string, number> = { country: 5, state: 7, county: 10, city: 13, district: 14, locality: 15, street: 16, house: 17 };
  for (const feature of features.slice(0, 10)) {
    if (!feature || typeof feature !== "object") continue;
    const { geometry, properties: p } = feature as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> };
    const point = geometry?.coordinates;
    if (geometry?.type !== "Point" || !Array.isArray(point) || point.length !== 2 || !point.every((n) => typeof n === "number" && Number.isFinite(n)) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 85 || !p || typeof p.name !== "string" || !p.name.trim()) continue;
    const text = (field: string) => typeof p[field] === "string" ? (p[field] as string).slice(0, 160) : "";
    const label = [...new Set([text("name"), text("street"), text("city"), text("county"), text("state"), text("country")].filter(Boolean))].join(", ");
    const kind = text("osm_value") || text("type") || "place";
    const id = `${text("osm_type")}-${String(p.osm_id ?? results.length).slice(0, 40)}`;
    if (results.some((place) => place.id === id)) continue;
    results.push({ id, name: text("name"), label, kind, center: [point[0], point[1]], zoom: zooms[text("type")] ?? 14 });
    if (results.length === 5) break;
  }
  return results;
}
