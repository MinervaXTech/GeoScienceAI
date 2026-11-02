import type { FeatureCollection, LineString, Point, Polygon, Position } from "geojson";
import proj4 from "proj4";
import { imagePixelToLngLat } from "./sam";
import { insidePolygon } from "./polygonEdit";
import type { TreeGuidanceSettings, TreeGuidanceSummary } from "./treeGuidance";
import type { CrownMatchResult } from "./templateMatch";
import { runAlgorithm, routeMetrics } from "../../engine/algorithms.mjs";

export type LngLat = [number, number];
export interface PlanningPoint { id: string; coordinate: LngLat; source: "crown-match" | "manual" | "canopy-estimate"; similarity?: number; edited?: boolean; canopyHeightM?: number }
export interface PlanningPoints { version: 1; mapId: string; area: Polygon; points: PlanningPoint[]; home: LngLat; minSpacingM: number; createdAt: string; sourceResultAt: string; generationSettings?: { spacingM: number; sensitivity: number; guidance?: TreeGuidanceSettings }; exclusions?: Polygon[]; coverage?: { method: "rgb-texture-spaced-estimate-v1" | "rgb-chmv2-sam-spaced-estimate-v1"; guidance?: TreeGuidanceSummary; needsRefresh?: boolean; spacingM: number; sensitivity: number; eligiblePixels: number; coveredPixels: number; estimatedCount: number; retainedCount: number; maskDataUrl: string; corners: import("./sam").MapCorners } }
export interface PlanningTour { algorithm: "A" | "B"; order: string[]; coordinates: LngLat[]; lengthM: number; turnSumDeg: number }
export interface PlanningRoutes { A: PlanningTour; B: PlanningTour }
export const PLANNING_POINT_LIMIT = 5000;
export function metricFrame(area: Polygon) {
  const ring = area.coordinates[0]!, lon = ring.reduce((n, p) => n + p[0]!, 0) / ring.length, lat = ring.reduce((n, p) => n + p[1]!, 0) / ring.length;
  const transform = proj4("EPSG:4326", `+proj=aeqd +lat_0=${lat} +lon_0=${lon} +datum=WGS84 +units=m +no_defs`);
  return (coordinate: LngLat) => { const [x, y] = transform.forward(coordinate); return { x: x!, y: y! }; };
}
export function inPlanningArea(area: Polygon, coordinate: LngLat): boolean {
  const rings = area.coordinates.map((ring) => ring.map(([x, y]) => ({ x: x!, y: y! })));
  return insidePolygon(rings[0]!, { x: coordinate[0], y: coordinate[1] }) && !rings.slice(1).some((ring) => insidePolygon(ring, { x: coordinate[0], y: coordinate[1] }));
}
export function planningLocationError(set: PlanningPoints, coordinate: LngLat, except?: string): string | null {
  if (!coordinate.every(Number.isFinite) || (!inPlanningArea(set.area, coordinate) || set.exclusions?.some((area) => inPlanningArea(area, coordinate)))) return "Place the point inside the selected polygon, away from excluded areas.";
  const project = metricFrame(set.area), at = project(coordinate);
  if (set.points.some((point) => { if (point.id === except) return false; const p = project(point.coordinate); return Math.hypot(p.x - at.x, p.y - at.y) < set.minSpacingM - 1e-6; })) return `Keep at least ${set.minSpacingM} m between planning points. Choose another centre or rebuild with lower cleanup spacing.`;
  return null;
}
/** Retain observed match centres only. Never fill empty space with a grid. */
export function planningFromCrowns(result: CrownMatchResult, minSpacingM: number, threshold: number): PlanningPoints {
  if (!Number.isFinite(minSpacingM) || minSpacingM < 0.5 || minSpacingM > 50 || !Number.isFinite(threshold) || threshold < 0.4 || threshold > 1) throw Error("Choose cleanup spacing from 0.5–50 m and similarity from 0.4–1.");
  const project = metricFrame(result.image.area), accepted: PlanningPoint[] = [], projected: { x: number; y: number }[] = [];
  // Use retained matcher evidence rather than circle sizes: only centres matter here.
  for (const hit of [...(result.rawMatches ?? result.matches)].sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x)) {
    if (hit.score < threshold) continue;
    const coordinate = imagePixelToLngLat(result.image, hit.x + hit.width / 2, hit.y + hit.height / 2);
    if (!inPlanningArea(result.image.area, coordinate)) continue;
    const p = project(coordinate);
    if (projected.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < minSpacingM)) continue;
    if (accepted.length === PLANNING_POINT_LIMIT) throw Error("More than 5000 centres remain. Increase cleanup spacing/similarity or select a smaller area.");
    accepted.push({ id: "", coordinate, source: "crown-match", similarity: hit.score }); projected.push(p);
  }
  if (!accepted.length) throw Error("No crown centres meet these settings. Lower similarity or run matching on a clearer crop.");
  accepted.sort((a, b) => b.coordinate[1] - a.coordinate[1] || a.coordinate[0] - b.coordinate[0]);
  accepted.forEach((point, i) => { point.id = `P${String(i + 1).padStart(3, "0")}`; });
  return { version: 1, mapId: result.mapId, area: result.image.area, points: accepted, home: [...accepted[0]!.coordinate], minSpacingM, createdAt: new Date().toISOString(), sourceResultAt: result.receivedAt };
}
export function computePlanningRoutes(set: PlanningPoints): PlanningRoutes {
  if (set.points.length < 2 || set.points.length > PLANNING_POINT_LIMIT) throw Error("Use between 2 and 5000 points for route comparison.");
  const project = metricFrame(set.area), points = set.points.map((p, i) => ({ id: i + 1, ...project(p.coordinate), h: 0 })), home = project(set.home);
  const baseline = runAlgorithm("A", points, home).order;
  // Dense coverage contains thousands of centres. Cache distances while keeping
  // the registered first-improving 2-opt order and tolerance exactly unchanged.
  const optimized = () => {
    const coordinates = [home, ...points], n = coordinates.length, distances = new Float64Array(n * n), cycle = [0, ...baseline.map((i) => i + 1)];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) distances[i * n + j] = distances[j * n + i] = Math.hypot(coordinates[i]!.x - coordinates[j]!.x, coordinates[i]!.y - coordinates[j]!.y);
    for (let pass = 0; pass < 10000; pass++) {
      let improved = false;
      for (let i = 0; i < n - 2 && !improved; i++) for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const a = cycle[i]!, b = cycle[i + 1]!, c = cycle[j]!, d = cycle[(j + 1) % n]!;
        if (distances[a * n + c]! + distances[b * n + d]! < distances[a * n + b]! + distances[c * n + d]! - 1e-9) {
          for (let left = i + 1, right = j; left < right; left++, right--) [cycle[left], cycle[right]] = [cycle[right]!, cycle[left]!];
          improved = true; break;
        }
      }
      if (!improved) return cycle.slice(1).map((i) => i - 1);
    }
    throw Error("2-opt pass cap reached. Use fewer points.");
  };
  const tour = (algorithm: "A" | "B"): PlanningTour => {
    const order = algorithm === "A" ? baseline : optimized(), metrics = routeMetrics(points, home, order);
    return { algorithm, order: order.map((i) => set.points[i]!.id), coordinates: [set.home, ...order.map((i) => set.points[i]!.coordinate), set.home], lengthM: metrics.pathLengthM, turnSumDeg: metrics.turnSumDeg };
  };
  return { A: tour("A"), B: tour("B") };
}
export function planningFeatures(set: PlanningPoints | null, routes: PlanningRoutes | null): FeatureCollection<Point | LineString> {
  return { type: "FeatureCollection", features: set ? [
    ...set.points.map((point) => ({ type: "Feature" as const, properties: { kind: "planning-point", ...point, approximate: true, visitA: routes ? routes.A.order.indexOf(point.id) + 1 : null, visitB: routes ? routes.B.order.indexOf(point.id) + 1 : null }, geometry: { type: "Point" as const, coordinates: point.coordinate } })),
    { type: "Feature", properties: { kind: "planning-home" }, geometry: { type: "Point", coordinates: set.home } },
    ...(["A", "B"] as const).flatMap((id) => routes ? [{ type: "Feature" as const, properties: { kind: "planning-route", algorithm: id, lengthM: routes[id].lengthM }, geometry: { type: "LineString" as const, coordinates: routes[id].coordinates } }] : []),
  ] : [] };
}
export function planningCsv(set: PlanningPoints, routes: PlanningRoutes | null): string {
  return ["id,longitude,latitude,source,similarity,edited,approximate,chmv2_height_m,visit_A,visit_B", ...set.points.map((p) => [p.id, ...p.coordinate, p.source, p.similarity ?? "", !!p.edited, true, p.canopyHeightM ?? "", routes ? routes.A.order.indexOf(p.id) + 1 : "", routes ? routes.B.order.indexOf(p.id) + 1 : ""].join(","))].join("\n");
}
export function planningFigureSvg(set: PlanningPoints, routes: PlanningRoutes): string {
  const project = metricFrame(set.area), all: Position[] = [...set.area.coordinates.flat(), set.home], xy = all.map((p) => project(p as LngLat));
  const minX = Math.min(...xy.map((p) => p.x)), maxX = Math.max(...xy.map((p) => p.x)), minY = Math.min(...xy.map((p) => p.y)), maxY = Math.max(...xy.map((p) => p.y));
  const scale = Math.min(820 / (maxX - minX || 1), 880 / (maxY - minY || 1));
  const pixel = (p: Position): [number, number] => { const xy = project(p as LngLat); return [60 + (xy.x - minX) * scale, 1040 - (xy.y - minY) * scale]; };
  const path = (points: Position[], close = false) => points.map((p, i) => `${i ? "L" : "M"}${pixel(p).map((n) => n.toFixed(2)).join(",")}`).join(" ") + (close ? " Z" : "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1200" viewBox="0 0 1920 1200"><rect width="1920" height="1200" fill="white"/><style>text{font-family:Arial,sans-serif;fill:#222}</style><text x="40" y="40" font-size="26">Route comparison on approximate crown centres</text>${(["A", "B"] as const).map((id, i) => `<g transform="translate(${i * 950},0)"><text x="60" y="88" font-size="22">${id}: ${id === "A" ? "Nearest neighbour" : "Nearest neighbour + 2-opt"} · ${routes[id].lengthM.toFixed(1)} m</text><path d="${set.area.coordinates.map((ring) => path(ring, true)).join(" ")}" fill="#f3f6f0" fill-rule="evenodd" stroke="#666" stroke-width="2"/><path d="${path(routes[id].coordinates)}" fill="none" stroke="${id === "A" ? "#d27b00" : "#087dad"}" stroke-width="2"/>${set.points.map((p) => { const [x, y] = pixel(p.coordinate); return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5" fill="#264c16"/>`; }).join("")}<path d="M${pixel(set.home)[0] - 7},${pixel(set.home)[1]}h14m-7,-7v14" stroke="#b80000" stroke-width="3"/><text x="60" y="1110" font-size="18">${set.points.length} points · home marked + · local metric projection</text></g>`).join("")}<text x="40" y="1170" font-size="17">Approximate image-derived centres, manually editable. Straight-line study tours; no obstacle avoidance or flight validation.</text></svg>`;
}
