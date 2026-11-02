import { describe, expect, it } from "vitest";
import { crownMatchFeatures, matchCrowns, DEFAULT_MATCHING_SETTINGS, type MatchJob, type CrownMatchResult } from "./templateMatch";

function fixture(): MatchJob {
  const width = 96, height = 80, rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([20 + i % 7, 24 + i % 7, 18 + i % 7, 255], i * 4);
  const patch = (x: number, y: number) => 60 + Math.round(40 * Math.sin(x * 1.7) * Math.cos(y * 1.3) + 18 * Math.cos(x + y));
  for (const [ox, oy, gain, offset] of [[5, 5, 1, 0], [35, 29, 1.2, 12], [64, 50, 1, 0]]) {
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const value = Math.round(patch(x, y) * gain! + offset!);
      rgba.set([value, value, value, ox === 64 ? 0 : 255], ((oy! + y) * width + ox! + x) * 4);
    }
  }
  return { width, height, rgba, sample: { x: 5, y: 5, width: 10, height: 10 }, settings: { threshold: 0.99, spacing: 0.65, multiScale: false } };
}

describe("crown template matching", () => {
  it("finds translated crowns despite brightness/contrast changes and excludes transparent areas", () => {
    const result = matchCrowns(fixture());
    expect(result.matches).toHaveLength(2);
    expect(result.matches.some((m) => m.x === 5 && m.y === 5 && m.score > 0.999)).toBe(true);
    expect(result.matches.some((m) => m.x === 35 && m.y === 29 && m.score > 0.99)).toBe(true);
    expect(result.matches.every((m) => m.x < 60)).toBe(true);
  });
  it("uses the correct image patch rather than reporting every regular texture", () => {
    const job = fixture();
    // Reverse one crown's local texture; contrast inversion must not match.
    for (let y = 29; y < 39; y++) for (let x = 35; x < 45; x++) for (let c = 0; c < 3; c++) {
      const i = (y * job.width + x) * 4 + c; job.rgba[i] = 200 - job.rgba[i]!;
    }
    expect(matchCrowns(job).matches.map((m) => [m.x, m.y])).toEqual([[5, 5]]);
  });
  it("suppresses overlapping detections across scale variations", () => {
    const job = fixture(); job.settings = { ...DEFAULT_MATCHING_SETTINGS, threshold: 0.5 };
    const { matches } = matchCrowns(job);
    expect(matches.filter((m) => Math.hypot(m.x + m.width / 2 - 10, m.y + m.height / 2 - 10) < 5)).toHaveLength(1);
    expect(matches[0]!.score).toBeGreaterThan(0.999);
  });
  it("finds a larger version of a crown using the scale search", () => {
    const job = fixture();
    job.settings = { threshold: 0.95, spacing: 0.65, multiScale: true };
    const draw = (ox: number, oy: number, size: number) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
        const value = Math.round(35 + 150 * Math.exp(-(u * u + v * v) * 5) + 15 * Math.sin(u * 3) * Math.cos(v * 4));
        job.rgba.set([value, value, value, 255], ((oy + y) * job.width + ox + x) * 4);
      }
    };
    draw(5, 5, 10); draw(60, 15, 12);
    const { matches } = matchCrowns(job);
    expect(matches.some((m) => m.x === 60 && m.y === 15 && m.width === 12 && m.height === 12 && m.scale === 1.2)).toBe(true);
  });
  it("rejects flat templates, invalid sizes and samples crossing the crop mask", () => {
    const job = fixture(); job.sample = { x: 64, y: 50, width: 10, height: 10 };
    expect(() => matchCrowns(job)).toThrow(/fully inside/);
    job.sample = { x: 0, y: 0, width: 2, height: 3 };
    expect(() => matchCrowns(job)).toThrow(/6 and 64/);
    job.sample = { x: 0, y: 60, width: 10, height: 10 };
    for (let i = 0; i < job.rgba.length; i += 4) job.rgba.set([50, 50, 50, 255], i);
    expect(() => matchCrowns(job)).toThrow(/too little texture/);
  });
  it("reports progress and preserves deterministic ranking", () => {
    const progress: number[] = [], job = fixture();
    const a = matchCrowns(job, (value) => progress.push(value));
    expect(a).toEqual(matchCrowns(job));
    expect(progress.at(-1)).toBe(100);
    expect(progress.every((value) => value >= 0 && value <= 100)).toBe(true);
  });
  it("exports anchored candidate centres and boxes with similarity metadata", () => {
    const job = fixture();
    const result: CrownMatchResult = { method: "normalized-cross-correlation-v1", mapId: "map-a", receivedAt: "2026-11-01T12:00:00Z", durationMs: 10, sample: job.sample, settings: job.settings, ...matchCrowns(job), image: { width: 96, height: 80, corners: [[100, 2], [101, 2], [101, 1], [100, 1]], source: "esri", imageDataUrl: "", area: { type: "Polygon", coordinates: [[[100, 2], [101, 2], [101, 1], [100, 1], [100, 2]]] } } };
    const data = crownMatchFeatures(result);
    expect(data.features).toHaveLength(4);
    expect(data.features[0]).toMatchObject({ properties: { candidateId: 1, kind: "center", method: result.method }, geometry: { type: "Point" } });
    const point = data.features[0]!.geometry;
    if (point.type !== "Point") throw Error("Missing centre point");
    expect(point.coordinates[0]).toBeCloseTo(100 + 10 / 96, 8);
    expect(point.coordinates[1]).toBeGreaterThan(1);
    expect(point.coordinates[1]).toBeLessThan(2);
    const box = data.features[1]!.geometry;
    if (box.type !== "Polygon") throw Error("Missing box");
    expect(box.coordinates[0]![0]).toEqual(box.coordinates[0]!.at(-1));
    expect(crownMatchFeatures(null).features).toEqual([]);
  });
});
