import { describe, expect, it } from "vitest";
import { countSectorMatches, crownSectors, mergeCrownMatches, validateCoverageFeedback } from "./crownCoverage";
import { matchCrowns, type CrownMatch, type MatchJob } from "./templateMatch";

describe("cumulative crown coverage", () => {
  it("accumulates different crown appearances without filling unmatched background", () => {
    const width = 112, height = 80, rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) rgba.set([20, 40, 20, 255], i * 4);
    for (const [seed0, positions] of [[123, [[8, 8], [72, 8]]], [987, [[8, 52], [72, 52]]]] as const) {
      let seed: number = seed0; const pattern: number[] = [];
      for (let i = 0; i < 100; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; pattern.push(40 + seed % 190); }
      for (const [ox, oy] of positions) for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) { const v = pattern[y * 10 + x]!; rgba.set([v, v, v, 255], ((oy + y) * width + ox + x) * 4); }
    }
    const job: MatchJob = { width, height, rgba, sample: { x: 8, y: 8, width: 10, height: 10 }, settings: { threshold: 0.99, spacing: 0.65, multiScale: false } };
    const a = matchCrowns(job).matches, b = matchCrowns({ ...job, sample: { ...job.sample, y: 52 } }).matches;
    expect(a).toHaveLength(2); expect(b).toHaveLength(2);
    const combined = mergeCrownMatches(a, b);
    expect(combined.matches).toHaveLength(4); expect(combined.addedCandidates).toBe(2);
    expect(combined.matches.map((m) => [m.x, m.y]).sort()).toEqual([[8, 8], [72, 8], [8, 52], [72, 52]].sort());
    expect(mergeCrownMatches(combined.matches, [...a, ...b]).matches).toHaveLength(4);
    expect(mergeCrownMatches(combined.matches, a).addedCandidates).toBe(0);
  });
  it("suppresses duplicates across scales and spatial bucket boundaries, retaining the stronger candidate", () => {
    const old: CrownMatch = { x: 59, y: 20, width: 10, height: 10, score: 0.8, scale: 1 };
    const better = { ...old, x: 60, width: 12, height: 12, score: 0.95, scale: 1.2 };
    const far = { ...old, x: 110, score: 0.7 };
    const merged = mergeCrownMatches([old], [better, far]);
    expect(merged.matches).toEqual([better, far]); expect(old.x).toBe(59);
    expect(mergeCrownMatches([], [old, better, far], 0.65, 1)).toMatchObject({ matches: [better], truncated: true });
  });
  it("reports spatial distribution only in nontransparent sectors", () => {
    const rgba = new Uint8ClampedArray(16 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) rgba[(y * 16 + x) * 4 + 3] = 255;
    const sectors = crownSectors(16, 16, rgba);
    expect(sectors).toHaveLength(8); expect(sectors.reduce((n, s) => n + s.validPixels, 0)).toBe(128);
    const result = countSectorMatches(sectors, [{ x: 0, y: 0, width: 4, height: 4, score: 1, scale: 1 }]);
    expect(result.filter((s) => s.count > 0)).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "A1", count: 1 });
    expect(sectors[0]!.count).toBe(0);
  });
  it("bounds model feedback and drops arbitrary extra fields", () => {
    const feedback = { mergedCount: 5000, addedCandidates: 5, stagnantPasses: 0, samples: [{ x: 1, y: 1, width: 8, height: 8 }], sectors: [{ id: "A1", x: 0, y: 0, width: 16, height: 16, validPixels: 100, count: 5 }], secret: "omit" };
    expect(JSON.stringify(validateCoverageFeedback(feedback, 32, 32))).not.toContain("omit");
    expect(() => validateCoverageFeedback({ ...feedback, mergedCount: 5001 }, 32, 32)).toThrow();
    expect(() => validateCoverageFeedback({ ...feedback, samples: Array(13).fill(feedback.samples[0]) }, 32, 32)).toThrow();
    expect(() => validateCoverageFeedback({ ...feedback, sectors: [{ ...feedback.sectors[0], validPixels: 999999 }] }, 32, 32)).toThrow();
  });
});
