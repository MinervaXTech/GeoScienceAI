export interface DetectorParams {
  minHeightM: number;
  minDistanceM: number;
  smoothing: "mean3x3" | "none";
  exclusionMinHeightM: number;
  exclusionMinAreaM2: number;
}
export interface Raster {
  crs: string;
  transform: number[];
  width: number;
  height: number;
  values: (number | null)[];
}
export interface DetectedPeak {
  id: number;
  row: number;
  col: number;
  heightM: number;
  smoothedHeightM: number;
  epsg3857: [number, number];
  wgs84: [number, number];
}
export const DEFAULT_PARAMS: Readonly<DetectorParams>;
export function detectPeaks(
  raster: Raster,
  params?: Partial<DetectorParams>,
): { params: DetectorParams; peaks: DetectedPeak[]; excludedCells: number[]; stats: { count: number } };
