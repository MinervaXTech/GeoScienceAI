import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { MapLocation } from "./places.ts";

export type BasemapId = "esri" | "google";
export const BASEMAP_NAMES: Record<BasemapId, string> = { esri: "Esri World Imagery", google: "Google satellite" };
export const ESRI_CREDITS = "Esri, Vantor, Earthstar Geographics, and the GIS User Community";
export const DEFAULT_SAM_CONCEPT = "individual oil palm tree canopy";
export type MapCorners = [[number, number], [number, number], [number, number], [number, number]];
export interface SamFrame { width: number; height: number; corners: MapCorners }
export interface SamImage extends SamFrame { imageDataUrl: string; source: BasemapId; area: Polygon }
export interface SamRequest extends SamImage { prompt: string; mapId?: string; runId?: string }
export interface SamDecodeSummary {
  status: "not_started" | "completed" | "error";
  normalization: string[];
  records: number;
  boxes: number;
  masks: number;
  emptyMasks: number;
  clippedAway: number;
  displayedSegments: number;
  diagnostics: { severity: string; code: string; message: string; line?: number }[];
}
export interface SamRunLog {
  id: string;
  mapId: string;
  prompt: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: "capturing" | "running" | "completed" | "error" | "cancelled";
  transport?: { httpStatus: number };
  input?: { source: BasemapId; width: number; height: number; polygonCorners: number; imageSha256?: string };
  provider: {
    httpStatus?: number;
    requestId?: string;
    contentType?: string;
    eventCount: number;
    eventTypes: Record<string, number>;
    terminalEvent?: string;
    outputTextLength: number;
    outputTextPreview: string;
    outputTextTruncated: boolean;
    response?: Record<string, unknown>;
  };
  decoding: SamDecodeSummary;
  error?: { stage: string; message: string };
  warnings?: string[];
  resultAvailable?: boolean;
}
export interface SamResult {
  model: "sam-3.1";
  mapId?: string;
  prompt: string;
  source: BasemapId;
  attribution: string;
  frame: SamFrame;
  /** Absent only on older runs that processed the entire viewport. */
  area?: Polygon;
  imageSha256: string;
  receivedAt: string;
  durationMs: number;
  objects: number;
  regions: FeatureCollection<MultiPolygon>;
  runLog?: SamRunLog;
}
export type CaptureMap = (signal: AbortSignal) => Promise<SamImage>;
export interface SatelliteMapHandle {
  getView(): MapLocation | null;
  /** The ground area currently visible in the canvas, as a closed polygon (follows a rotated view). */
  getViewArea(): Polygon | null;
  locate(location: MapLocation): boolean;
  capture(signal: AbortSignal, area: Polygon): Promise<SamImage>;
  fitOutput(result: SamResult): void;
  fitArea(area: Polygon): void;
}

/** Interpolate in Web Mercator, including a rotated map viewport. */
export function imagePixelToLngLat(frame: SamFrame, x: number, y: number): [number, number] {
  const merc = ([lon, lat]: [number, number]) => [lon * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))] as const;
  const points = frame.corners.map(merc);
  const u = x / frame.width, v = y / frame.height;
  const weights = [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v];
  let mx = 0, my = 0;
  points.forEach((point, i) => { mx += point[0] * weights[i]!; my += point[1] * weights[i]!; });
  return [mx * 180 / Math.PI, (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * 180 / Math.PI];
}

/** Inverse of the affine Mercator capture frame, in source-image pixels. */
export function lngLatToImagePixel(frame: SamFrame, point: [number, number]): [number, number] {
  const merc = ([lon, lat]: [number, number]) => [lon * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))] as const;
  const a = merc(frame.corners[0]), b = merc(frame.corners[1]), d = merc(frame.corners[3]), p = merc(point);
  const bx = b[0] - a[0], by = b[1] - a[1], dx = d[0] - a[0], dy = d[1] - a[1];
  const det = bx * dy - by * dx;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-20) throw Error("Invalid image coordinate frame.");
  const px = p[0] - a[0], py = p[1] - a[1];
  return [(px * dy - py * dx) / det * frame.width, (bx * py - by * px) / det * frame.height];
}
