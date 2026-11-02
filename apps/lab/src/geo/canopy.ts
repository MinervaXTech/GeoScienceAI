import type { Polygon } from "geojson";
import type { MapCorners } from "./sam.ts";

export const CANOPY_CREDITS = "Meta/WRI CHMv2 · source imagery Vantor · CC BY 4.0";
export const CHMV2_ROOT = "https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/";
export const HEIGHT_COLORS = [[110, 64, 170], [63, 99, 233], [29, 174, 227], [40, 199, 133], [158, 211, 78], [249, 211, 59], [248, 138, 43], [223, 54, 47]] as const;
export const CANOPY_GRADIENT = `linear-gradient(90deg, ${HEIGHT_COLORS.map((rgb) => `rgb(${rgb.join(", ")})`).join(", ")})`;
export function canopyRgb(height: number, min: number, max: number): number[] {
  const position = Math.max(0, Math.min(1, (height - min) / (max - min || 1))) * (HEIGHT_COLORS.length - 1);
  const lo = Math.floor(position), a = HEIGHT_COLORS[lo]!, b = HEIGHT_COLORS[Math.min(lo + 1, HEIGHT_COLORS.length - 1)]!;
  return a.map((value, i) => Math.round(value + (b[i]! - value) * (position - lo)));
}
export interface CanopyClip {
  version: 1;
  id: string;
  dataset: "Meta/WRI CHMv2";
  area: Polygon;
  width: number;
  height: number;
  corners: MapCorners;
  resolutionMapM: number;
  nativeResolutionMapM: number;
  sampled: boolean;
  fetchedAt: string;
  sourceDate: string | null;
  sources: { quadkey: string; url: string; available: boolean; overviewResolutionMapM?: number }[];
  stats: { insideCells: number; positiveCells: number; zeroCells: number; missingCells: number; minimumM: number | null; maximumM: number | null };
  imageDataUrl: string;
  /** Numeric source heights; zero is ground, 255 is missing/outside. */
  heightData?: { encoding: "uint8-metres-base64"; data: string };
  cached?: boolean;
}
