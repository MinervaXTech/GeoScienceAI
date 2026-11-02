import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import { useSamArea } from "./useSamArea";
const square: Polygon = { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
describe("SAM polygon editing", () => {
  it("uses the drawn map boundary by default and can return to it after a smaller selection", () => {
    const { result } = renderHook(() => useSamArea(undefined, square));
    expect(result.current.polygon).toEqual(square); expect(result.current.usingDefault).toBe(true);
    act(() => { result.current.start(); result.current.addVertex([0.5, 0.5]); result.current.addVertex([1.5, 0.5]); result.current.addVertex([1, 1.5]); result.current.finish(); });
    expect(result.current.usingDefault).toBe(false); expect(result.current.defaultPolygon).toEqual(square);
    act(() => result.current.clear());
    expect(result.current.polygon).toEqual(square); expect(result.current.usingDefault).toBe(true);
  });
  it("inserts a closing-edge corner, moves it and commits a closed polygon", () => {
    const { result } = renderHook(() => useSamArea(square));
    act(() => result.current.edit());
    expect(result.current.editing).toBe(true); expect(result.current.vertices).toHaveLength(4);
    act(() => result.current.insertVertex(3, [0, 1]));
    act(() => result.current.moveVertex(4, [-1, 1], true));
    act(() => result.current.finish());
    expect(result.current.drawing).toBe(false);
    expect(result.current.polygon?.coordinates[0]).toEqual([[0, 0], [2, 0], [2, 2], [0, 2], [-1, 1], [0, 0]]);
  });
  it("undoes a drag as one edit and preserves the original polygon on Cancel", () => {
    const { result } = renderHook(() => useSamArea(square));
    act(() => result.current.edit());
    act(() => result.current.insertVertex(0, [1, 0]));
    act(() => { result.current.moveVertex(1, [1, -0.5], true); result.current.moveVertex(1, [1, -1], false); });
    act(() => result.current.undo());
    expect(result.current.vertices[1]).toEqual([1, 0]);
    act(() => result.current.undo());
    expect(result.current.vertices).toHaveLength(4); expect(result.current.canUndo).toBe(false);
    act(() => result.current.moveVertex(0, [-1, 0], true));
    act(() => result.current.cancel());
    expect(result.current.polygon).toEqual(square); expect(result.current.editing).toBe(false);
  });
  it("keeps crossing edges in edit mode until they are corrected or undone", () => {
    const { result } = renderHook(() => useSamArea(square));
    act(() => result.current.edit());
    act(() => result.current.moveVertex(1, [-1, 1], true));
    act(() => result.current.finish());
    expect(result.current.editing).toBe(true); expect(result.current.error).toMatch(/cross/); expect(result.current.polygon).toEqual(square);
    act(() => result.current.undo()); act(() => result.current.finish());
    expect(result.current.drawing).toBe(false); expect(result.current.error).toBe("");
  });
  it("enforces the corner limit while editing", () => {
    const ring = Array.from({ length: 64 }, (_, i) => [Math.cos(i * Math.PI / 32), Math.sin(i * Math.PI / 32)]);
    const { result } = renderHook(() => useSamArea({ type: "Polygon", coordinates: [[...ring, ring[0]!]] }));
    act(() => result.current.edit()); act(() => result.current.insertVertex(0, [0.9, 0.1]));
    expect(result.current.vertices).toHaveLength(64); expect(result.current.error).toMatch(/64/);
  });
});
