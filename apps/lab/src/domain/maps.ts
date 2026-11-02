import type { LabState, SavedMap } from "./types";
import { samAreaError } from "../geo/samArea";

export function savedMapError(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Invalid saved map.";
  const map = value as SavedMap;
  if (typeof map.id !== "string" || !/^[\w-]{1,100}$/.test(map.id) || map.id === "upm") return "Invalid saved map id.";
  if (typeof map.name !== "string" || !map.name.trim() || map.name.length > 80) return "Enter a map name up to 80 characters.";
  if (!Array.isArray(map.center) || map.center.length !== 2 || !map.center.every(Number.isFinite) || Math.abs(map.center[0]) > 180 || Math.abs(map.center[1]) > 85) return "Enter longitude from −180 to 180 and latitude from −85 to 85.";
  if (!Number.isFinite(map.zoom) || map.zoom < 2 || map.zoom > 22) return "Enter a zoom from 2 to 22.";
  if (map.basemap !== "esri" && map.basemap !== "google") return "Choose a satellite basemap.";
  if (map.boundary !== undefined) {
    const error = samAreaError(map.boundary);
    if (error) return error;
  }
  if (map.area !== undefined) return samAreaError(map.area);
  return null;
}

/** Reuse existing drawn polygons as map boundaries; never invent a geographic extent. */
export function withDefaultMapAreas(state: LabState): LabState {
  if (!state.maps?.some((map) => (!!map.area && !map.boundary) || (!!map.boundary && !map.area))) return state;
  return { ...state, maps: state.maps.map((map) => {
    const boundary = map.boundary ?? map.area;
    return !boundary || (map.boundary && map.area) ? map : { ...map, boundary, area: map.area ?? boundary };
  }) };
}

export function deleteSavedMap(state: LabState, id: string): LabState {
  if (!state.maps?.some((map) => map.id === id)) return state;
  return { ...state, maps: state.maps.filter((map) => map.id !== id), ...(state.activeMapId === id ? { activeMapId: "upm" } : {}) };
}
