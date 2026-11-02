import type { Polygon } from "geojson";
import type { LngLat } from "./planningPoints";
import type { SamResult } from "./sam";

/** What start points are measured against. The app has no road map layer, so the outline of a loaded SAM 3.1 output or the map boundary stands in. */
export interface RoadReference { source: "sam-road" | "sam-border" | "map-boundary"; label: string; lines: LngLat[][]; key: string }
const ROAD_WORDS = /\b(roads?|tracks?|paths?|trails?|lanes?|paved|dirt)\b/i;

export function roadReference(area: Polygon, sam: SamResult | null, mapId: string): RoadReference {
  const usable = !!sam && sam.model === "sam-3.1" && (sam.mapId ?? "upm") === mapId && sam.regions.features.length > 0;
  const lines: LngLat[][] = usable
    ? sam!.regions.features.flatMap(f => f.geometry.coordinates.flatMap(polygon => polygon.map(ring => ring as LngLat[]))).filter(line => line.length >= 2)
    : [area.coordinates[0] as LngLat[]];
  const source = usable ? (ROAD_WORDS.test(sam!.prompt) ? "sam-road" : "sam-border") : "map-boundary";
  const label = source === "sam-road" ? `SAM 3.1 “${sam!.prompt}” outlines` : source === "sam-border" ? "SAM 3.1 output border (edge of tree cover)" : "map boundary";
  const vertices = lines.reduce((n, line) => n + line.length, 0), first = lines[0]?.[0] ?? [0, 0];
  return { source, label, lines, key: `${source}:${lines.length}:${vertices}:${first[0].toFixed(6)},${first[1].toFixed(6)}` };
}
