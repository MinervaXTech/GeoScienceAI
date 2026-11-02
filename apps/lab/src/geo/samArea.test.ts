import { describe, expect, it } from "vitest";
import { areaBounds, samAreaError } from "./samArea";
import { imagePixelToLngLat, lngLatToImagePixel, type SamFrame } from "./sam";

describe("SAM area selection", () => {
  it("accepts a closed concave polygon and computes its bounds", () => {
    const area = { type: "Polygon" as const, coordinates: [[[101, 2], [102, 2], [101.5, 2.5], [102, 3], [101, 3], [101, 2]]] };
    expect(samAreaError(area)).toBeNull();
    expect(areaBounds(area)).toEqual([[101, 2], [102, 3]]);
  });
  it("rejects missing, unclosed, self-intersecting, degenerate, and duplicate-corner areas", () => {
    for (const area of [null, { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1]]] }, { type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]] }, { type: "Polygon", coordinates: [[[0, 0], [1, 0], [2, 0], [0, 0]]] }, { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 0], [0, 1], [0, 0]]] }]) expect(samAreaError(area)).toBeTruthy();
  });
  it("round-trips crop pixels through a rotated Mercator frame", () => {
    const origin = [101.72 * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + 2.98 * Math.PI / 360))];
    const toGeo = (x: number, y: number): [number, number] => [(origin[0]! + x) * 180 / Math.PI, (2 * Math.atan(Math.exp(origin[1]! + y)) - Math.PI / 2) * 180 / Math.PI];
    const frame: SamFrame = { width: 600, height: 400, corners: [toGeo(0, 0), toGeo(1e-5, -8e-6), toGeo(4e-6, -18e-6), toGeo(-6e-6, -1e-5)] };
    for (const point of [[0, 0], [600, 400], [300, 200], [175, 320]]) {
      const [x, y] = lngLatToImagePixel(frame, imagePixelToLngLat(frame, point[0]!, point[1]!));
      expect(x).toBeCloseTo(point[0]!, 7); expect(y).toBeCloseTo(point[1]!, 7);
    }
  });
});
