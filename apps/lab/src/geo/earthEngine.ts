import type { Polygon } from "geojson";
import type { SamFrame } from "./sam.ts";
import { areaBounds, samAreaError } from "./samArea.ts";

export const EE_API = "https://earthengine.googleapis.com/v1/";
// The REST methods used here accept this read-only scope; no Drive or write scope.
export const EE_SCOPE = "https://www.googleapis.com/auth/cloud-platform.read-only";
export const EE_SCENE_LIMIT = 10;
export const EE_SENTINEL_DAYS = 90;
export const EE_DATASETS = [
  { id: "skysat", name: "Planet SkySat RGB · ~0.8 m · 2014–2016", collection: "SKYSAT/GEN-A/PUBLIC/ORTHO/RGB", bands: ["R", "G", "B"], max: 255, resolution: 0.8, attribution: "Planet Labs · SkySat Public Ortho · CC BY 4.0", note: "Sparse historical coverage; availability over this polygon must be checked." },
  { id: "oam", name: "OpenAerialMap · variable resolution", collection: "projects/sat-io/open-datasets/open-aerial-map", bands: ["b1", "b2", "b3"], max: 255, resolution: null, attribution: "Open Imagery Network contributors · OpenAerialMap", note: "Community subset with sparse coverage. Review the selected scene's provider and licence metadata." },
  { id: "naip", name: "USDA NAIP · ~0.6–1 m · United States", collection: "USDA/NAIP/DOQQ", bands: ["R", "G", "B"], max: 255, resolution: null, attribution: "USDA Farm Service Agency · NAIP", note: "United States coverage; not expected to cover Malaysia." },
  { id: "sentinel2", name: "Sentinel-2 RGB · 10 m", collection: "COPERNICUS/S2_SR_HARMONIZED", bands: ["B4", "B3", "B2"], max: 3000, resolution: 10, attribution: "Contains modified Copernicus Sentinel data", note: "10 m RGB pixels do not resolve individual palm crowns. Recent scenes may include clouds." },
] as const;
export type EarthEngineDataset = typeof EE_DATASETS[number];
export interface EarthEngineBand { id: string; grid?: { crsCode?: string; affineTransform?: { scaleX?: number; scaleY?: number; shearX?: number; shearY?: number } } }
export interface EarthEngineScene { name: string; id?: string; type?: string; startTime?: string; bands?: EarthEngineBand[]; properties?: Record<string, unknown> }
export interface EarthEngineProvenance {
  projectId: string; assetId: string; collectionId?: string;
  bands: [string, string, string]; displayMin: number; displayMax: number;
  sourceDate: string | null; nativeResolutionM: number | null;
  exportResolutionMapM: number; attribution: string; previewedAt: string;
}
export const EE_PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
export const EE_ASSET_PATTERN = /^projects\/[\w.-]+\/assets\/[\w./-]+$/;
export function normalizeAssetName(id: string) {
  const name = id.trim();
  if (!EE_ASSET_PATTERN.test(name) || name.split("/").some((part) => part === "." || part === "..") || name.length > 500) throw Error("Enter a full image asset name: projects/your-project/assets/your-image.");
  return name;
}
export function validateEarthEngineProvenance(value: unknown): EarthEngineProvenance {
  const p = value as EarthEngineProvenance;
  if (!p || !EE_PROJECT_PATTERN.test(p.projectId) || !Array.isArray(p.bands) || p.bands.length !== 3 || !p.bands.every((b) => typeof b === "string" && /^[\w.-]{1,100}$/.test(b))
    || !Number.isFinite(p.displayMin) || !Number.isFinite(p.displayMax) || p.displayMin >= p.displayMax
    || !Number.isFinite(p.exportResolutionMapM) || p.exportResolutionMapM <= 0
    || (p.nativeResolutionM !== null && (!Number.isFinite(p.nativeResolutionM) || p.nativeResolutionM <= 0))
    || typeof p.attribution !== "string" || !p.attribution.trim() || p.attribution.length > 1000
    || (p.sourceDate !== null && (typeof p.sourceDate !== "string" || !Number.isFinite(Date.parse(p.sourceDate))))
    || typeof p.previewedAt !== "string" || !Number.isFinite(Date.parse(p.previewedAt))
    || (p.collectionId !== undefined && (typeof p.collectionId !== "string" || p.collectionId.length > 500))) throw Error("Earth Engine image provenance is missing or invalid.");
  // Whitelist metadata: never retain an OAuth token or arbitrary client fields.
  return { projectId: p.projectId, assetId: normalizeAssetName(p.assetId), bands: [...p.bands], displayMin: p.displayMin, displayMax: p.displayMax,
    sourceDate: p.sourceDate, nativeResolutionM: p.nativeResolutionM, exportResolutionMapM: p.exportResolutionMapM, attribution: p.attribution, previewedAt: p.previewedAt,
    ...(p.collectionId ? { collectionId: p.collectionId } : {}) };
}
export function sceneResolution(scene: EarthEngineScene, bands: readonly string[], fallback: number | null = null) {
  const values = bands.map((id) => {
    const grid = scene.bands?.find((band) => band.id === id)?.grid, t = grid?.affineTransform;
    // UTM and Web Mercator have metre units; do not label degrees as metres.
    if (!grid?.crsCode || !/^EPSG:(3857|326\d\d|327\d\d)$/.test(grid.crsCode) || !t || !Number.isFinite(t.scaleX) || !Number.isFinite(t.scaleY)) return null;
    return Math.max(Math.hypot(t.scaleX!, t.shearY ?? 0), Math.hypot(t.scaleY!, t.shearX ?? 0));
  });
  return values.every((v) => v !== null) ? Math.max(...values as number[]) : fallback;
}
type Node = { constantValue: unknown } | { valueReference: string } | { functionInvocationValue: { functionName: string; arguments: Record<string, Node> } };
const constant = (value: unknown): Node => ({ constantValue: value });
const call = (functionName: string, args: Record<string, Node>): Node => ({ functionInvocationValue: { functionName, arguments: args } });
const geometry = (area: Polygon) => call("GeometryConstructors.Polygon", { coordinates: constant(area.coordinates), geodesic: constant(false) });
export function searchExpression(collection: string, area: Polygon, recent = false) {
  const error = samAreaError(area); if (error) throw Error(error);
  let filtered = call("ImageCollection.load", { id: constant(collection) });
  if (recent) {
    const end = new Date(), start = new Date(end); start.setUTCDate(start.getUTCDate() - EE_SENTINEL_DAYS);
    filtered = call("Collection.filter", { collection: filtered, filter: call("Filter.dateRangeContains", { rightField: constant("system:time_start"),
      leftValue: call("DateRange", { start: constant(start.toISOString()), end: constant(end.toISOString()) }) }) });
  }
  // Match ee.Filter.bounds: '.all' compares Features, so the right operand must
  // be explicitly promoted to a Feature. A bare Geometry fails for Images.
  // https://github.com/google/earthengine-api/blob/master/javascript/src/filter.js
  filtered = call("Collection.filter", { collection: filtered,
    filter: call("Filter.intersects", { leftField: constant(".all"), rightValue: call("Feature", { geometry: geometry(area) }) }) });
  return { result: "images", values: { images: call("Collection.limit", { collection: filtered, limit: constant(EE_SCENE_LIMIT), key: constant("system:time_start"), ascending: constant(false) }) } };
}
export function earthEngineFrame(area: Polygon, nativeResolutionM: number | null): SamFrame & { grid: object; resolution: number } {
  const error = samAreaError(area); if (error) throw Error(error);
  const [[west, south], [east, north]] = areaBounds(area);
  const merc = ([lon, lat]: number[]) => [lon! * Math.PI / 180 * 6378137, Math.log(Math.tan(Math.PI / 4 + lat! * Math.PI / 360)) * 6378137];
  const [left, bottom] = merc([west, south]), [right, top] = merc([east, north]);
  const resolution = Math.max((right! - left!) / 1024, (top! - bottom!) / 1024, (nativeResolutionM ?? 0.1) / Math.cos((north + south) / 2 * Math.PI / 180));
  const width = Math.max(1, Math.min(1024, Math.ceil((right! - left!) / resolution))), height = Math.max(1, Math.min(1024, Math.ceil((top! - bottom!) / resolution)));
  const unproject = (x: number, y: number): [number, number] => [x / 6378137 * 180 / Math.PI, Math.atan(Math.sinh(y / 6378137)) * 180 / Math.PI];
  return { width, height, resolution, corners: [unproject(left!, top!), unproject(left! + width * resolution, top!), unproject(left! + width * resolution, top! - height * resolution), unproject(left!, top! - height * resolution)],
    grid: { dimensions: { width, height }, crsCode: "EPSG:3857", affineTransform: { scaleX: resolution, shearX: 0, translateX: left, shearY: 0, scaleY: -resolution, translateY: top } } };
}
export function pixelExpression(assetId: string, area: Polygon, bands: [string, string, string], min: number, max: number) {
  normalizeAssetName(assetId);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max || bands.length !== 3 || !bands.every((b) => /^[\w.-]{1,100}$/.test(b))) throw Error("Choose RGB bands and a display maximum greater than the minimum.");
  const image = call("Image.load", { id: constant(assetId) });
  const clipped = call("Image.clip", { input: image, geometry: geometry(area) });
  return { result: "rgb", values: { rgb: call("Image.visualize", { image: clipped, bands: constant(bands), min: constant(min), max: constant(max) }) } };
}

export async function earthEngineRequest(path: string, token: string, signal: AbortSignal, body?: object, send: typeof fetch = fetch) {
  if (!/^projects\/[\w.-]+\/(?:assets\/[\w./-]+|image:computePixels|imageCollection:computeImages)$/.test(path) || path.split("/").includes("..")) throw Error("Invalid Earth Engine operation.");
  const response = await send(EE_API + path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal, cache: "no-store", redirect: "error" });
  if (!response.ok) {
    let detail = ""; try { detail = String((await response.json()).error?.message ?? "").split(token).join("[redacted]").slice(0, 800); } catch { /* Use status. */ }
    throw Error(`Earth Engine HTTP ${response.status}${detail ? ": " + detail : ""}${response.status === 401 ? " Sign in again." : response.status === 403 ? " Check this account's Earth Engine project permissions and asset access." : ""}`);
  }
  return response;
}
