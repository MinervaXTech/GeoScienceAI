// @vitest-environment node
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { buildMusePyramid, createMusePyramidHandler, type PyramidStore, type BuiltPyramid } from "./musePyramid";
import type { MuseResult } from "../src/geo/muse";
import type { MusePyramid } from "../src/geo/musePyramid";
import type { MapCorners } from "../src/geo/sam";

function fixture(opaque = false): MuseResult {
  const png = new PNG({ width: 256, height: 256 });
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) png.data.set([x, y, 120, opaque || x + y < 256 ? 255 : 0], (y * 256 + x) * 4);
  const bytes = PNG.sync.write(png), imageDataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  const lngLat = (x: number, y: number): [number, number] => [x / 16 * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 16))) * 180 / Math.PI];
  const corners: MapCorners = [lngLat(9, 7), lngLat(10, 7), lngLat(10, 8), lngLat(9, 8)];
  const sha = createHash("sha256").update(bytes).digest("hex");
  return { id: "run-a", mapId: "map-a", mapName: "Map A", model: "muse-spark-1.3", status: "completed", objective: "Enhance", receivedAt: "2026-11-01T00:00:00Z", durationMs: 1,
    input: { width: 256, height: 256, corners, area: { type: "Polygon", coordinates: [[...corners, corners[0]]] }, source: "esri", imageDataUrl },
    inputSha256: sha, enhancedSha256: sha, enhancedImageDataUrl: imageDataUrl, settings: { brightness: 0, contrast: 1, saturation: 1, sharpen: 0, reason: "Fixture" }, analysis: null, trace: [] };
}
const pixel = (png: PNG, x: number, y: number) => [...png.data.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4)];
function memoryStore(result = fixture()) {
  const saved = new Map<string, BuiltPyramid>(), active = new Map<string, string>();
  const store: PyramidStore = {
    loadResult: vi.fn(async (id: string) => id === result.mapId ? result : null),
    manifest: async (id) => saved.get(id)?.manifest ?? null,
    active: async (id) => saved.get(active.get(id) ?? "")?.manifest ?? null,
    tile: async (id, path) => saved.get(id)?.tiles.get(path) ?? null,
    save: vi.fn(async (p: BuiltPyramid) => { saved.set(p.manifest.runId, p); }),
    activate: vi.fn(async (manifest: MusePyramid) => { active.set(manifest.mapId, manifest.runId); }),
  };
  return store;
}
const use = (body: unknown = { mapId: "map-a", runId: "run-a" }, origin = "http://localhost:5173") => new Request("http://localhost:5173/api/muse/pyramid/use", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) });

describe("Muse enhancement pyramid", () => {
  it("aligns native XYZ pixels to the Mercator capture, preserving transparency", () => {
    const { manifest, tiles } = buildMusePyramid(fixture());
    expect(manifest).toMatchObject({ minzoom: 0, maxzoom: 4, tileSize: 256, tileCount: 5, runId: "run-a", mapId: "map-a" });
    expect(tiles.size).toBe(5);
    const native = PNG.sync.read(tiles.get("4/9/7.png")!);
    expect(pixel(native, 40, 80)).toEqual([40, 80, 120, 255]);
    expect(pixel(native, 200, 200)[3]).toBe(0);
    const parent = PNG.sync.read(tiles.get("3/4/3.png")!);
    expect(pixel(parent, 0, 0)[3]).toBe(0);
    expect(pixel(parent, 133, 133)).toEqual([11, 11, 120, 255]);
    expect(manifest.tiles[0]).toBe("/api/muse/pyramid/tiles/run-a/{z}/{x}/{y}.png");
  });
  it("supports a rotated affine capture rather than stretching its bounds", () => {
    const result = fixture(true), c = result.input.corners;
    result.input.corners = [c[1], c[2], c[3], c[0]];
    const built = buildMusePyramid(result);
    expect(pixel(PNG.sync.read(built.tiles.get("4/9/7.png")!), 10, 20)).toEqual([20, 245, 120, 255]);
  });
  it("rejects altered PNG bytes, mismatched dimensions and non-affine geometry", () => {
    const result = fixture(); result.enhancedSha256 = "0".repeat(64);
    expect(() => buildMusePyramid(result)).toThrow(/hash/);
    const dimensions = fixture(); dimensions.input.width = 512;
    expect(() => buildMusePyramid(dimensions)).toThrow(/dimensions/);
    const warped = fixture(); warped.input.corners[2][0] += 1;
    expect(() => buildMusePyramid(warped)).toThrow(/affine/);
  });
  it("builds only on explicit Use, caches tiles, and restores the selected layer per map", async () => {
    const store = memoryStore(), handler = createMusePyramidHandler(store);
    expect((await (await handler(new Request("http://localhost:5173/api/muse/pyramid?mapId=map-a"))).json()).layer).toBeNull();
    expect(store.loadResult).not.toHaveBeenCalled();
    const response = await handler(use());
    const { layer } = await response.json();
    expect(response.status).toBe(200);
    expect(layer).toMatchObject({ mapId: "map-a", runId: "run-a", tileCount: 5 });
    expect(store.save).toHaveBeenCalledTimes(1);
    expect((await handler(use())).status).toBe(200);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.loadResult).toHaveBeenCalledTimes(1);
    expect((await (await handler(new Request("http://localhost:5173/api/muse/pyramid?mapId=map-a"))).json()).layer.runId).toBe("run-a");
    expect((await (await handler(new Request("http://localhost:5173/api/muse/pyramid?mapId=map-b"))).json()).layer).toBeNull();
    const tile = await handler(new Request("http://localhost:5173/api/muse/pyramid/tiles/run-a/4/9/7.png"));
    expect(tile.headers.get("content-type")).toBe("image/png");
    expect(tile.headers.get("cache-control")).toContain("immutable");
    expect(PNG.sync.read(Buffer.from(await tile.arrayBuffer())).width).toBe(256);
  });
  it("rejects cross-origin, path traversal and mismatched map/run selections", async () => {
    const store = memoryStore(), handler = createMusePyramidHandler(store);
    expect((await handler(use(undefined, "https://other.test"))).status).toBe(403);
    expect((await handler(use({ mapId: "../map-a", runId: "run-a" }))).status).toBe(400);
    expect((await handler(use({ mapId: "map-a", runId: "other-run" }))).status).toBe(422);
    expect(store.save).not.toHaveBeenCalled();
    await handler(use());
    expect((await handler(use({ mapId: "map-b", runId: "run-a" }))).status).toBe(409);
    expect((await handler(new Request("http://localhost:5173/api/muse/pyramid/tiles/run-a/4/16/7.png"))).status).toBe(400);
    expect((await handler(new Request("http://localhost:5173/api/muse/pyramid/tiles/missing/4/9/7.png"))).status).toBe(404);
  });
  it("retains the loaded pyramid when a later Muse output replaces the latest result", async () => {
    const store = memoryStore(), handler = createMusePyramidHandler(store);
    await handler(use());
    vi.mocked(store.loadResult).mockResolvedValue({ ...fixture(), id: "run-b" });
    expect((await handler(use())).status).toBe(200);
    expect((await (await handler(new Request("http://localhost:5173/api/muse/pyramid?mapId=map-a"))).json()).layer.runId).toBe("run-a");
    expect(store.save).toHaveBeenCalledTimes(1);
  });
});
