// @vitest-environment node
import { PNG } from "pngjs";
import { writeArrayBuffer } from "geotiff";
import { describe, expect, it, vi } from "vitest";
import type { Polygon } from "geojson";
import { canopyPlan, clipCanopy, createCanopyHandler, createCanopyReader, CHMV2_NATIVE_RESOLUTION as RES, type CanopyWindow } from "./canopy";
import { RASTER_CORNERS } from "../src/geo/layer";

const HALF = Math.PI * 6378137;
const ll = (x: number, y: number): [number, number] => [x / HALF * 180, Math.atan(Math.sinh(y / 6378137)) * 180 / Math.PI];
const left = Math.floor((103 / 180 * HALF + HALF) / RES) * RES - HALF;
const top = HALF - Math.floor((HALF - 6378137 * Math.log(Math.tan(Math.PI / 4 + 2 * Math.PI / 360))) / RES) * RES;
const shape = (points: number[][]): Polygon => ({ type: "Polygon", coordinates: [points.map(([x, y]) => ll(left + x! * RES, top - y! * RES))] });
const area = shape([[0, 0], [8, 0], [8, 4], [4, 4], [4, 8], [0, 8], [0, 0]]);
const window = (): CanopyWindow => {
  const values: (number | null)[] = Array(64).fill(20);
  values[0] = 1; values[7] = 22; values[2 * 8 + 2] = 0; values[1 * 8 + 1] = null; values[6 * 8 + 6] = 254;
  return { width: 8, height: 8, left, top, dx: RES, dy: -RES, values, noData: 255, sourceDate: "2020-03-01" };
};
const request = (polygon: unknown = area, origin = "http://localhost:5173") => new Request("http://localhost:5173/api/canopy/window", { method: "POST", headers: { Origin: origin }, body: JSON.stringify({ area: polygon }) });

describe("automatic polygon CHMv2 clips", () => {
  it("selects Kluang's own source quadkey, with a bounded native-resolution grid", () => {
    const kluang: Polygon = { type: "Polygon", coordinates: [[[103.2265, 2.062], [103.2318, 2.062], [103.2318, 2.066], [103.2265, 2.066], [103.2265, 2.062]]] };
    const plan = canopyPlan(kluang);
    expect(plan.keys).toEqual(["1322322121"]);
    expect(plan.factor).toBe(1);
    expect(plan.width).toBeLessThanOrEqual(1024);
    expect(plan.height).toBeLessThanOrEqual(1024);
  });
  it("clips to the polygon rather than its rectangle and derives its positive local range", async () => {
    const clip = await clipCanopy(area, async () => window(), new AbortController().signal);
    expect(clip.stats).toEqual({ insideCells: 48, positiveCells: 46, zeroCells: 1, missingCells: 1, minimumM: 1, maximumM: 22 });
    expect(clip.width).toBe(8); expect(clip.height).toBe(8);
    expect(clip.sourceDate).toBe("2020-03-01");
    const numeric = Buffer.from(clip.heightData!.data, "base64");
    expect(clip.heightData!.encoding).toBe("uint8-metres-base64");
    expect(numeric[0]).toBe(1); expect(numeric[7]).toBe(22);
    expect(numeric[2 * 8 + 2]).toBe(0); // Known ground.
    expect(numeric[1 * 8 + 1]).toBe(255); // Missing, distinct from ground.
    expect(numeric[6 * 8 + 6]).toBe(255); // Outside polygon, not a high canopy.

    const png = PNG.sync.read(Buffer.from(clip.imageDataUrl.split(",")[1]!, "base64"));
    const alpha = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3];
    expect(alpha(6, 6)).toBe(0); // Out-of-polygon high value cannot extend the spectrum.
    expect(alpha(2, 2)).toBe(0); // Zero height.
    expect(alpha(1, 1)).toBe(0); // Missing sample.
    expect(alpha(7, 0)).toBe(255);
    expect([...png.data.subarray(7 * 4, 7 * 4 + 3)]).toEqual([223, 54, 47]);
  });
  it("reports missing coverage without inventing heights or substituting the UPM layer", async () => {
    const clip = await clipCanopy(area, async () => null, new AbortController().signal);
    expect(clip.stats).toMatchObject({ positiveCells: 0, zeroCells: 0, missingCells: 48, minimumM: null, maximumM: null });
    expect(clip.sources[0]!.available).toBe(false);
  });
  it("caches by exact polygon and fetches a new clip for a different finished area", async () => {
    const reader = vi.fn(async () => window()), factory = vi.fn(() => reader), handler = createCanopyHandler(factory);
    const a = await (await handler(request())).json();
    const cached = await (await handler(request())).json();
    expect(cached).toMatchObject({ id: a.id, cached: true }); expect(reader).toHaveBeenCalledTimes(1);
    const smaller = shape([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]);
    const b = await (await handler(request(smaller))).json();
    expect(b.id).not.toBe(a.id); expect(b.area).toEqual(smaller); expect(b.width).toBe(4);
    expect(reader).toHaveBeenCalledTimes(2);
  });
  it("preserves the built-in UPM subset without fetching it again", async () => {
    const factory = vi.fn();
    const handler = createCanopyHandler(factory);
    const response = await handler(request({ type: "Polygon", coordinates: [[...RASTER_CORNERS, RASTER_CORNERS[0]]] }));
    expect(response.status).toBe(200);
    const clip = await response.json();
    expect(clip.sourceDate).toBe("2019-10-23"); expect(clip.stats.maximumM).toBe(19);
    expect(factory).not.toHaveBeenCalled();
  });
  it("rejects invalid/cross-origin polygons before source access and bounds large grids", async () => {
    const factory = vi.fn(), handler = createCanopyHandler(factory);
    expect((await handler(request(area, "https://other.test"))).status).toBe(403);
    expect((await handler(request(null))).status).toBe(422);
    expect((await handler(request({ type: "Point", coordinates: [103, 2] }))).status).toBe(422);
    expect(factory).not.toHaveBeenCalled();
    const large: Polygon = { type: "Polygon", coordinates: [[[103, 2], [103.1, 2], [103.1, 2.1], [103, 2.1], [103, 2]]] };
    const plan = canopyPlan(large); expect(plan.factor).toBeGreaterThan(1); expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(1024);
    expect(() => canopyPlan({ type: "Polygon", coordinates: [[[90, 0], [110, 0], [110, 20], [90, 20], [90, 0]]] })).toThrow(/16 CHMv2/);
  });
  it("reads only byte ranges from the fixed public source and decodes the numeric band", async () => {
    const values = Uint8Array.from({ length: 64 }, (_, i) => i % 25);
    const file = new Uint8Array(writeArrayBuffer(values, { width: 8, height: 8, BitsPerSample: [8], SamplesPerPixel: 1, SampleFormat: [1], PhotometricInterpretation: 1, ModelPixelScale: [RES, RES, 0], ModelTiepoint: [0, 0, 0, left, top, 0], ProjectedCSTypeGeoKey: 3857, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1 }));
    const send = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get("range")!)!;
      const start = Number(range[1]), end = Math.min(file.length - 1, Number(range[2]));
      return new Response(file.slice(start, end + 1), { status: 206, headers: { "content-range": `bytes ${start}-${end}/${file.length}` } });
    });
    const result = await createCanopyReader(send)("1322322121", [left, top - 8 * RES, left + 8 * RES, top], RES, new AbortController().signal);
    expect(result?.width).toBe(8); expect(result?.height).toBe(8); expect(Array.from(result!.values)).toEqual(Array.from(values));
    expect(send.mock.calls.every(([url, init]) => String(url).startsWith("https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/") && !new Headers(init?.headers).has("authorization"))).toBe(true);
  });
  it("refuses whole-file fallbacks instead of downloading a source COG", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("full file", { status: 200 }));
    await expect(createCanopyReader(send)("1322322121", [left, top - 8 * RES, left + 8 * RES, top], RES, new AbortController().signal)).rejects.toThrow(/valid byte range/);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("upgrades an old overlay-only cache when numeric heights are requested", async () => {
    const original = await clipCanopy(area, async () => window(), new AbortController().signal);
    const legacy = { ...original, heightData: undefined }, reader = vi.fn(async () => window());
    const store = { load: vi.fn(async () => legacy), save: vi.fn() };
    const handler = createCanopyHandler(() => reader, store);
    const response = await handler(new Request("http://localhost:5173/api/canopy/window", { method: "POST", headers: { Origin: "http://localhost:5173" }, body: JSON.stringify({ area, numeric: true }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).heightData.encoding).toBe("uint8-metres-base64");
    expect(reader).toHaveBeenCalledOnce(); expect(store.save).toHaveBeenCalledOnce();
  });

});
