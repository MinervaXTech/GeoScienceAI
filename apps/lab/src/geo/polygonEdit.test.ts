import { describe, expect, it } from "vitest";
import { edgeAt, insidePolygon, vertexAt } from "./polygonEdit";
const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
describe("polygon edit hit testing", () => {
  it("snaps to the nearest edge, including the closing segment", () => {
    expect(edgeAt(square, { x: -4, y: 50 })).toEqual({ index: 3, point: { x: 0, y: 50 } });
    expect(edgeAt(square, { x: 40, y: 3 })).toEqual({ index: 0, point: { x: 40, y: 0 } });
    expect(edgeAt(square, { x: 50, y: 50 })).toBeNull();
  });
  it("distinguishes corner handles, polygon interior and unrelated map areas", () => {
    expect(vertexAt(square, { x: 3, y: 4 })).toBe(0);
    expect(vertexAt(square, { x: 50, y: 0 })).toBe(-1);
    expect(insidePolygon(square, { x: 50, y: 50 })).toBe(true);
    expect(insidePolygon(square, { x: -50, y: 50 })).toBe(false);
  });
});
