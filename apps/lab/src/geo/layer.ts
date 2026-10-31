import { runAlgorithm, routeMetrics, ALGORITHMS, type RouteMetrics, type RoutePoint } from "../../engine/algorithms.mjs";
import type { Raster } from "../../engine/peaks.mjs";
import { project } from "../../engine/project.mjs";
import layerJson from "../data/upm-candidate-crown-peaks.geojson.json";
import rasterJson from "../data/upm-chmv2-native.json";

/** Mission Planner default home used by the recorded runs (tools/path-compare/cli.mjs). */
export const HOME_WGS84: [number, number] = [101.7201, 2.9833];

export const RASTER = rasterJson as unknown as Raster & { sourceDate: string; unit: string };

export interface LayerPeak extends RoutePoint {
  lonLat: [number, number];
  row: number;
  col: number;
}

interface PeakFeature {
  geometry: { coordinates: [number, number] };
  properties: { id: number; heightM: number; nativeRow: number; nativeCol: number };
}

/** The saved layer (detector output at default parameters, 6 m spacing), ordered by peak id as the recorded runs are. */
export const PEAKS: readonly LayerPeak[] = (layerJson as unknown as { features: PeakFeature[] }).features
  .map((f) => ({
    id: f.properties.id,
    lonLat: f.geometry.coordinates,
    h: f.properties.heightM,
    row: f.properties.nativeRow,
    col: f.properties.nativeCol,
    ...project(f.geometry.coordinates),
  }))
  .sort((a, b) => a.id - b.id);

export const HOME = project(HOME_WGS84);

const R = 6378137;
const merc = ([lon, lat]: [number, number]): [number, number] => [
  (R * lon * Math.PI) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];

/** WGS84 to raster cell coordinates (fractional, y down). Home falls outside the raster. */
export function toCell(lonLat: [number, number]): [number, number] {
  const [dx, , x0, , dy, y0] = RASTER.transform as [number, number, number, number, number, number];
  const [x, y] = merc(lonLat);
  return [(x - x0) / dx, (y - y0) / dy];
}

/** Raster cell edges to WGS84, using the source's Web Mercator transform. */
export function fromCell([col, row]: [number, number]): [number, number] {
  const [dx, , x0, , dy, y0] = RASTER.transform as [number, number, number, number, number, number];
  const x = x0 + col * dx;
  const y = y0 + row * dy;
  return [(x / R) * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];
}

export const RASTER_CORNERS: [[number, number], [number, number], [number, number], [number, number]] = [
  fromCell([0, 0]), fromCell([RASTER.width, 0]), fromCell([RASTER.width, RASTER.height]), fromCell([0, RASTER.height]),
];

export interface RouteRun {
  algorithm: "A" | "B";
  version: string;
  order: number[];
  /** Peak ids in visiting order. */
  peakIds: number[];
  metrics: RouteMetrics;
}

const cache = new Map<"A" | "B", RouteRun>();

/** Runs the registered tour algorithm over the saved layer. Deterministic, so cached for the page's life. */
export function routeRun(algorithm: "A" | "B"): RouteRun {
  const hit = cache.get(algorithm);
  if (hit) return hit;
  const points = [...PEAKS];
  const { order } = runAlgorithm(algorithm, points, HOME);
  const run: RouteRun = {
    algorithm,
    version: ALGORITHMS[algorithm].version,
    order,
    peakIds: order.map((i) => points[i]!.id),
    metrics: routeMetrics(points, HOME, order),
  };
  cache.set(algorithm, run);
  return run;
}
