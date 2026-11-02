import { describe, expect, it } from "vitest";
import { denseCrownCoverage } from "./denseCrowns";
function fixture() {
  const width = 180, height = 120, rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Two extensive textured canopy regions; everything else is a clearing.
    const tree = y >= 10 && y < 110 && (x >= 8 && x < 65 || x >= 115 && x < 172), noise = ((x * 17 + y * 23) % 31) - 15;
    const rgb = tree ? [30 + noise, 70 + noise, 25 + noise] : x < 90 ? [65, 95, 45] : [110, 100, 70];
    rgba.set([...rgb, x < 3 ? 0 : 255], (y * width + x) * 4);
  }
  return { width, height, rgba, spacingPx: 12, sensitivity: .6, seeds: [] };
}
describe("dense approximate tree coverage", () => {
  it("fills both distant canopy regions even without matching seeds, leaving roads, smooth grass and transparent regions empty", () => {
    const output = denseCrownCoverage(fixture());
    expect(output.points.length).toBeGreaterThan(70);
    expect(output.points.filter((p) => p.x < 65).length).toBeGreaterThan(30);
    expect(output.points.filter((p) => p.x >= 115).length).toBeGreaterThan(30);
    expect(output.points.some((p) => p.x > 70 && p.x < 110)).toBe(false);
    expect(output.points.every((p) => p.x >= 3)).toBe(true);
    expect(output.coveredPixels).toBe(output.eligiblePixels);
    expect(output.retainedCount).toBe(0);
    for (const p of output.points) for (const q of output.points) if (p !== q) expect(Math.hypot(p.x - q.x, p.y - q.y) + 1e-9).toBeGreaterThanOrEqual(output.minSpacingPx);
  });
  it("preserves real seed centres and fills the rest instead of merely returning the sparse matches", () => {
    const output = denseCrownCoverage({ ...fixture(), seeds: [{ x: 30, y: 40, index: 0, manual: false }, { x: 31, y: 40, index: 1, manual: false }] });
    expect(output.retainedCount).toBe(1); expect(output.points[0]).toEqual({ x: 30, y: 40, seedIndex: 0 }); expect(output.points.length).toBeGreaterThan(70);
  });
  it("keeps excluded clearings empty on subsequent runs rather than refilling them", () => {
    const job = fixture();
    for (let y = 30; y < 80; y++) for (let x = 20; x < 50; x++) job.rgba[(y * job.width + x) * 4 + 3] = 0;
    const output = denseCrownCoverage(job);
    expect(output.points.some((p) => p.x >= 20 && p.x < 50 && p.y >= 30 && p.y < 80)).toBe(false);
    expect(output.coveredPixels).toBe(output.eligiblePixels);
  });
  it("changes density with spacing and fails visibly instead of silently truncating coverage", () => {
    const dense = denseCrownCoverage(fixture()), sparse = denseCrownCoverage({ ...fixture(), spacingPx: 20 });
    expect(dense.points.length).toBeGreaterThan(sparse.points.length * 1.7);
    expect(() => denseCrownCoverage({ ...fixture(), limit: 10 })).toThrow(/not truncated/);
    expect(() => denseCrownCoverage({ ...fixture(), spacingPx: 1 })).toThrow(/4 pixels/);
  });
  it("intersects CHMv2 support and SAM polygons, including constraints on manually supplied seeds", () => {
    const job = fixture(), count = job.width * job.height, heights = new Float32Array(count).fill(12), samMask = new Uint8Array(count).fill(1);
    for (let y = 0; y < job.height; y++) for (let x = 0; x < job.width; x++) {
      if (x > 90) samMask[y * job.width + x] = 0;
      if (y < 40) heights[y * job.width + x] = 0;
      if (y >= 40 && y < 60) heights[y * job.width + x] = NaN;
    }
    const output = denseCrownCoverage({ ...job, heightMetres: heights, minimumHeightM: 3, samMask, seeds: [{ x: 30, y: 20, index: 0, manual: true }, { x: 130, y: 80, index: 1, manual: true }] });
    expect(output.points.length).toBeGreaterThan(10);
    expect(output.points.every((p) => p.x < 90 && p.y >= 60 && p.canopyHeightM === 12)).toBe(true);
    expect(output.retainedCount).toBe(0);
    expect(output.guidance.samExcludedPixels).toBeGreaterThan(0);
    expect(output.guidance.belowHeightPixels).toBeGreaterThan(0);
    expect(output.guidance.heightMissingPixels).toBeGreaterThan(0);
    expect(output.coveredPixels).toBe(output.eligiblePixels);
    expect(() => denseCrownCoverage({ ...job, heightMetres: new Float32Array(count).fill(NaN), minimumHeightM: 3, samMask })).toThrow(/missing-height/);
  });

});
