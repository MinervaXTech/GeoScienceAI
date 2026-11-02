import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import type { Connect, Plugin } from "vite";
import { mercatorWorld, type MusePyramid } from "../src/geo/musePyramid.ts";
import type { MuseResult } from "../src/geo/muse.ts";
import { ESRI_CREDITS } from "../src/geo/sam.ts";

const SIZE = 256;
const validId = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,100}$/.test(value);
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const tilePath = (z: number, x: number, y: number) => `${z}/${x}/${y}.png`;
export interface BuiltPyramid { manifest: MusePyramid; tiles: Map<string, Buffer> }

/** Resample the affine Mercator capture onto XYZ, then downsample its tile levels. */
export function buildMusePyramid(result: MuseResult): BuiltPyramid {
  if (!validId(result.id) || !validId(result.mapId) || !["esri", "earth-engine"].includes(result.input.source) || (result.input.source === "earth-engine" && !result.input.earthEngine?.attribution) || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.enhancedImageDataUrl)) throw Error("Invalid saved Muse enhancement.");
  const frame = result.enhancedFrame ?? result.input;
  if (![frame.width, frame.height].every((v) => Number.isInteger(v) && v > 0 && v <= 2048) || frame.corners.length !== 4
    || !frame.corners.every((p) => p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) < 180 && Math.abs(p[1]) < 85.051129)) throw Error("Enhancement has an invalid coordinate frame.");
  const bytes = Buffer.from(result.enhancedImageDataUrl.split(",")[1]!, "base64");
  if (bytes.length > 24 * 1024 * 1024 || createHash("sha256").update(bytes).digest("hex") !== result.enhancedSha256) throw Error("Saved enhancement image does not match its recorded hash.");
  if (bytes.length < 24 || bytes.readUInt32BE(16) !== frame.width || bytes.readUInt32BE(20) !== frame.height) throw Error("Enhancement dimensions do not match the capture frame.");
  const image = PNG.sync.read(bytes, { checkCRC: true });
  const world = frame.corners.map(mercatorWorld);
  const [ox, oy] = world[0]!, ux = world[1]![0] - ox, uy = world[1]![1] - oy, vx = world[3]![0] - ox, vy = world[3]![1] - oy;
  const determinant = ux * vy - uy * vx;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-20 || world.some((p) => p.some((v) => v < 0 || v > 1))
    || Math.abs(world[2]![0] - ox - ux - vx) > 1e-9 || Math.abs(world[2]![1] - oy - uy - vy) > 1e-9) throw Error("Enhancement must have a valid affine Mercator frame without crossing the date line.");
  const xmin = Math.min(...world.map((p) => p[0])), xmax = Math.max(...world.map((p) => p[0]));
  const ymin = Math.min(...world.map((p) => p[1])), ymax = Math.max(...world.map((p) => p[1]));
  const pixelSize = Math.max(Math.hypot(ux, uy) / frame.width, Math.hypot(vx, vy) / frame.height);
  const nativeZoom = Math.log2(1 / (SIZE * pixelSize));
  // Keep all generated pixels at the highest tile level, rather than rounding
  // down and discarding detail when the model's output sits between XYZ grids.
  const maxzoom = Math.max(0, Math.min(22, result.method === "generative" ? Math.ceil(nativeZoom - 1e-9) : Math.floor(nativeZoom + 1e-9)));
  const ranges = Array.from({ length: maxzoom + 1 }, (_, z) => {
    const n = 2 ** z;
    return { z, x0: Math.max(0, Math.floor(xmin * n)), x1: Math.min(n - 1, Math.ceil(xmax * n - 1e-10) - 1), y0: Math.max(0, Math.floor(ymin * n)), y1: Math.min(n - 1, Math.ceil(ymax * n - 1e-10) - 1) };
  });
  const tileCount = ranges.reduce((total, r) => total + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1), 0);
  if (tileCount > 2048) throw Error("This capture would produce too many tiles. Use a smaller area.");
  const tiles = new Map<string, Buffer>();
  let children = new Map<string, PNG>();
  for (let z = maxzoom; z >= 0; z--) {
    const r = ranges[z]!, level = new Map<string, PNG>(), n = 2 ** z;
    for (let ty = r.y0; ty <= r.y1; ty++) for (let tx = r.x0; tx <= r.x1; tx++) {
      const tile = new PNG({ width: SIZE, height: SIZE });
      for (let py = 0; py < SIZE; py++) for (let px = 0; px < SIZE; px++) {
        const out = (py * SIZE + px) * 4;
        let alpha = 0, red = 0, green = 0, blue = 0;
        if (z === maxzoom) {
          const dx = (tx + (px + 0.5) / SIZE) / n - ox, dy = (ty + (py + 0.5) / SIZE) / n - oy;
          const sx = (dx * vy - dy * vx) / determinant * frame.width - 0.5, sy = (ux * dy - uy * dx) / determinant * frame.height - 0.5;
          if (sx < -0.5 || sy < -0.5 || sx > frame.width - 0.5 || sy > frame.height - 0.5) continue;
          const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
          for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
            const x = Math.max(0, Math.min(frame.width - 1, x0 + bx)), y = Math.max(0, Math.min(frame.height - 1, y0 + by));
            const i = (y * frame.width + x) * 4, weight = (bx ? fx : 1 - fx) * (by ? fy : 1 - fy), a = image.data[i + 3]! * weight;
            alpha += a; red += image.data[i]! * a; green += image.data[i + 1]! * a; blue += image.data[i + 2]! * a;
          }
        } else {
          for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
            const x = px * 2 + bx, y = py * 2 + by;
            const child = children.get(`${tx * 2 + Math.floor(x / SIZE)}/${ty * 2 + Math.floor(y / SIZE)}`);
            if (!child) continue;
            const i = ((y % SIZE) * SIZE + x % SIZE) * 4, a = child.data[i + 3]! / 4;
            alpha += a; red += child.data[i]! * a; green += child.data[i + 1]! * a; blue += child.data[i + 2]! * a;
          }
        }
        if (alpha > 0) { tile.data[out] = Math.round(red / alpha); tile.data[out + 1] = Math.round(green / alpha); tile.data[out + 2] = Math.round(blue / alpha); tile.data[out + 3] = Math.round(alpha); }
      }
      level.set(`${tx}/${ty}`, tile); tiles.set(tilePath(z, tx, ty), PNG.sync.write(tile));
    }
    children = level;
  }
  return { tiles, manifest: {
    version: 1, runId: result.id, mapId: result.mapId, mapName: result.mapName, imageSha256: result.enhancedSha256, createdAt: new Date().toISOString(),
    frame: { width: frame.width, height: frame.height, corners: frame.corners }, area: result.input.area, method: result.method ?? "adjustments",
    bounds: [Math.min(...frame.corners.map((p) => p[0])), Math.min(...frame.corners.map((p) => p[1])), Math.max(...frame.corners.map((p) => p[0])), Math.max(...frame.corners.map((p) => p[1]))],
    minzoom: 0, maxzoom, tileSize: SIZE, tileCount, tiles: [`/api/muse/pyramid/tiles/${result.id}/{z}/{x}/{y}.png${result.method === "generative" ? "?resampling=genai-v2" : ""}`], attribution: `${result.input.source === "earth-engine" ? result.input.earthEngine!.attribution : ESRI_CREDITS} · ${result.method === "generative" ? "AI reconstructed preview" : "Muse tonal enhancement"}`,
  } };
}

export interface PyramidStore {
  loadResult(mapId: string): Promise<MuseResult | null>;
  manifest(runId: string): Promise<MusePyramid | null>;
  active(mapId: string): Promise<MusePyramid | null>;
  tile(runId: string, path: string): Promise<Buffer | null>;
  save(pyramid: BuiltPyramid): Promise<void>;
  activate(manifest: MusePyramid): Promise<void>;
}
const blank = PNG.sync.write(new PNG({ width: SIZE, height: SIZE }));
export function createMusePyramidHandler(store: PyramidStore) {
  const builds = new Map<string, Promise<MusePyramid>>();
  return async (request: Request) => {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/api/muse/pyramid") {
        const mapId = url.searchParams.get("mapId");
        if (!validId(mapId)) return json({ error: "Invalid map id." }, 400);
        return json({ layer: await store.active(mapId) });
      }
      const tile = /^\/api\/muse\/pyramid\/tiles\/([\w-]{1,100})\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
      if (request.method === "GET" && tile) {
        const [, id, zs, xs, ys] = tile, z = Number(zs), x = Number(xs), y = Number(ys);
        if (!Number.isInteger(z) || z > 22 || !Number.isInteger(x) || !Number.isInteger(y) || x >= 2 ** z || y >= 2 ** z) return json({ error: "Invalid pyramid tile." }, 400);
        const manifest = await store.manifest(id!);
        if (!manifest || z > manifest.maxzoom) return json({ error: "Pyramid tile was not found." }, 404);
        return new Response(new Uint8Array(await store.tile(id!, tilePath(z, x, y)) ?? blank), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" } });
      }
      if (request.method !== "POST" || url.pathname !== "/api/muse/pyramid/use") return json({ error: "Unknown pyramid operation." }, 404);
      if (request.headers.get("origin") !== url.origin || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) return json({ error: "Load Muse enhancements from this app." }, 403);
      const raw = await request.text();
      if (raw.length > 1024) return json({ error: "Invalid enhancement selection." }, 413);
      let mapId: unknown, runId: unknown;
      try { ({ mapId, runId } = JSON.parse(raw)); } catch { return json({ error: "Invalid enhancement selection." }, 400); }
      if (!validId(mapId) || !validId(runId)) return json({ error: "Invalid map or enhancement id." }, 400);
      const map = mapId, run = runId;
      let manifest = await store.manifest(run);
      if (!manifest) {
        let build = builds.get(run);
        if (!build) {
          build = (async () => {
            const result = await store.loadResult(map);
            if (!result || result.id !== run || result.mapId !== map) throw Error("This enhancement is no longer the saved output. Refresh the Muse panel and try again.");
            const pyramid = buildMusePyramid(result);
            await store.save(pyramid);
            return pyramid.manifest;
          })();
          builds.set(run, build);
        }
        try { manifest = await build; } finally { if (builds.get(run) === build) builds.delete(run); }
      }
      if (manifest.mapId !== map || manifest.runId !== run) return json({ error: "This enhancement belongs to another map." }, 409);
      request.signal.throwIfAborted();
      await store.activate(manifest);
      return json({ layer: manifest });
    } catch (e) { return json({ error: request.signal.aborted ? "Loading the Muse enhancement was cancelled." : e instanceof Error ? e.message : "The enhancement pyramid could not be loaded." }, request.signal.aborted ? 499 : 422); }
  };
}

export function musePyramidPlugin(): Plugin {
  const root = resolve(process.cwd(), ".local/muse"), pyramids = resolve(root, "pyramids"), active = resolve(root, "active-pyramids");
  const readJson = async <T,>(file: string): Promise<T | null> => { try { return JSON.parse(await readFile(file, "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw Error("Saved pyramid metadata could not be read."); } };
  const store: PyramidStore = {
    loadResult: (id) => readJson<MuseResult>(resolve(root, `${id}.json`)),
    manifest: (id) => readJson<MusePyramid>(resolve(pyramids, id, "manifest.json")),
    async active(id) { const value = await readJson<{ runId: string }>(resolve(active, `${id}.json`)); return value && validId(value.runId) ? store.manifest(value.runId) : null; },
    async tile(id, path) { try { return await readFile(resolve(pyramids, id, path)); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } },
    async save({ manifest, tiles }) {
      const temporary = resolve(pyramids, `${manifest.runId}.tmp-${randomUUID()}`);
      await mkdir(temporary, { recursive: true });
      try {
        await Promise.all([...tiles].map(async ([path, bytes]) => { const file = resolve(temporary, path); await mkdir(resolve(file, ".."), { recursive: true }); await writeFile(file, bytes); }));
        await writeFile(resolve(temporary, "manifest.json"), JSON.stringify(manifest));
        await rename(temporary, resolve(pyramids, manifest.runId));
      } catch (e) { await rm(temporary, { recursive: true, force: true }); throw e; }
    },
    async activate(manifest) {
      await mkdir(active, { recursive: true });
      const file = resolve(active, `${manifest.mapId}.json`), temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ runId: manifest.runId })); await rename(temporary, file);
    },
  };
  const handle = createMusePyramidHandler(store);
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/muse/pyramid")) return next();
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.on("aborted", abort); res.on("close", abort);
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size <= 1024) chunks.push(Buffer.from(chunk)); }
      if (size > 1024) { res.statusCode = 413; res.end(JSON.stringify({ error: "Invalid enhancement selection." })); return; }
      const headers = new Headers();
      for (const name of ["origin", "sec-fetch-site"]) { const value = req.headers[name]; if (typeof value === "string") headers.set(name, value); }
      const response = await handle(new Request(new URL(req.url, `http://${req.headers.host ?? "localhost"}`), { method: req.method, headers, signal: controller.signal, ...(req.method === "POST" ? { body: Buffer.concat(chunks).toString("utf8") } : {}) }));
      res.statusCode = response.status; response.headers.forEach((value, name) => res.setHeader(name, value)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { if (!res.writableEnded) { res.statusCode = 502; res.end(JSON.stringify({ error: "Pyramid request interrupted." })); } }
    finally { req.off("aborted", abort); res.off("close", abort); }
  };
  return { name: "muse-enhancement-pyramid", configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
