import { describe, expect, it } from "vitest";
import type { FeatureCollection, MultiPolygon } from "geojson";
import type { CanopyClip } from "./canopy";
import { imagePixelToLngLat, type SamFrame } from "./sam";
import { alignedCanopyHeights, insideSamOutput, samCoverageMask } from "./treeGuidance";
const frame: SamFrame = { width: 4, height: 4, corners: [[103, 2.004], [103.004, 2.004], [103.004, 2], [103, 2]] };
const area = { type: "Polygon" as const, coordinates: [[...frame.corners, frame.corners[0]]] };
const values = [0, 1, 2, 3, 4, 255, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const clip: CanopyClip = { ...frame, version: 1, id: "real-band", dataset: "Meta/WRI CHMv2", area, resolutionMapM: 1.19, nativeResolutionMapM: 1.19, sampled: false, fetchedAt: "2026-11-02T00:00:00Z", sourceDate: null, sources: [], stats: { insideCells: 16, positiveCells: 14, zeroCells: 1, missingCells: 1, minimumM: 1, maximumM: 15 }, imageDataUrl: "deliberately-not-used-as-height-evidence", heightData: { encoding: "uint8-metres-base64", data: btoa(String.fromCharCode(...values)) } };
const ring = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => imagePixelToLngLat(frame, x!, y!));
describe("georeferenced CHMv2 and SAM point guidance", () => {
  it("uses numeric metres while keeping known zero separate from missing values", () => {
    const height = alignedCanopyHeights(frame, clip);
    expect(height[0]).toBe(0); expect(height[5]).toBeNaN(); expect(height[10]).toBe(10); expect(height[15]).toBe(15);
    expect(() => alignedCanopyHeights(frame, { ...clip, heightData: undefined })).toThrow(/numeric/);
    expect(() => alignedCanopyHeights(frame, { ...clip, heightData: { encoding: "uint8-metres-base64", data: btoa("short") } })).toThrow(/dimensions/);
  });
  it("aligns different and rotated RGB grids in geographic space, rather than by array index", () => {
    const target: SamFrame = { width: 2, height: 2, corners: [[0, 2], [0, 0], [2, 0], [2, 2]].map(([x, y]) => imagePixelToLngLat(frame, x!, y!)) as SamFrame["corners"] };
    const output = alignedCanopyHeights(target, clip);
    expect(output[0]).toBe(4); expect(output[1]).toBe(0); expect(output[2]).toBeNaN(); expect(output[3]).toBe(1);
    const outside: SamFrame = { width: 2, height: 2, corners: [[-2, 0], [0, 0], [0, 2], [-2, 2]].map(([x, y]) => imagePixelToLngLat(frame, x!, y!)) as SamFrame["corners"] };
    expect([...alignedCanopyHeights(outside, clip)].every(Number.isNaN)).toBe(true);
  });
  it("uses actual SAM mask geometry, preserves holes and unions disconnected/overlapping output regions", () => {
    const regions: FeatureCollection<MultiPolygon> = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[ring(0, 0, 4, 4), ring(1, 1, 3, 3)]] } }, { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[ring(1, 1, 2, 2)]] } }] };
    const mask = samCoverageMask(frame, regions);
    expect(mask[0]).toBe(1); expect(mask[5]).toBe(1); // Second polygon occupies part of the first polygon's hole.
    expect(mask[6]).toBe(0); expect(mask[9]).toBe(0); expect(mask[10]).toBe(0);
    expect([...mask].filter(Boolean)).toHaveLength(13);
    expect(insideSamOutput(regions, imagePixelToLngLat(frame, 1.5, 1.5))).toBe(true);
    expect(insideSamOutput(regions, imagePixelToLngLat(frame, 2.5, 2.5))).toBe(false);
  });
});
