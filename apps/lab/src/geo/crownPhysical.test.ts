import { describe, expect, it } from "vitest";
import { applyCrownPolicy, constrainCrownMatches, crownSizePolicy, mergeCrownCandidatePool } from "./crownPhysical";
import { crownMatchFeatures, type CrownMatch, type CrownMatchResult } from "./templateMatch";
import { lngLatToImagePixel } from "./sam";
const crown = (x: number, y: number, diameter = 10, score = 0.8): CrownMatch => ({ x, y, width: diameter, height: diameter, score, scale: 1 });
const policy = crownSizePolicy({ width: 10, height: 10 });
const result: CrownMatchResult = { method: "normalized-cross-correlation-v1", mapId: "test", receivedAt: "2026-11-02T00:00:00Z", durationMs: 1, image: { source: "esri", imageDataUrl: "", width: 128, height: 128, corners: [[101, 3], [102, 3], [102, 2], [101, 2]], area: { type: "Polygon", coordinates: [[[101, 3], [102, 3], [102, 2], [101, 2], [101, 3]]] } }, sample: { x: 0, y: 0, width: 10, height: 10 }, settings: { threshold: 0.65, spacing: 0.65, multiScale: true }, matches: [], truncated: false };
describe("plausible crown annotation constraints", () => {
  it("rejects overlapping circles across bucket edges, preserves tangencies and strongest scores", () => {
    const a = crown(59, 10, 10, 0.99), b = crown(65, 10, 10, 0.9), c = crown(69, 10, 10, 0.8);
    const filtered = constrainCrownMatches([b, c, a], policy);
    expect(filtered.matches.map((m) => m.x)).toEqual([59, 69]);
    expect(filtered.report.overlapRejected).toBe(1);
    expect(filtered.matches.every((m) => m.radiusPx === 5)).toBe(true);
    expect(constrainCrownMatches([a, c], { ...policy, clearancePx: 1 }).matches).toHaveLength(1);
  });
  it("enforces pairwise separation for variable diameters without shrinking to pack more points", () => {
    const input = Array.from({ length: 200 }, (_, i) => crown((i * 17) % 127, (i * 29) % 127, 8 + i % 5, 0.6 + i / 1000));
    const { matches } = constrainCrownMatches(input, { ...policy, clearancePx: 2 });
    for (const a of matches) for (const b of matches) if (a !== b) expect(Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2) + 1e-9).toBeGreaterThanOrEqual(a.radiusPx! + b.radiusPx! + 2);
    for (const a of matches) expect(a.radiusPx).toBe(Math.min(a.width, a.height) / 2);
  });
  it("rejects groups, tiny patches and elongated patches before spatial suppression", () => {
    const pool = mergeCrownCandidatePool([crown(0, 0, 30, 1)], [crown(10, 10, 10, 0.8), crown(50, 50, 6), { ...crown(70, 70), height: 20 }]);
    const filtered = constrainCrownMatches(pool.matches, policy);
    expect(filtered.matches).toHaveLength(1); expect(filtered.matches[0]!.x).toBe(10);
    expect(filtered.report).toMatchObject({ sizeRejected: 2, shapeRejected: 1 });
  });
  it("retains alternate raw candidates for reversible policy changes and exports georeferenced circles", () => {
    const strict = applyCrownPolicy({ ...result, matches: [crown(10, 10, 8), crown(40, 40, 12)] }, crownSizePolicy({ width: 10, height: 10 }, 0.1));
    expect(strict.matches).toHaveLength(0); expect(strict.rawMatches).toHaveLength(2);
    const restored = applyCrownPolicy(strict, policy); expect(restored.matches).toHaveLength(2);
    const features = crownMatchFeatures(restored), circle = features.features.find((f) => f.properties!.kind === "circle")!;
    expect(circle.geometry.type).toBe("Polygon"); if (circle.geometry.type !== "Polygon") throw Error("wrong geometry");
    const ring = circle.geometry.coordinates[0]!; expect(ring).toHaveLength(49); expect(ring[0]).toEqual(ring.at(-1));
    for (const p of ring) { const [x, y] = lngLatToImagePixel(result.image, p as [number, number]); expect(Math.hypot(x - 14, y - 14)).toBeCloseTo(4, 6); }
  });
});
