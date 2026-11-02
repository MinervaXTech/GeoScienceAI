import { describe, expect, it } from "vitest";
import { deleteSavedMap, savedMapError, withDefaultMapAreas } from "./maps";
import { exportJson, importJson, parseState } from "./persistence";
import { emptyState, type SavedMap } from "./types";

const map: SavedMap = { id: "map-field-b", name: "Field B", center: [101.72, 2.98], zoom: 18, basemap: "esri", area: { type: "Polygon", coordinates: [[[101.719, 2.979], [101.721, 2.979], [101.72, 2.981], [101.719, 2.979]]] } };

describe("saved maps", () => {
  it("deletes only the requested map and falls back to UPM when necessary", () => {
    const other = { ...map, id: "map-other" };
    const state = { ...emptyState(), maps: [map, other], activeMapId: map.id };
    expect(deleteSavedMap(state, other.id)).toMatchObject({ maps: [map], activeMapId: map.id });
    expect(deleteSavedMap(state, map.id)).toMatchObject({ maps: [other], activeMapId: "upm" });
    expect(deleteSavedMap(state, "upm")).toBe(state);
  });
  it("preserves a drawn map boundary independently of a smaller SAM selection", () => {
    const small = { type: "Polygon" as const, coordinates: [[[101.7198, 2.98], [101.7202, 2.98], [101.72, 2.9801], [101.7198, 2.98]]] };
    const state = { ...emptyState(), maps: [{ ...map, boundary: map.area, area: small }], activeMapId: map.id };
    expect(importJson(exportJson(state))).toEqual({ ok: true, state });
    expect(savedMapError({ ...map, boundary: { type: "Point", coordinates: [0, 0] } })).toBeTruthy();
  });
  it("reuses existing drawn areas for older entries without inventing map polygons", () => {
    const missing = { ...map, id: "map-no-polygon", area: undefined };
    const migrated = withDefaultMapAreas({ ...emptyState(), maps: [map, missing] });
    expect(migrated.maps?.[0]?.boundary).toEqual(map.area);
    expect(migrated.maps?.[1]?.boundary).toBeUndefined();
    expect(withDefaultMapAreas(migrated)).toBe(migrated);
  });
  it("round-trips locations, basemaps, selected polygons and the current map through JSON", () => {
    const state = { ...emptyState(), maps: [map], activeMapId: map.id };
    expect(importJson(exportJson(state))).toEqual({ ok: true, state });
  });

  it("keeps older states readable without saved maps", () => {
    expect(parseState(emptyState())).toEqual({ ok: true, state: emptyState() });
  });

  it("rejects invalid locations and polygons instead of passing them to the map renderer", () => {
    for (const center of [[181, 0], [0, 86], [NaN, 0], [0], ["101", 2]]) expect(savedMapError({ ...map, center })).toBeTruthy();
    expect(savedMapError({ ...map, zoom: 23 })).toBeTruthy();
    expect(savedMapError({ ...map, area: { type: "Point", coordinates: [0, 0] } })).toBeTruthy();
    expect(savedMapError({ ...map, id: "upm" })).toBeTruthy();
  });

  it("rejects duplicate or missing map ids and malformed map arrays without throwing", () => {
    for (const maps of [[map, map], [null], null, 42]) expect(parseState({ ...emptyState(), maps, activeMapId: map.id }).ok).toBe(false);
    expect(parseState({ ...emptyState(), maps: [map], activeMapId: "missing" }).ok).toBe(false);
  });
});
