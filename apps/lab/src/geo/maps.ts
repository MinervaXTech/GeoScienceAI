import type { SavedMap } from "../domain/types";
import { HOME_WGS84 } from "./layer";

export const UPM_MAP: SavedMap = { id: "upm", name: "UPM, Selangor", center: [...HOME_WGS84], zoom: 18, basemap: "esri" };
