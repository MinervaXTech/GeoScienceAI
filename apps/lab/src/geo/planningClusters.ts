import type { FeatureCollection, LineString, MultiPolygon, Point, Polygon } from "geojson";
import polygonClipping from "polygon-clipping";
import proj4 from "proj4";
import { inPlanningArea, metricFrame, PLANNING_POINT_LIMIT, type LngLat, type PlanningPoints } from "./planningPoints";
import { roadReference, type RoadReference } from "./roadReference";

export type ClusterMethod = "normal" | "elevation" | "concentrated";
export const CLUSTER_METHODS: ClusterMethod[] = ["normal", "elevation", "concentrated"];
/** Start points: always one of the cluster's own border points, nearest the road reference. `together` lets neighbouring clusters pick starts close to each other, within `flexibilityM` of their best road distance. */
export interface StartSettings { enabled: boolean; together: boolean; flexibilityM: number }
export const DEFAULT_START_SETTINGS: StartSettings = { enabled: true, together: false, flexibilityM: 20 };
export interface ClusterSettings { mode: "target" | "range"; target: number; tolerance: number; min: number; max: number; method?: ClusterMethod; start?: StartSettings; elevationWeight?: number }
export const DEFAULT_CLUSTER_SETTINGS: ClusterSettings = { mode: "target", target: 50, tolerance: 5, min: 40, max: 60, method: "normal", start: DEFAULT_START_SETTINGS };
/** Settings saved before start points existed load with them off, so old results stay valid. */
export const startSettings = (settings: ClusterSettings): StartSettings => settings.start ?? { ...DEFAULT_START_SETTINGS, enabled: false };
export const clusterMethod = (settings: ClusterSettings): ClusterMethod => settings.method ?? "normal";
export interface PlanningCluster { id: string; pointIds: string[]; center: LngLat; geometry: MultiPolygon; color: string; heightM?: { min: number; max: number }; start?: { pointId: string; coordinate: LngLat; roadDistanceM: number } }
export interface PlanningClusters { version: 1; mapId: string; sourceKey: string; settings: ClusterSettings; createdAt: string; clusters: PlanningCluster[]; road?: { source: RoadReference["source"]; label: string; key: string } }
export function clusterLimits(settings: ClusterSettings) {
  if (!settings || !["target", "range"].includes(settings.mode)) throw Error("Choose target count or count range.");
  if (settings.elevationWeight !== undefined && (!Number.isFinite(settings.elevationWeight) || settings.elevationWeight < 0.1 || settings.elevationWeight > 2)) throw Error("Choose an elevation weight from 0.1 to 2.");
  const st = settings.start;
  if (st !== undefined && (typeof st.enabled !== "boolean" || typeof st.together !== "boolean" || !Number.isFinite(st.flexibilityM) || st.flexibilityM < 0 || st.flexibilityM > 1000)) throw Error("Choose an allowed extra road distance from 0–1000 m for start points.");
  if (settings.method !== undefined && !CLUSTER_METHODS.includes(settings.method)) throw Error("Choose normal, elevation or concentrated grouping.");
  const integer = (v: number) => Number.isInteger(v) && v >= 1 && v <= PLANNING_POINT_LIMIT;
  if (settings.mode === "target") {
    if (!integer(settings.target) || !Number.isInteger(settings.tolerance) || settings.tolerance < 0 || settings.tolerance >= settings.target) throw Error("Use a target from 1–5000 and a tolerance smaller than the target.");
    return { min: settings.target - settings.tolerance, max: Math.min(PLANNING_POINT_LIMIT, settings.target + settings.tolerance), target: settings.target };
  }
  if (!integer(settings.min) || !integer(settings.max) || settings.min > settings.max) throw Error("Use a minimum and maximum from 1–5000, with minimum ≤ maximum.");
  return { min: settings.min, max: settings.max, target: (settings.min + settings.max) / 2 };
}
export function clusterPlan(total: number, settings: ClusterSettings) {
  const { min, max, target } = clusterLimits(settings);
  if (!Number.isInteger(total) || total < 1 || total > PLANNING_POINT_LIMIT) throw Error("Create between 1 and 5000 planning points first.");
  const fewest = Math.ceil(total / max), most = Math.floor(total / min);
  if (fewest > most) throw Error(`${total} points cannot all fit into clusters of ${min}–${max}. Widen the range or increase the tolerance; no points will be omitted.`);
  const count = Math.max(fewest, Math.min(most, Math.round(total / target)));
  return { count, min, max, smallest: Math.floor(total / count), largest: Math.ceil(total / count) };
}
export const clusterSourceKey = (set: PlanningPoints) => JSON.stringify([set.mapId, set.area, set.exclusions ?? [], set.minSpacingM, set.points.map(p => [p.id, ...p.coordinate]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
type XY = [number, number];
type Cell = [number, number, number, number];
const hull = (points: XY[]): XY[] => {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: XY[]) => { const chain: XY[] = []; for (const p of list) { while (chain.length > 1 && cross(chain.at(-2)!, chain.at(-1)!, p) <= 0) chain.pop(); chain.push(p); } return chain.slice(0, -1); };
  const ring = [...half(sorted), ...half(sorted.toReversed())];
  return [...ring, ring[0]!];
};
/** Elevation grouping: how much a point prefers a touching cluster of similar smoothed CHMv2 height. One height SD counts as this many cluster radii of distance. */
export const DEFAULT_ELEVATION_WEIGHT = 1;
const palette = ["#00d4ff", "#ffb000", "#d79bff", "#76ed5c", "#ff729b", "#56e0c5", "#ff8b4c", "#a3b8ff"];

/** Count-constrained spatial bisection. All IDs are assigned; no outlier/noise class. */
const metricPositions = (set: PlanningPoints) => { const m = metricFrame(set.area); return { m, at: new Map(set.points.map(p => { const q = m(p.coordinate); return [p.id, [q.x, q.y] as XY]; })) }; };
export function medianNearest(xy: XY[]): number {
  const nearest = xy.map((a, i) => { let best = Infinity; for (let j = 0; j < xy.length; j++) if (j !== i) { const d = Math.hypot(a[0] - xy[j]![0], a[1] - xy[j]![1]); if (d > 1e-9 && d < best) best = d; } return best; }).filter(Number.isFinite).sort((a, b) => a - b);
  return nearest[Math.floor(nearest.length / 2)] ?? 0;
}
/** Neighbour reach for border tests: just over one point spacing, from the set's own median nearest-neighbour distance. */
export function borderRadius(xy: XY[]): number { return Math.max(1, 1.8 * medianNearest(xy)); }
/** A member is a border point when it has fewer than three neighbours within reach, or an empty gap of 100° or more around it. */
export function clusterBorderIds(at: Map<string, XY>, ids: string[], radius: number): Set<string> {
  const border = new Set<string>();
  for (const id of ids) {
    const a = at.get(id)!, angles: number[] = [];
    for (const other of ids) { if (other === id) continue; const b = at.get(other)!, d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d > 1e-9 && d <= radius) angles.push(Math.atan2(b[1] - a[1], b[0] - a[0])); }
    if (angles.length < 3) { border.add(id); continue; }
    angles.sort((x, y) => x - y);
    let gap = angles[0]! + 2 * Math.PI - angles.at(-1)!;
    for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i]! - angles[i - 1]!);
    if (gap >= 100 * Math.PI / 180) border.add(id);
  }
  return border;
}
function distanceToLines(p: XY, segments: Float64Array): number {
  let best = Infinity;
  for (let i = 0; i < segments.length; i += 4) {
    const x1 = segments[i]!, y1 = segments[i + 1]!, dx = segments[i + 2]! - x1, dy = segments[i + 3]! - y1, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (x1 + t * dx), p[1] - (y1 + t * dy)));
  }
  return best;
}

/** Half-plane clip of a convex polygon (Sutherland–Hodgman): keeps the side where (q - mid)·dir <= 0. */
function clipHalfPlane(poly: XY[], mid: XY, dir: XY): XY[] {
  const side = (q: XY) => (q[0] - mid[0]) * dir[0] + (q[1] - mid[1]) * dir[1], out: XY[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!, sa = side(a), sb = side(b);
    if (sa <= 0) out.push(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
/** Each point's territory: the area nearer to it than to any other planning point, capped at `reach` so empty ground is not claimed. Territories tile without overlapping. */
function territories(xy: XY[], reach: number): XY[][] {
  return xy.map((a, i) => {
    let cell: XY[] = Array.from({ length: 8 }, (_, k) => [a[0] + reach * Math.cos(k * Math.PI / 4 + Math.PI / 8) / Math.cos(Math.PI / 8), a[1] + reach * Math.sin(k * Math.PI / 4 + Math.PI / 8) / Math.cos(Math.PI / 8)] as XY);
    const near = xy.map((b, j) => ({ j, d: Math.hypot(b[0] - a[0], b[1] - a[1]) })).filter(n => n.j !== i && n.d > 1e-9 && n.d <= 2.2 * reach).sort((x, y) => x.d - y.d).slice(0, 14);
    for (const { j } of near) { const b = xy[j]!; cell = clipHalfPlane(cell, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [b[0] - a[0], b[1] - a[1]]); if (cell.length < 3) break; }
    return cell;
  });
}
/** `heights` maps point ID to the CHMv2 height sampled at that point's own coordinate; elevation grouping needs one for every point. */
export function createPlanningClusters(set: PlanningPoints, settings: ClusterSettings, heights: Record<string, number> = {}, road?: RoadReference): PlanningClusters {
  const plan = clusterPlan(set.points.length, settings);
  const ids = new Set(set.points.map(p => p.id));
  if (ids.size !== set.points.length || set.points.some(p => !p.id || p.coordinate.length !== 2 || !p.coordinate.every(Number.isFinite))) throw Error("Planning points need unique IDs and finite coordinates.");
  if (set.points.some(p => !inPlanningArea(set.area, p.coordinate) || set.exclusions?.some(area => inPlanningArea(area, p.coordinate)))) throw Error("Some planning points lie outside the planning polygon or inside an exclusion. Update the points before clustering; none will be silently omitted.");
  const origin = set.area.coordinates[0]![0]!;
  const frame = proj4("EPSG:4326", `+proj=aeqd +lat_0=${origin[1]} +lon_0=${origin[0]} +datum=WGS84 +units=m +no_defs`);
  const project = (p: number[]) => frame.forward(p) as XY;
  const unproject = (p: XY) => frame.inverse(p) as LngLat;
  const points = set.points.map(p => ({ id: p.id, xy: project(p.coordinate), coordinate: p.coordinate, z: 0 }));
  if (points.some(p => !p.xy.every(Number.isFinite))) throw Error("Point coordinates cannot be projected for clustering.");
  const area = set.area.coordinates.map(ring => ring.map(project));
  const exclusions = (set.exclusions ?? []).map(p => p.coordinates.map(ring => ring.map(project)));
  const clip = exclusions.length ? polygonClipping.difference(area, ...exclusions) : [area];
  const radius = Math.max(.25, Math.min(3, set.minSpacingM / 3));
  const bounds: Cell = [Math.min(...points.map(p => p.xy[0])) - radius * 2, Math.min(...points.map(p => p.xy[1])) - radius * 2, Math.max(...points.map(p => p.xy[0])) + radius * 2, Math.max(...points.map(p => p.xy[1])) + radius * 2];
  const sizes = Array.from({ length: plan.count }, (_, i) => plan.smallest + (i < set.points.length % plan.count ? 1 : 0));
  const method = clusterMethod(settings);
  type Member = (typeof points)[number];
  type Leaf = { members: Member[]; cell: Cell };
  const leaves: Leaf[] = [];
  const divide = (members: Member[], counts: number[], cell: Cell) => {
    if (counts.length > 1) {
      // Split along whichever of east, north or (elevation only) scaled height spreads most.
      const value = (p: Member, axis: number) => axis === 2 ? p.z : p.xy[axis]!;
      const spread = [0, 1, 2].map(axis => { const v = members.map(p => value(p, axis)); return Math.max(...v) - Math.min(...v); });
      const axis = spread[2]! > spread[0]! && spread[2]! > spread[1]! ? 2 : spread[0]! >= spread[1]! ? 0 : 1;
      const rest = [0, 1, 2].filter(a => a !== axis);
      const ordered = [...members].sort((a, b) => value(a, axis) - value(b, axis) || value(a, rest[0]!) - value(b, rest[0]!) || value(a, rest[1]!) - value(b, rest[1]!) || a.id.localeCompare(b.id));
      const half = Math.floor(counts.length / 2), leftCount = counts.slice(0, half).reduce((a, b) => a + b, 0);
      const left: Cell = [...cell], right: Cell = [...cell];
      if (axis < 2) { const cut = (value(ordered[leftCount - 1]!, axis) + value(ordered[leftCount]!, axis)) / 2; left[axis + 2] = cut; right[axis] = cut; }
      divide(ordered.slice(0, leftCount), counts.slice(0, half), left);
      divide(ordered.slice(leftCount), counts.slice(half), right);
      return;
    }
    leaves.push({ members, cell });
  };

  const heightOf = new Map<string, number>();
  if (method === "elevation") {
    const missing = points.filter(p => !Number.isFinite(heights[p.id]));
    if (missing.length) throw Error(`CHMv2 has no height at ${missing.length.toLocaleString()} of ${points.length.toLocaleString()} planning points (${missing.slice(0, 5).map(p => p.id).join(", ")}${missing.length > 5 ? ", …" : ""}). Elevation grouping uses only CHMv2 values at each point's own location, so use another method or move those points onto CHMv2 coverage.`);
    for (const p of points) heightOf.set(p.id, heights[p.id]!);
    // Start from compact spatial groups. Raw CHMv2 jumps from tree to tree, so each point's height is averaged over its surroundings, then the
    // refinement below lets points trade places only with touching clusters, preferring neighbours of a similar height.
    divide(points, sizes, bounds);
    const reachM = 3 * medianNearest(points.map(p => p.xy)), raw = points.map(p => heightOf.get(p.id)!);
    const smooth = points.map((a, i) => { let sum = 0, n = 0; for (let j = 0; j < points.length; j++) if (Math.hypot(a.xy[0] - points[j]!.xy[0], a.xy[1] - points[j]!.xy[1]) <= reachM) { sum += raw[j]!; n++; } return n ? sum / n : raw[i]!; });
    const mean = smooth.reduce((a, b) => a + b, 0) / smooth.length, sd = Math.max(.5, Math.sqrt(smooth.reduce((a, b) => a + (b - mean) ** 2, 0) / smooth.length));
    // One standard deviation of height counts like (weight × cluster radius) of distance, so position always dominates at low weight.
    const clusterRadius = medianNearest(points.map(p => p.xy)) * Math.sqrt(points.length / plan.count / Math.PI);
    points.forEach((p, i) => { p.z = (smooth[i]! - mean) / sd * (settings.elevationWeight ?? DEFAULT_ELEVATION_WEIGHT) * clusterRadius; });
  } else divide(points, sizes, bounds);

  // Concentrated and elevation: start from the balanced split, then move or swap single points so each sits with its nearest group centre
  // (elevation adds a height term). A point may only join a cluster that actually touches it, so nothing jumps to another area.
  if ((method === "concentrated" || method === "elevation") && leaves.length > 1) {
    const k = leaves.length, n = points.length, index = new Map(points.map((p, i) => [p.id, i]));
    const touch = 2.5 * medianNearest(points.map(p => p.xy));
    const owner = new Int32Array(n), sum = leaves.map(() => [0, 0, 0] as [number, number, number]), size = new Int32Array(k), groups = leaves.map(() => new Set<number>());
    leaves.forEach((leaf, g) => leaf.members.forEach(m => { const i = index.get(m.id)!; owner[i] = g; groups[g]!.add(i); sum[g]![0] += m.xy[0]; sum[g]![1] += m.xy[1]; sum[g]![2] += m.z; size[g]!++; }));
    const d2 = (i: number, g: number) => (points[i]!.xy[0] - sum[g]![0] / size[g]!) ** 2 + (points[i]!.xy[1] - sum[g]![1] / size[g]!) ** 2 + (points[i]!.z - sum[g]![2] / size[g]!) ** 2;
    const touches = (i: number, g: number) => { for (const j of groups[g]!) if (j !== i && Math.hypot(points[i]!.xy[0] - points[j]!.xy[0], points[i]!.xy[1] - points[j]!.xy[1]) <= touch) return true; return false; };
    const move = (i: number, from: number, to: number) => { const [x, y] = points[i]!.xy; groups[from]!.delete(i); groups[to]!.add(i); sum[from]![0] -= x; sum[from]![1] -= y; sum[from]![2] -= points[i]!.z; sum[to]![0] += x; sum[to]![1] += y; sum[to]![2] += points[i]!.z; size[from]!--; size[to]!++; owner[i] = to; };
    const centre = (g: number): XY => [sum[g]![0] / size[g]!, sum[g]![1] / size[g]!];
    const near = Array.from({ length: k }, (_, g) => Array.from({ length: k }, (_, h) => h).filter(h => h !== g)
      .sort((a, b) => Math.hypot(centre(a)[0] - centre(g)[0], centre(a)[1] - centre(g)[1]) - Math.hypot(centre(b)[0] - centre(g)[0], centre(b)[1] - centre(g)[1])).slice(0, 8));
    for (let pass = 0; pass < 40; pass++) {
      let changed = 0;
      for (let i = 0; i < n; i++) {
        const a = owner[i]!, da = d2(i, a);
        let b = -1, db = da - 1e-6;
        for (const h of near[a]!) { const d = d2(i, h); if (d < db && touches(i, h)) { db = d; b = h; } }
        if (b < 0) continue;
        if (size[b]! < plan.max && size[a]! > plan.min) { move(i, a, b); changed++; continue; }
        let swap = -1, best = 1e-6 - (da - db);
        for (const q of groups[b]!) { const gain = d2(q, b) - d2(q, a); if (gain > best && touches(q, a)) { best = gain; swap = q; } }
        if (swap >= 0) { move(i, a, b); move(swap, b, a); changed++; }
      }
      if (!changed) break;
    }
    groups.forEach((g, i) => { leaves[i]!.members = [...g].sort((x, y) => x - y).map(j => points[j]!); });
  }

  const clusters: PlanningCluster[] = [];
  const cellOf = new Map<string, XY[]>();
  if (method !== "normal") { const cells = territories(points.map(p => p.xy), Math.max(radius, medianNearest(points.map(p => p.xy))) * 1.1); points.forEach((p, i) => cellOf.set(p.id, cells[i]!.length >= 3 ? cells[i]! : [[p.xy[0] - radius, p.xy[1] - radius], [p.xy[0] + radius, p.xy[1] - radius], [p.xy[0] + radius, p.xy[1] + radius], [p.xy[0] - radius, p.xy[1] + radius]])); }
  for (const { members, cell } of leaves) {
    let geometry: polygonClipping.MultiPolygon;
    if (method === "normal") {
      const expanded = members.flatMap(p => Array.from({ length: 8 }, (_, i): XY => [p.xy[0] + radius * Math.cos(i * Math.PI / 4), p.xy[1] + radius * Math.sin(i * Math.PI / 4)]));
      const [x0, y0, x1, y1] = cell;
      // Coincident points can share a dividing edge; IDs still have one owner.
      const epsilon = .02;
      const rectangle: XY[] = [[x0 - epsilon, y0 - epsilon], [x1 + epsilon, y0 - epsilon], [x1 + epsilon, y1 + epsilon], [x0 - epsilon, y1 + epsilon], [x0 - epsilon, y0 - epsilon]];
      geometry = polygonClipping.intersection([hull(expanded)], [rectangle], clip);
    } else {
      // One outline per cluster: merge the territories of its points (no overlap with neighbouring clusters), then drop interior gaps.
      const polys = members.map(p => { const c = cellOf.get(p.id)!, ring = [...c, c[0]!].map((v): XY => [Math.round((p.xy[0] + (v[0] - p.xy[0]) * 1.01) * 100) / 100, Math.round((p.xy[1] + (v[1] - p.xy[1]) * 1.01) * 100) / 100]); return [ring] as polygonClipping.Polygon; });
      // If the polygon library cannot merge an unusual shape, fall back to one hull around the cluster's territories.
      let merged: polygonClipping.MultiPolygon;
      try { merged = polygonClipping.union(polys[0]!, ...polys.slice(1)); } catch { merged = [[hull(polys.flatMap(poly => poly[0]!))]]; }
      geometry = polygonClipping.intersection(merged.map(poly => [poly[0]!] as polygonClipping.Polygon), clip);
    }
    if (!geometry.length) throw Error("A cluster falls outside the planning area or within an exclusion. Fix the planning points and try again; no partial result was saved.");
    const mean: XY = [members.reduce((s, p) => s + p.xy[0], 0) / members.length, members.reduce((s, p) => s + p.xy[1], 0) / members.length];
    const nearest = [...members].sort((a, b) => Math.hypot(a.xy[0] - mean[0], a.xy[1] - mean[1]) - Math.hypot(b.xy[0] - mean[0], b.xy[1] - mean[1]))[0]!;
    const geographic = geometry.map(p => p.map(ring => ring.map(unproject)));
    const bounded = polygonClipping.intersection(geographic, set.area.coordinates as polygonClipping.Polygon);
    const final = set.exclusions?.length ? polygonClipping.difference(bounded, ...set.exclusions.map(p => p.coordinates as polygonClipping.Polygon)) : bounded;
    if (!final.length) throw Error("A cluster boundary could not be drawn. No partial result was saved.");
    const heights = method === "elevation" ? members.map(p => heightOf.get(p.id)!) : [];
    clusters.push({ id: `C${String(clusters.length + 1).padStart(2, "0")}`, pointIds: members.map(p => p.id).sort(), center: nearest.coordinate, color: palette[clusters.length % palette.length]!, geometry: { type: "MultiPolygon", coordinates: final }, ...(heights.length ? { heightM: { min: Math.min(...heights), max: Math.max(...heights) } } : {}) });
  }
  const start = startSettings(settings);
  let usedRoad: PlanningClusters["road"];
  if (start.enabled) {
    const ref = road ?? roadReference(set.area, null, set.mapId), { m, at } = metricPositions(set), reach = borderRadius([...at.values()]);
    const segments = new Float64Array(ref.lines.reduce((n, line) => n + Math.max(0, line.length - 1) * 4, 0));
    let k = 0;
    for (const line of ref.lines) for (let i = 1; i < line.length; i++) { const a = m(line[i - 1]!), b = m(line[i]!); segments.set([a.x, a.y, b.x, b.y], k); k += 4; }
    if (!k) throw Error("The road reference has no usable lines, so start points could not be placed.");
    const coordinateOf = new Map(set.points.map(p => [p.id, p.coordinate]));
    // Candidates are border points only; the road distance of each is measured from its own location.
    const candidates = clusters.map(c => { const border = [...clusterBorderIds(at, c.pointIds, reach)].sort(), scored = border.map(id => ({ id, d: distanceToLines(at.get(id)!, segments) })).sort((a, b) => a.d - b.d || a.id.localeCompare(b.id)); return scored; });
    const chosen: { id: string; d: number }[] = new Array(clusters.length);
    const order = clusters.map((_, i) => i).sort((a, b) => candidates[a]![0]!.d - candidates[b]![0]!.d || a - b), taken: XY[] = [];
    for (const i of order) {
      const list = candidates[i]!, best = list[0]!;
      let pick = best;
      if (start.together && taken.length) {
        const allowed = list.filter(c => c.d <= best.d + start.flexibilityM);
        const near = (id: string) => Math.min(...taken.map(t => Math.hypot(t[0] - at.get(id)![0], t[1] - at.get(id)![1])));
        pick = allowed.map(c => ({ c, n: near(c.id) })).sort((a, b) => a.n - b.n || a.c.d - b.c.d || a.c.id.localeCompare(b.c.id))[0]!.c;
      }
      chosen[i] = pick; taken.push(at.get(pick.id)!);
    }
    clusters.forEach((c, i) => { c.start = { pointId: chosen[i]!.id, coordinate: coordinateOf.get(chosen[i]!.id)!, roadDistanceM: Math.round(chosen[i]!.d * 10) / 10 }; });
    usedRoad = { source: ref.source, label: ref.label, key: ref.key };
  }
  const result: PlanningClusters = { version: 1, mapId: set.mapId, sourceKey: clusterSourceKey(set), settings: { ...settings, method }, createdAt: new Date().toISOString(), clusters, ...(usedRoad ? { road: usedRoad } : {}) };
  assertPlanningClusters(set, result);
  return result;
}

export function assertPlanningClusters(set: PlanningPoints, result: PlanningClusters) {
  if (result.version !== 1 || result.mapId !== set.mapId || result.sourceKey !== clusterSourceKey(set) || !Array.isArray(result.clusters)) throw Error("Clusters belong to an earlier point set. Generate clusters again.");
  const plan = clusterPlan(set.points.length, result.settings), remaining = new Set(set.points.map(p => p.id)), groupIds = new Set<string>();
  if (remaining.size !== set.points.length || result.clusters.length !== plan.count) throw Error("Cluster membership is incomplete or duplicated.");
  const frame = startSettings(result.settings).enabled ? (() => { const { at } = metricPositions(set); return { at, reach: borderRadius([...at.values()]) }; })() : null;
  for (const c of result.clusters) {
    if (typeof c.id !== "string" || groupIds.has(c.id) || !Array.isArray(c.pointIds) || !Array.isArray(c.center) || c.center.length !== 2 || !c.center.every(Number.isFinite) || !/^#[0-9a-f]{6}$/i.test(c.color) || c.pointIds.length < plan.min || c.pointIds.length > plan.max || c.geometry?.type !== "MultiPolygon" || !c.geometry.coordinates.length || c.geometry.coordinates.some(p => !p.length || p.some(ring => ring.length < 4 || ring.some(p => p.length !== 2 || !p.every(Number.isFinite))))) throw Error("Invalid cluster counts or boundaries.");
    if (frame && (!c.start || !c.pointIds.includes(c.start.pointId) || !Number.isFinite(c.start.roadDistanceM) || !clusterBorderIds(frame.at, c.pointIds, frame.reach).has(c.start.pointId))) throw Error("A cluster start point is missing or is not on its cluster border.");
    groupIds.add(c.id);
    for (const id of c.pointIds) if (!remaining.delete(id)) throw Error("A point is missing, duplicated or unknown in the cluster membership.");
  }
  if (remaining.size) throw Error(`${remaining.size} planning points were not assigned.`);
}
export function planningClusterFeatures(result: PlanningClusters | null, road?: RoadReference | null): FeatureCollection<MultiPolygon | Point | LineString> {
  const features: FeatureCollection<MultiPolygon | Point | LineString>["features"] = result ? result.clusters.flatMap(c => {
    const properties = { clusterId: c.id, count: c.pointIds.length, color: c.color, label: `${c.id} · ${c.pointIds.length}${c.heightM ? ` · ${c.heightM.min.toFixed(0)}–${c.heightM.max.toFixed(0)} m` : ""}` };
    return [
      { type: "Feature" as const, properties: { ...properties, kind: "cluster-boundary" }, geometry: c.geometry },
      { type: "Feature" as const, properties: { ...properties, kind: "cluster-label" }, geometry: { type: "Point" as const, coordinates: c.center } },
      ...(c.start ? [{ type: "Feature" as const, properties: { ...properties, kind: "cluster-start", label: `${c.id} start · ${c.start.roadDistanceM} m from road` }, geometry: { type: "Point" as const, coordinates: c.start.coordinate } }] : []),
    ];
  }) : [];
  // Show what the starts were measured against, only when starts exist and the reference is still the one they used.
  if (result?.road && road && road.key === result.road.key) for (const line of road.lines.slice(0, 2000)) features.push({ type: "Feature", properties: { kind: "road-reference" }, geometry: { type: "LineString", coordinates: line } });
  return { type: "FeatureCollection", features };
}
export function clusterAssignments(result: PlanningClusters | null) {
  return new Map(result?.clusters.flatMap(c => c.pointIds.map(id => [id, { clusterId: c.id, clusterColor: c.color }] as const)) ?? []);
}
export function clusterExport(set: PlanningPoints, result: PlanningClusters) {
  assertPlanningClusters(set, result);
  const membership = clusterAssignments(result), starts = new Set(result.clusters.flatMap(c => c.start ? [c.start.pointId] : []));
  return { ...planningClusterFeatures(result), features: [...planningClusterFeatures(result).features.filter(f => f.properties!.kind === "cluster-boundary"), ...set.points.map(p => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: p.coordinate }, properties: { ...p, ...membership.get(p.id), clusterStart: starts.has(p.id), kind: "planning-point", approximate: true } }))], clustering: { settings: result.settings, mapId: result.mapId, createdAt: result.createdAt, totalPoints: set.points.length, unassigned: 0, note: "Spatial planning groups; boundaries are drawn envelopes, not detected tree boundaries." } };
}
export function clusterCsv(set: PlanningPoints, result: PlanningClusters) {
  assertPlanningClusters(set, result); const membership = clusterAssignments(result), starts = new Set(result.clusters.flatMap(c => c.start ? [c.start.pointId] : []));
  return ["point_id,cluster_id,longitude,latitude,is_start", ...set.points.map(p => [p.id, membership.get(p.id)!.clusterId, ...p.coordinate, starts.has(p.id)].map(v => `"${String(v).replaceAll('"', '""')}"`).join(","))].join("\n");
}
export function clusterFocusArea(cluster: PlanningCluster): Polygon {
  const points = cluster.geometry.coordinates.flat(2), xs = points.map(p => p[0]!), ys = points.map(p => p[1]!);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] };
}
