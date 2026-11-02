import type { Polygon } from "geojson";
import type { SamFrame } from "./sam.ts";

export interface MusePyramid {
  version: 1;
  runId: string;
  mapId: string;
  mapName: string;
  imageSha256: string;
  createdAt: string;
  frame: SamFrame;
  area: Polygon;
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  tileSize: 256;
  tileCount: number;
  tiles: string[];
  attribution: string;
  method?: "adjustments" | "generative";
}

export function mercatorWorld([lng, lat]: number[]): [number, number] {
  return [(lng! + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + lat! * Math.PI / 360)) / Math.PI) / 2];
}
