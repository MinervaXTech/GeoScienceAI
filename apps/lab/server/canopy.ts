import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BaseClient, BaseResponse, fromCustomClient, type GeoTIFF } from "geotiff";
import { PNG } from "pngjs";
import type { Polygon } from "geojson";
import type { Connect, Plugin } from "vite";
import { canopyRgb, CHMV2_ROOT, type CanopyClip } from "../src/geo/canopy.ts";
import { samAreaError } from "../src/geo/samArea.ts";
import { insidePolygon } from "../src/geo/polygonEdit.ts";
import type { MapCorners } from "../src/geo/sam.ts";
import savedRaster from "../src/data/upm-chmv2-native.json" with { type: "json" };

const HALF = Math.PI * 6378137, WORLD = HALF * 2;
export const CHMV2_NATIVE_RESOLUTION = WORLD / 2 ** 25;
type Bounds = [number, number, number, number];
export interface CanopyWindow { width: number; height: number; left: number; top: number; dx: number; dy: number; values: ArrayLike<number | null>; noData: number | null; sourceDate?: string }
export type CanopyReader = (quadkey: string, bounds: Bounds, resolution: number, signal: AbortSignal) => Promise<CanopyWindow | null>;
const merc = ([lon, lat]: number[]): [number, number] => [lon! / 180 * HALF, 6378137 * Math.log(Math.tan(Math.PI / 4 + lat! * Math.PI / 360))];
const ll = (x: number, y: number): [number, number] => [x / HALF * 180, Math.atan(Math.sinh(y / 6378137)) * 180 / Math.PI];
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export function canopyPlan(area: Polygon) {
  const error = samAreaError(area);
  if (error) throw Error(error.replaceAll("SAM", "canopy"));
  const ring = area.coordinates[0]!.map(merc);
  const minX = Math.min(...ring.map((p) => p[0])), maxX = Math.max(...ring.map((p) => p[0]));
  const minY = Math.min(...ring.map((p) => p[1])), maxY = Math.max(...ring.map((p) => p[1]));
  if (maxX - minX > WORLD / 2) throw Error("Draw a polygon that does not cross the date line.");
  const native = CHMV2_NATIVE_RESOLUTION;
  const left = Math.floor((minX + HALF) / native + 1e-7) * native - HALF;
  const top = HALF - Math.floor((HALF - maxY) / native + 1e-7) * native;
  const nativeWidth = Math.max(1, Math.ceil((maxX - left) / native - 1e-7)), nativeHeight = Math.max(1, Math.ceil((top - minY) / native - 1e-7));
  const factor = Math.max(1, Math.ceil(Math.max(nativeWidth, nativeHeight) / 1024));
  const resolution = native * factor, width = Math.ceil(nativeWidth / factor), height = Math.ceil(nativeHeight / factor);
  const right = left + width * resolution, bottom = top - height * resolution;
  const n = 1024, span = WORLD / n;
  const x0 = Math.max(0, Math.floor((minX + HALF) / span)), x1 = Math.min(n - 1, Math.ceil((maxX + HALF) / span - 1e-10) - 1);
  const y0 = Math.max(0, Math.floor((HALF - maxY) / span)), y1 = Math.min(n - 1, Math.ceil((HALF - minY) / span - 1e-10) - 1);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 16) throw Error("This polygon spans more than 16 CHMv2 source tiles. Select a smaller area.");
  const keys: string[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let key = "";
    for (let bit = 9; bit >= 0; bit--) key += String(((x >> bit) & 1) + 2 * ((y >> bit) & 1));
    keys.push(key);
  }
  return { area, ring: ring.map(([x, y]) => ({ x, y })), left, top, width, height, resolution, factor, keys, bounds: [left, bottom, right, top] as Bounds,
    corners: [ll(left, top), ll(right, top), ll(right, bottom), ll(left, bottom)] as MapCorners };
}

/** Mask by cell centres in the actual polygon; zero/missing/outside cells stay transparent. */
export async function clipCanopy(area: Polygon, reader: CanopyReader, signal: AbortSignal, id = "clip"): Promise<CanopyClip> {
  const plan = canopyPlan(area), count = plan.width * plan.height;
  const values = new Float32Array(count).fill(NaN), inside = new Uint8Array(count);
  let insideCells = 0;
  for (let row = 0; row < plan.height; row++) for (let col = 0; col < plan.width; col++) {
    if (insidePolygon(plan.ring, { x: plan.left + (col + 0.5) * plan.resolution, y: plan.top - (row + 0.5) * plan.resolution })) { inside[row * plan.width + col] = 1; insideCells++; }
  }
  const sources: CanopyClip["sources"] = [];
  const dates = new Set<string>();
  for (const quadkey of plan.keys) {
    signal.throwIfAborted();
    const window = await reader(quadkey, plan.bounds, plan.resolution, signal);
    sources.push({ quadkey, url: `${CHMV2_ROOT}chm/${quadkey}.tif`, available: !!window, ...(window ? { overviewResolutionMapM: window.dx } : {}) });
    if (!window) continue;
    if (window.sourceDate) dates.add(window.sourceDate);
    if (window.dx <= 0 || window.dy >= 0 || window.values.length !== window.width * window.height) throw Error("CHMv2 returned an invalid raster window.");
    for (let row = 0; row < plan.height; row++) {
      const y = plan.top - (row + 0.5) * plan.resolution, sy = Math.floor((y - window.top) / window.dy);
      if (sy < 0 || sy >= window.height) continue;
      for (let col = 0; col < plan.width; col++) {
        const i = row * plan.width + col;
        if (!inside[i]) continue;
        const sx = Math.floor((plan.left + (col + 0.5) * plan.resolution - window.left) / window.dx);
        if (sx < 0 || sx >= window.width) continue;
        const value = window.values[sy * window.width + sx];
        if (value !== null && value !== undefined && Number.isFinite(value) && value >= 0 && value <= 254 && value !== window.noData) values[i] = value;
      }
    }
  }
  let min = Infinity, max = -Infinity, positiveCells = 0, zeroCells = 0, missingCells = 0;
  for (let i = 0; i < count; i++) {
    if (!inside[i]) continue;
    const value = values[i]!;
    if (!Number.isFinite(value)) missingCells++;
    else if (value === 0) zeroCells++;
    else { positiveCells++; min = Math.min(min, value); max = Math.max(max, value); }
  }
  const numeric = new Uint8Array(count).fill(255);
  for (let i = 0; i < count; i++) if (inside[i] && Number.isFinite(values[i]!)) numeric[i] = Math.round(values[i]!);
  const png = new PNG({ width: plan.width, height: plan.height });
  if (positiveCells) for (let i = 0; i < count; i++) if (inside[i] && values[i]! > 0) png.data.set([...canopyRgb(values[i]!, min, max), 255], i * 4);
  return { version: 1, id, dataset: "Meta/WRI CHMv2", area, width: plan.width, height: plan.height, corners: plan.corners,
    resolutionMapM: plan.resolution, nativeResolutionMapM: CHMV2_NATIVE_RESOLUTION, sampled: plan.factor > 1, fetchedAt: new Date().toISOString(), sourceDate: dates.size === 1 ? [...dates][0]! : null,
    heightData: { encoding: "uint8-metres-base64", data: Buffer.from(numeric).toString("base64") },
    sources, stats: { insideCells, positiveCells, zeroCells, missingCells, minimumM: positiveCells ? min : null, maximumM: positiveCells ? max : null }, imageDataUrl: `data:image/png;base64,${PNG.sync.write(png).toString("base64")}` };
}

class MissingTile extends Error {}
class RangeResponse extends BaseResponse {
  constructor(private readonly response: Response, private readonly bytes: ArrayBuffer) { super(); }
  get status() { return this.response.status; }
  getHeader(name: string) { return this.response.headers.get(name) ?? undefined; }
  async getData() { return this.bytes; }
}
/** Fixed public host, strict byte ranges and a shared download budget per polygon. */
export function createCanopyReader(send: typeof fetch = fetch): CanopyReader {
  let downloaded = 0;
  return async (quadkey, bounds, target, signal) => {
    if (!/^[0-3]{10}$/.test(quadkey)) throw Error("Invalid CHMv2 source tile.");
    const failure: { error: Error | null } = { error: null };
    let tiff: GeoTIFF | undefined;
    class Client extends BaseClient {
      async request(options: RequestInit = {}): Promise<BaseResponse> {
        if (failure.error) throw failure.error;
        try {
          const headers = new Headers(options.headers), range = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range") ?? "");
          if (!range || Number(range[2]) - Number(range[1]) > 8 * 1024 * 1024) throw Error("CHMv2 reader requested an excessive byte range.");
          const response = await send(this.url, { headers, signal: options.signal ?? signal, redirect: "error" });
          if (response.status === 404) throw new MissingTile("No CHMv2 tile covers this portion of the polygon.");
          const actual = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
          if (response.status !== 206 || !actual || actual[1] !== range[1] || Number(actual[2]) !== Math.min(Number(range[2]), Number(actual[3]) - 1)) { await response.body?.cancel(); throw Error(`CHMv2 source did not supply a valid byte range (HTTP ${response.status}).`); }
          const size = Number(actual[2]) - Number(actual[1]) + 1;
          if (downloaded + size > 64 * 1024 * 1024) { await response.body?.cancel(); throw Error("CHMv2 window exceeded the 64 MB download bound. Choose a smaller polygon."); }
          downloaded += size;
          const bytes = new Uint8Array(size), stream = response.body?.getReader();
          if (!stream) throw Error("CHMv2 returned an empty range response.");
          let offset = 0;
          try {
            while (true) {
              const chunk = await stream.read();
              if (chunk.done) break;
              if (offset + chunk.value.length > size) { await stream.cancel(); throw Error("CHMv2 returned more bytes than the requested range."); }
              bytes.set(chunk.value, offset); offset += chunk.value.length;
            }
          } finally { stream.releaseLock(); }
          if (offset !== size) throw Error("CHMv2 returned an incomplete byte range.");
          return new RangeResponse(response, bytes.buffer);
        } catch (e) { failure.error = e instanceof Error ? e : new Error("CHMv2 source request failed."); throw e; }
      }
    }
    try {
      const options = { allowFullFile: false, maxRanges: 0, blockSize: 65536, cacheSize: 64 };
      tiff = await fromCustomClient(new Client(`${CHMV2_ROOT}chm/${quadkey}.tif`), options, signal);
      const base = await tiff.getImage();
      const baseRes = base.getResolution(), origin = base.getOrigin();
      if (Number(base.getGeoKeys()?.ProjectedCSTypeGeoKey) !== 3857 || base.getSamplesPerPixel() !== 1 || base.getBitsPerSample(0) !== 8 || base.getSampleFormat(0) !== 1 || baseRes[0]! <= 0 || baseRes[1]! >= 0 || Math.abs(baseRes[0]! / CHMV2_NATIVE_RESOLUTION - 1) > 0.01) throw Error("Unsupported CHMv2 native grid or units.");
      let image = base, resolution = baseRes;
      const imageCount = Math.min(16, await tiff.getImageCount());
      for (let i = 1; i < imageCount; i++) {
        const overview = await tiff.getImage(i), res = overview.getResolution(base);
        if (overview.getBitsPerSample(0) !== 8 || overview.getSampleFormat(0) !== 1 || overview.getSamplesPerPixel() !== 1) continue;
        if (res[0]! <= target * 1.001 && res[0]! > resolution[0]!) { image = overview; resolution = res; }
      }
      const dx = resolution[0]!, dy = resolution[1]!;
      const x0 = Math.max(0, Math.floor((bounds[0] - origin[0]!) / dx)), x1 = Math.min(image.getWidth(), Math.ceil((bounds[2] - origin[0]!) / dx));
      const y0 = Math.max(0, Math.floor((bounds[3] - origin[1]!) / dy)), y1 = Math.min(image.getHeight(), Math.ceil((bounds[1] - origin[1]!) / dy));
      if (x1 <= x0 || y1 <= y0) return null;
      if ((x1 - x0) * (y1 - y0) > 4_300_000) throw Error("CHMv2 decode window is too large. Select a smaller polygon.");
      const values = await image.readRasters({ window: [x0, y0, x1, y1], samples: [0], interleave: true, signal });
      return { width: x1 - x0, height: y1 - y0, left: origin[0]! + x0 * dx, top: origin[1]! + y0 * dy, dx, dy, noData: base.getGDALNoData(), values };
    } catch (e) { if (failure.error instanceof MissingTile) return null; throw failure.error ?? e; }
    finally { await tiff?.close(); }
  };
}

const bundled: CanopyWindow = { width: savedRaster.width, height: savedRaster.height, left: savedRaster.transform[2]!, top: savedRaster.transform[5]!, dx: savedRaster.transform[0]!, dy: savedRaster.transform[4]!, values: savedRaster.values, noData: null, sourceDate: savedRaster.sourceDate };
interface CanopyStore { load(id: string): Promise<CanopyClip | null>; save(clip: CanopyClip): Promise<void> }
export function createCanopyHandler(readerFactory: () => CanopyReader = createCanopyReader, store?: CanopyStore) {
  const cache = new Map<string, CanopyClip>();
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/api/canopy/window") return json({ error: "Unknown canopy operation." }, 404);
    if (request.headers.get("origin") !== url.origin || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) return json({ error: "Load canopy data from this app." }, 403);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90000)]);
    try {
      const text = await request.text();
      if (text.length > 16384) return json({ error: "Polygon request is too large." }, 413);
      const { area, numeric } = JSON.parse(text); canopyPlan(area);
      if (numeric !== undefined && typeof numeric !== "boolean") throw Error("Invalid numeric canopy request.");
      const id = createHash("sha256").update("chmv2-polygon-v1:" + JSON.stringify(area)).digest("hex");
      const saved = cache.get(id) ?? await store?.load(id);
      if (saved && (!numeric || saved.heightData?.encoding === "uint8-metres-base64") && Date.now() - Date.parse(saved.fetchedAt) < 86400000) return json({ ...saved, cached: true });
      const bounds = canopyPlan(area).bounds;
      const contained = bounds[0] >= bundled.left - 1e-6 && bounds[2] <= bundled.left + bundled.width * bundled.dx + 1e-6 && bounds[1] >= bundled.top + bundled.height * bundled.dy - 1e-6 && bounds[3] <= bundled.top + 1e-6;
      const reader = contained ? async () => bundled : readerFactory();
      const result = await clipCanopy(area, reader, signal, id);
      signal.throwIfAborted();
      cache.set(id, result);
      if (cache.size > 12) cache.delete(cache.keys().next().value!);
      await store?.save(result);
      return json(result);
    } catch (e) { return json({ error: signal.aborted ? "CHMv2 loading cancelled or timed out." : e instanceof Error ? e.message : "Could not load CHMv2 for this polygon." }, signal.aborted ? 499 : 422); }
  };
}

export function canopyPlugin(): Plugin {
  const root = resolve(process.cwd(), ".local/chmv2");
  const handle = createCanopyHandler(createCanopyReader, {
    async load(id) { try { return JSON.parse(await readFile(resolve(root, `${id}.json`), "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } },
    async save(clip) { await mkdir(root, { recursive: true }); const file = resolve(root, `${clip.id}.json`), temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(clip)); await rename(temporary, file); },
  });
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/canopy/")) return next();
    const controller = new AbortController(), abort = () => { if (!res.writableEnded) controller.abort(); };
    req.on("aborted", abort); res.on("close", abort);
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size <= 16384) chunks.push(Buffer.from(chunk)); }
      if (size > 16384) { res.statusCode = 413; res.end(JSON.stringify({ error: "Polygon request is too large." })); return; }
      const headers = new Headers(); for (const name of ["origin", "sec-fetch-site"]) { const value = req.headers[name]; if (typeof value === "string") headers.set(name, value); }
      const response = await handle(new Request(new URL(req.url, `http://${req.headers.host ?? "localhost"}`), { method: req.method, headers, signal: controller.signal, ...(req.method === "POST" ? { body: Buffer.concat(chunks).toString("utf8") } : {}) }));
      res.statusCode = response.status; response.headers.forEach((value, name) => res.setHeader(name, value)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { if (!res.writableEnded) { res.statusCode = 502; res.end(JSON.stringify({ error: "Canopy request interrupted." })); } }
    finally { req.off("aborted", abort); res.off("close", abort); }
  };
  return { name: "polygon-chmv2", configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
