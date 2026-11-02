import { describe, expect, it } from "vitest";
import { computePlanningRoutes, inPlanningArea, metricFrame, planningCsv, planningFeatures, planningFigureSvg, planningFromCrowns, planningLocationError, type PlanningPoints } from "./planningPoints";
import { runAlgorithm } from "../../engine/algorithms.mjs";
import type { CrownMatchResult } from "./templateMatch";
const area = { type: "Polygon" as const, coordinates: [[[103.22, 2.066], [103.221, 2.066], [103.221, 2.065], [103.22, 2.065], [103.22, 2.066]]] };
const result: CrownMatchResult = { method: "normalized-cross-correlation-v1", mapId: "kluang", receivedAt: "2026-11-02T00:00:00Z", durationMs: 1, image: { source: "esri", width: 100, height: 100, imageDataUrl: "", corners: [[103.22, 2.066], [103.221, 2.066], [103.221, 2.065], [103.22, 2.065]], area }, sample: { x: 10, y: 10, width: 8, height: 8 }, settings: { threshold: .6, spacing: .65, multiScale: true }, matches: [{ x: 10, y: 10, width: 8, height: 8, scale: 1, score: .9 }, { x: 11, y: 10, width: 8, height: 8, scale: 1, score: .8 }, { x: 70, y: 70, width: 8, height: 8, scale: 1, score: .75 }, { x: 50, y: 20, width: 8, height: 8, scale: 1, score: .5 }], truncated: false };
describe("approximate crown centres for route-planning studies", () => {
  it("keeps observed centres, suppresses near duplicates and never creates grid points in empty areas", () => {
    const set = planningFromCrowns(result, 4, .6);
    expect(set.points).toHaveLength(2); expect(set.points.map((p) => p.similarity)).toEqual([.9, .75]);
    expect(set.points.every((p) => inPlanningArea(area, p.coordinate))).toBe(true);
    const project = metricFrame(area), [a, b] = set.points.map((p) => project(p.coordinate));
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThan(4);
    expect(set.points[0]!.coordinate[0]).toBeCloseTo(103.22014, 7);
  });
  it("allows retained matcher evidence without requiring crown circles to represent perfect boundaries", () => {
    const set = planningFromCrowns({ ...result, matches: [], rawMatches: result.matches }, 4, .6);
    expect(set.points).toHaveLength(2);
    expect(() => planningFromCrowns(result, .1, .6)).toThrow();
    expect(() => planningFromCrowns(result, 4, .99)).toThrow(/No crown centres/);
  });
  it("requires manual edits to remain inside the polygon, outside holes and sufficiently separated", () => {
    const set = planningFromCrowns(result, 4, .6);
    expect(planningLocationError(set, [103.23, 2.0655])).toMatch(/inside/);
    expect(planningLocationError(set, set.points[0]!.coordinate)).toMatch(/4 m/);
    expect(planningLocationError(set, set.points[0]!.coordinate, set.points[0]!.id)).toBeNull();
    const withHole = { ...area, coordinates: [...area.coordinates, [[103.2204, 2.0654], [103.2206, 2.0654], [103.2206, 2.0656], [103.2204, 2.0656], [103.2204, 2.0654]]] };
    expect(inPlanningArea(withHole, [103.2205, 2.0655])).toBe(false);
  });
  it("compares tours on exactly the same edited points and local home, returning home and visiting each point once", () => {
    const base = planningFromCrowns(result, 4, .6);
    const set: PlanningPoints = { ...base, home: [103.2201, 2.0651], points: [[103.2201, 2.0659], [103.2209, 2.0651], [103.2209, 2.0659], [103.2202, 2.0652], [103.2206, 2.0655]].map((coordinate, i) => ({ id: `P${i + 1}`, coordinate: coordinate as [number, number], source: "manual" })) };
    const routes = computePlanningRoutes(set);
    for (const tour of [routes.A, routes.B]) {
      expect(new Set(tour.order).size).toBe(set.points.length); expect(tour.order.toSorted()).toEqual(set.points.map((p) => p.id).toSorted());
      expect(tour.coordinates[0]).toEqual(set.home); expect(tour.coordinates.at(-1)).toEqual(set.home); expect(tour.lengthM).toBeGreaterThan(100);
    }
    expect(routes.B.lengthM).toBeLessThanOrEqual(routes.A.lengthM + 1e-6);
    const project = metricFrame(set.area), registered = runAlgorithm("B", set.points.map((p, i) => ({ id: i + 1, ...project(p.coordinate), h: 0 })), project(set.home));
    expect(routes.B.order).toEqual(registered.order.map((i) => set.points[i]!.id));
    const features = planningFeatures(set, routes).features;
    expect(features.filter((f) => f.properties!.kind === "planning-point")).toHaveLength(5);
    expect(planningCsv(set, routes).split("\n")).toHaveLength(6);
    const svg = planningFigureSvg(set, routes), document = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(document.querySelector("parsererror")).toBeNull(); expect(document.querySelectorAll("circle")).toHaveLength(10); expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain("Approximate image-derived centres");
  });
});
