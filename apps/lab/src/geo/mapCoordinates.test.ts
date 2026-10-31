import { describe, expect, it } from "vitest";
import { fromCell, HOME_WGS84, RASTER, RASTER_CORNERS, toCell } from "./layer";
import { googleViewportCovered } from "./googleCoverage";

describe("georeferenced map overlays", () => {
  it("round-trips cell edges and home through the source Mercator transform", () => {
    for (const cell of [[0, 0], [RASTER.width, RASTER.height], [50.5, 80.5]] as [number, number][]) {
      const actual = toCell(fromCell(cell));
      expect(actual[0]).toBeCloseTo(cell[0], 6);
      expect(actual[1]).toBeCloseTo(cell[1], 6);
    }
    const home = fromCell(toCell(HOME_WGS84));
    expect(home[0]).toBeCloseTo(HOME_WGS84[0], 9);
    expect(home[1]).toBeCloseTo(HOME_WGS84[1], 9);
    expect(RASTER_CORNERS[0][0]).toBeLessThan(RASTER_CORNERS[1][0]);
    expect(RASTER_CORNERS[0][1]).toBeGreaterThan(RASTER_CORNERS[3][1]);
  });

  it("requires coverage of the entire viewport at the requested zoom", () => {
    const bounds = { north: 3, south: 2, east: 102, west: 101 };
    const west = { ...bounds, east: 101.5, maxZoom: 20 };
    const east = { ...bounds, west: 101.5, maxZoom: 20 };
    expect(googleViewportCovered(bounds, 19, [west, east])).toBe(true);
    expect(googleViewportCovered(bounds, 21, [west, east])).toBe(false);
    expect(googleViewportCovered(bounds, 19, [west])).toBe(false);
    expect(googleViewportCovered(bounds, 19, [west, { ...east, west: 101.6 }])).toBe(false);
    expect(googleViewportCovered(bounds, 19, [])).toBe(false);
  });
});
