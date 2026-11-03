import { describe, expect, it } from "vitest";
import polygonClipping from "polygon-clipping";
import type { Polygon } from "geojson";
import { borderRadius, medianNearest, clusterBorderIds, assertPlanningClusters, clusterCsv, clusterExport, clusterPlan, createPlanningClusters, DEFAULT_CLUSTER_SETTINGS } from "./planningClusters";
import { inPlanningArea, metricFrame, type PlanningPoints } from "./planningPoints";
import { roadReference, type RoadReference } from "./roadReference";
const area: Polygon = { type: "Polygon", coordinates: [[[103, 2], [103.02, 2], [103.02, 2.02], [103, 2.02], [103, 2]]] };
const set = (n: number): PlanningPoints => ({ version: 1, mapId: "field", area, points: Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}`, source: "manual", coordinate: [103.0001 + (i % 70) * .0002, 2.0001 + Math.floor(i / 70) * .0002] })), home: [103.001, 2.001], minSpacingM: 4, createdAt: "2026-11-03", sourceResultAt: "" });
const settings = { ...DEFAULT_CLUSTER_SETTINGS };
describe("count-constrained spatial clustering", () => {
  it("includes all 3162 points once, meets the target band and includes every point in its drawn boundary", () => {
    const points = set(3162), result = createPlanningClusters(points, settings);
    expect(result.clusters).toHaveLength(63);
    expect(result.clusters.every(c => c.pointIds.length === 50 || c.pointIds.length === 51)).toBe(true);
    const ids = result.clusters.flatMap(c => c.pointIds);
    expect(new Set(ids).size).toBe(3162);
    expect(ids.toSorted()).toEqual(points.points.map(p => p.id).toSorted());
    const lookup = new Map(points.points.map(p => [p.id, p.coordinate]));
    for (const c of result.clusters) for (const id of c.pointIds) expect(c.geometry.coordinates.some(coordinates => inPlanningArea({ type: "Polygon", coordinates }, lookup.get(id)!)), `${c.id} / ${id}`).toBe(true);
    expect(() => assertPlanningClusters(points, result)).not.toThrow();
  });
  it("handles singletons, two-point groups, duplicates at one coordinate and collinear points", () => {
    for (const n of [1, 2, 5, 10]) {
      const points = set(n);
      const result = createPlanningClusters(points, { ...settings, mode: "range", min: 1, max: 2 });
      expect(result.clusters.flatMap(c => c.pointIds)).toHaveLength(n);
      expect(result.clusters.every(c => c.geometry.coordinates.length > 0)).toBe(true);
    }
    const points = set(4); points.points.forEach(p => { p.coordinate = [103.001, 2.001]; });
    expect(createPlanningClusters(points, { ...settings, target: 2, tolerance: 0 }).clusters.map(c => c.pointIds.length)).toEqual([2, 2]);
  });
  it("rejects impossible counts without relaxing bounds, and rejects invalid settings or IDs", () => {
    expect(() => clusterPlan(101, { ...settings, target: 50, tolerance: 0 })).toThrow(/Widen/);
    expect(() => clusterPlan(12, settings)).toThrow(/cannot all fit/);
    expect(clusterPlan(12, { ...settings, mode: "range", min: 3, max: 5 })).toMatchObject({ count: 3, smallest: 4, largest: 4 });
    for (const invalid of [{ target: 0 }, { tolerance: -1 }, { tolerance: 50 }, { target: 3.5 }, { mode: "range" as const, min: 8, max: 7 }]) expect(() => clusterPlan(100, { ...settings, ...invalid })).toThrow();
    const points = set(100); points.points[1]!.id = points.points[0]!.id;
    expect(() => createPlanningClusters(points, settings)).toThrow(/unique/);
  });
  it("clips polygon holes and exclusions while keeping all valid members", () => {
    const points = set(140);
    const hole = [[103.0005, 2.00015], [103.0006, 2.00015], [103.0006, 2.0002], [103.0005, 2.0002], [103.0005, 2.00015]];
    points.area = { type: "Polygon", coordinates: [...area.coordinates, hole] };
    points.exclusions = [{ type: "Polygon", coordinates: [[[103.0008, 2.00015], [103.0009, 2.00015], [103.0009, 2.0002], [103.0008, 2.0002], [103.0008, 2.00015]]] }];
    const result = createPlanningClusters(points, settings);
    for (const c of result.clusters) {
      expect(polygonClipping.intersection(c.geometry.coordinates as polygonClipping.MultiPolygon, [hole] as polygonClipping.Polygon)).toEqual([]);
      expect(polygonClipping.intersection(c.geometry.coordinates as polygonClipping.MultiPolygon, points.exclusions[0]!.coordinates as polygonClipping.Polygon)).toEqual([]);
    }
    points.points[0]!.coordinate = [103.00055, 2.00018];
    expect(() => createPlanningClusters(points, settings)).toThrow(/none will be silently omitted/);
  });
  it("exports exact membership and detects changed coordinates, duplicates and missing members", () => {
    const points = set(101), result = createPlanningClusters(points, settings);
    const exported = clusterExport(points, result);
    expect(exported.features.filter(f => f.properties?.kind === "planning-point")).toHaveLength(101);
    expect(exported.clustering.unassigned).toBe(0);
    expect(clusterCsv(points, result).split("\n")).toHaveLength(102);
    const changed = structuredClone(points); changed.points[0]!.coordinate[0] += .000001;
    expect(() => assertPlanningClusters(changed, result)).toThrow(/earlier/);
    const duplicate = structuredClone(result); duplicate.clusters[1]!.pointIds[0] = duplicate.clusters[0]!.pointIds[0]!;
    expect(() => assertPlanningClusters(points, duplicate)).toThrow(/duplicated/);
    const missing = structuredClone(result); missing.clusters[0]!.pointIds.pop();
    expect(() => assertPlanningClusters(points, missing)).toThrow();
    const shuffled = { ...points, points: [...points.points].reverse() };
    expect(createPlanningClusters(shuffled, settings).clusters).toEqual(result.clusters);
  });
  describe("grouping methods", () => {
    // Heights as sampled from CHMv2 at each point's own coordinate, keyed by point ID.
    const chm = (points: PlanningPoints) => Object.fromEntries(points.points.map((p, i) => [p.id, 10 + (i % 70) * .3 + Math.floor(i / 70) * .05]));
    const withHeights = (n: number) => set(n);
    const spread = (points: PlanningPoints, groups: string[][]) => {
      const xy = new Map(points.points.map(p => [p.id, p.coordinate]));
      return groups.reduce((total, ids) => { const cx = ids.reduce((a, id) => a + xy.get(id)![0], 0) / ids.length, cy = ids.reduce((a, id) => a + xy.get(id)![1], 0) / ids.length; return total + ids.reduce((a, id) => a + (xy.get(id)![0] - cx) ** 2 + (xy.get(id)![1] - cy) ** 2, 0); }, 0);
    };
    it("defaults to normal and accepts settings saved before methods existed", () => {
      const { method: _m, ...old } = settings; void _m;
      expect(createPlanningClusters(set(101), old).settings.method).toBe("normal");
      expect(() => clusterPlan(100, { ...settings, method: "random" as never })).toThrow(/normal, elevation or concentrated/);
    });
    it("elevation assigns every point once and narrows each group's CHMv2 height range", () => {
      const points = withHeights(3162), heights = chm(points), normal = createPlanningClusters(points, settings), result = createPlanningClusters(points, { ...settings, method: "elevation" }, heights);
      const ids = result.clusters.flatMap(c => c.pointIds);
      expect(new Set(ids).size).toBe(3162);
      expect(result.clusters.every(c => c.pointIds.length >= 45 && c.pointIds.length <= 55)).toBe(true);
      const range = (r: typeof result) => r.clusters.reduce((a, c) => { const h = c.pointIds.map(id => heights[id]!); return a + Math.max(...h) - Math.min(...h); }, 0) / r.clusters.length;
      expect(range(result)).toBeLessThanOrEqual(range(normal) * 1.05);
      expect(result.clusters.every(c => c.heightM && c.heightM.min <= c.heightM.max)).toBe(true);
      expect(() => assertPlanningClusters(points, result)).not.toThrow();
    });
    it("elevation keeps clusters as connected patches even when CHMv2 is noisy tree to tree", () => {
      const points = set(3162); let seed = 11; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
      const heights = Object.fromEntries(points.points.map((p, i) => [p.id, Math.max(0, 14 + 8 * Math.sin((i % 70) / 9) * Math.cos(Math.floor(i / 70) / 7) + (rnd() - .5) * 8)]));
      const normal = createPlanningClusters(points, settings), result = createPlanningClusters(points, { ...settings, method: "elevation" }, heights);
      expect(spread(points, result.clusters.map(c => c.pointIds))).toBeLessThan(spread(points, normal.clusters.map(c => c.pointIds)) * 1.3);
      const sd = (r: typeof result) => r.clusters.reduce((a, c) => { const h = c.pointIds.map(id => heights[id]!), m = h.reduce((x, y) => x + y, 0) / h.length; return a + Math.sqrt(h.reduce((x, y) => x + (y - m) ** 2, 0) / h.length); }, 0) / r.clusters.length;
      expect(sd(result)).toBeLessThan(sd(normal));
      // No jumping: every cluster is one connected piece (points within reach of a neighbour in the same cluster).
      const m = metricFrame(points.area), at = new Map(points.points.map(p => { const q = m(p.coordinate); return [p.id, [q.x, q.y] as [number, number]]; })), reachM = 2.5 * medianNearest([...at.values()]);
      for (const c of result.clusters) {
        const seen = new Set([c.pointIds[0]!]), queue = [c.pointIds[0]!];
        while (queue.length) { const a = queue.pop()!; for (const b of c.pointIds) if (!seen.has(b) && Math.hypot(at.get(a)![0] - at.get(b)![0], at.get(a)![1] - at.get(b)![1]) <= reachM) { seen.add(b); queue.push(b); } }
        expect(seen.size, c.id).toBe(c.pointIds.length);
      }
      expect(() => createPlanningClusters(points, { ...settings, method: "elevation", elevationWeight: 5 }, heights)).toThrow(/elevation weight/);
    });
    it("elevation uses only the supplied CHMv2 heights: stale stored heights are ignored and gaps are refused, not guessed", () => {
      const points = withHeights(300), heights = chm(points);
      points.points.forEach(p => { p.canopyHeightM = 99; });
      const result = createPlanningClusters(points, { ...settings, method: "elevation" }, heights);
      expect(Math.max(...result.clusters.map(c => c.heightM!.max))).toBeLessThan(40);
      const gap = { ...heights }; delete gap.P6; delete gap.P201;
      expect(() => createPlanningClusters(points, { ...settings, method: "elevation" }, gap)).toThrow(/no height at 2 of 300/);
      expect(() => createPlanningClusters(points, { ...settings, method: "elevation" })).toThrow(/CHMv2/);
    });
    it("coordinates never change with the method", () => {
      const points = withHeights(300), before = JSON.stringify(points.points.map(p => p.coordinate));
      for (const method of ["normal", "elevation", "concentrated"] as const) createPlanningClusters(points, { ...settings, method }, chm(points));
      expect(JSON.stringify(points.points.map(p => p.coordinate))).toBe(before);
    });
    it("concentrated keeps every point and count limit while tightening groups", () => {
      const points = set(3162), normal = createPlanningClusters(points, settings), result = createPlanningClusters(points, { ...settings, method: "concentrated" });
      const ids = result.clusters.flatMap(c => c.pointIds);
      expect(new Set(ids).size).toBe(3162);
      expect(result.clusters.every(c => c.pointIds.length >= 45 && c.pointIds.length <= 55)).toBe(true);
      expect(spread(points, result.clusters.map(c => c.pointIds))).toBeLessThanOrEqual(spread(points, normal.clusters.map(c => c.pointIds)));
      expect(() => assertPlanningClusters(points, result)).not.toThrow();
    });
    it("draws every member inside its boundary and handles one huge or many tiny groups", () => {
      const points = withHeights(400), heights = chm(points);
      for (const method of ["elevation", "concentrated"] as const) {
        const result = createPlanningClusters(points, { ...settings, method, mode: "range", min: 1, max: 400 }, heights);
        expect(result.clusters.flatMap(c => c.pointIds)).toHaveLength(400);
        const lookup = new Map(points.points.map(p => [p.id, p.coordinate]));
        for (const c of result.clusters) for (const id of c.pointIds) expect(c.geometry.coordinates.some(coordinates => inPlanningArea({ type: "Polygon", coordinates }, lookup.get(id)!))).toBe(true);
        expect(createPlanningClusters(points, { ...settings, method, mode: "range", min: 1, max: 1 }, heights).clusters).toHaveLength(400);
      }
    });
  }, 30000);
  describe("start points", () => {
    const southRoad: RoadReference = { source: "sam-road", label: "test road", lines: [[[102.99, 2.0], [103.03, 2.0]]], key: "k" };
    const frame = (points: PlanningPoints) => { const m = metricFrame(points.area); return new Map(points.points.map(p => { const q = m(p.coordinate); return [p.id, [q.x, q.y] as [number, number]]; })); };
    const reaches = new WeakMap<object, number>();
    const reach = (at: Map<string, [number, number]>) => reaches.get(at) ?? (reaches.set(at, borderRadius([...at.values()])), reaches.get(at)!);
    const roadDist = (at: Map<string, [number, number]>, id: string, m: ReturnType<typeof metricFrame>) => { const a = at.get(id)!, y = m([103, 2]).y; return Math.abs(a[1] - y); };

    it("puts every start on its own cluster's border, as the border point nearest the road", () => {
      const points = set(3162), m = metricFrame(points.area), at = frame(points), result = createPlanningClusters(points, { ...settings }, {}, southRoad);
      expect(result.clusters.every(c => c.start)).toBe(true);
      for (const c of result.clusters) {
        expect(c.pointIds).toContain(c.start!.pointId);
        const border = [...clusterBorderIds(at, c.pointIds, reach(at))];
        expect(border).toContain(c.start!.pointId);
        const best = Math.min(...border.map(id => roadDist(at, id, m)));
        expect(roadDist(at, c.start!.pointId, m)).toBeLessThanOrEqual(best + .2);
        // the start's road distance is truthful
        expect(Math.abs(c.start!.roadDistanceM - roadDist(at, c.start!.pointId, m))).toBeLessThan(.6);
      }
      expect(result.road).toMatchObject({ source: "sam-road" });
      expect(() => assertPlanningClusters(points, result)).not.toThrow();
    });
    it("never starts in the middle of a cluster", () => {
      const points = set(3162), at = frame(points);
      for (const method of ["normal", "concentrated"] as const) {
        const result = createPlanningClusters(points, { ...settings, method }, {}, southRoad);
        const interior = result.clusters.flatMap(c => { const border = clusterBorderIds(at, c.pointIds, reach(at)); return c.pointIds.filter(id => !border.has(id)); });
        expect(interior.length).toBeGreaterThan(0);
        expect(result.clusters.every(c => !interior.includes(c.start!.pointId))).toBe(true);
      }
    });
    it("optionally pulls neighbouring starts together without leaving borders or exceeding the road allowance", () => {
      const points = set(3162), at = frame(points), m = metricFrame(points.area);
      const plain = createPlanningClusters(points, { ...settings }, {}, southRoad);
      const together = createPlanningClusters(points, { ...settings, start: { enabled: true, together: true, flexibilityM: 30 } }, {}, southRoad);
      const nearest = (r: typeof plain) => r.clusters.reduce((total, c) => total + Math.min(...r.clusters.filter(o => o !== c).map(o => Math.hypot(at.get(o.start!.pointId)![0] - at.get(c.start!.pointId)![0], at.get(o.start!.pointId)![1] - at.get(c.start!.pointId)![1]))), 0);
      expect(nearest(together)).toBeLessThanOrEqual(nearest(plain));
      together.clusters.forEach((c, i) => {
        expect(clusterBorderIds(at, c.pointIds, reach(at))).toContain(c.start!.pointId);
        expect(roadDist(at, c.start!.pointId, m)).toBeLessThanOrEqual(roadDist(at, plain.clusters[i]!.start!.pointId, m) + 30 + .2);
      });
      expect(() => assertPlanningClusters(points, together)).not.toThrow();
    });
    it("can be turned off, old settings have none, and starts never alter point coordinates", () => {
      const points = set(200), before = JSON.stringify(points.points.map(p => p.coordinate));
      const off = createPlanningClusters(points, { ...settings, start: { enabled: false, together: false, flexibilityM: 20 } });
      expect(off.clusters.some(c => c.start)).toBe(false);
      const { start: _s, ...old } = settings; void _s;
      expect(createPlanningClusters(points, old).clusters.some(c => c.start)).toBe(false);
      createPlanningClusters(points, settings);
      expect(JSON.stringify(points.points.map(p => p.coordinate))).toBe(before);
    });
    it("tiny clusters start on a real member, and detects a start that was moved to the middle", () => {
      const points = set(10), result = createPlanningClusters(points, { ...settings, mode: "range", min: 1, max: 2 });
      expect(result.clusters.every(c => c.pointIds.includes(c.start!.pointId))).toBe(true);
      const big = set(500), good = createPlanningClusters(big, settings), at = frame(big), tampered = structuredClone(good);
      const c = tampered.clusters[0]!, border = clusterBorderIds(at, c.pointIds, reach(at)), inner = c.pointIds.find(id => !border.has(id))!;
      c.start = { pointId: inner, coordinate: big.points.find(p => p.id === inner)!.coordinate, roadDistanceM: 1 };
      expect(() => assertPlanningClusters(big, tampered)).toThrow(/border/);
    });
    it("exports the start in GeoJSON and CSV", () => {
      const points = set(101), result = createPlanningClusters(points, settings), starts = new Set(result.clusters.map(c => c.start!.pointId));
      expect(clusterExport(points, result).features.filter(f => f.properties?.clusterStart).length).toBe(starts.size);
      const rows = clusterCsv(points, result).split("\n");
      expect(rows[0]).toMatch(/is_start$/);
      expect(rows.filter(r => r.endsWith('"true"')).length).toBe(starts.size);
    });
  });
  describe("road reference", () => {
    const samFor = (prompt: string, mapId = "field") => ({ model: "sam-3.1", mapId, prompt, regions: { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[[[103.001, 2.001], [103.005, 2.001], [103.005, 2.004], [103.001, 2.001]]]] } }] } }) as never;
    it("uses a road-prompted SAM output, otherwise the SAM border, otherwise the map boundary", () => {
      expect(roadReference(area, samFor("dirt road"), "field").source).toBe("sam-road");
      expect(roadReference(area, samFor("individual oil palm tree canopy"), "field").source).toBe("sam-border");
      expect(roadReference(area, samFor("road", "other-map"), "field").source).toBe("map-boundary");
      const none = roadReference(area, null, "field");
      expect(none).toMatchObject({ source: "map-boundary", lines: [area.coordinates[0]] });
    });
  });
});
