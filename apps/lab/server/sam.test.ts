// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createSamHandler, decodeSamEvents, validateSamRequest } from "./sam";
import { imagePixelToLngLat, lngLatToImagePixel, type SamFrame } from "../src/geo/sam";
import type { Polygon } from "geojson";
import { newSamRunLog } from "../src/geo/samRunLog";

const frame: SamFrame = { width: 8, height: 8, corners: [[101, 3], [102, 3], [102, 2], [101, 2]] };
const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(8, 16); png.writeUInt32BE(8, 20);
const area: Polygon = { type: "Polygon", coordinates: [[...frame.corners, frame.corners[0]]] };
const input = { ...frame, area, source: "esri", prompt: "palm tree", imageDataUrl: `data:image/png;base64,${png.toString("base64")}` };
const request = (data: unknown = input) => new Request("http://localhost:5173/api/sam/run", { method: "POST", headers: { Origin: "http://localhost:5173" }, body: JSON.stringify(data) });
const lane = { item_id: "fixture", output_index: 0, content_index: 0 };
const maskText = "<0f>0<|box;x1=0;y1=0;x2=7;y2=7;w=8;h=8|><|mask;x=0;y=0;data=8,8,!!!!!*Gu2L.u($+8|>";
const events = [{ type: "response.output_text.delta", ...lane, delta: maskText }, { type: "response.output_text.done", ...lane, text: maskText }, { type: "response.completed", response: { model: "sam-3.1" } }];
const stream = (data: unknown[] = events) => new Response(data.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });

describe("SAM 3.1 request and mask decoding", () => {
  it("decodes a nonempty final content part even when there are no delta events", async () => {
    const audit = newSamRunLog("fixture", "upm", "tree").decoding;
    const contentOnly = [{ type: "response.content_part.done", ...lane, part: { type: "output_text", text: maskText } }, events.at(-1)!];
    expect((await decodeSamEvents(contentOnly, frame, area, audit)).features).toHaveLength(1);
    expect(audit).toMatchObject({ masks: 1, displayedSegments: 1, status: "completed", normalization: ["content_part.done_to_output_text.done"] });
  });
  it("supports content-part finalization after deltas and explicit empty output", async () => {
    const content = { type: "response.content_part.done", ...lane, part: { type: "output_text", text: maskText } };
    expect((await decodeSamEvents([events[0]!, content, events.at(-1)!], frame)).features).toHaveLength(1);
    expect((await decodeSamEvents([{ ...content, part: { type: "output_text", text: "" } }, events.at(-1)!], frame)).features).toEqual([]);
  });
  it("does not turn refusals, unexpected text or unknown output into zero matches", async () => {
    for (const part of [{ type: "refusal", refusal: "not allowed" }, { type: "output_text", text: "unexpected reply" }]) await expect(decodeSamEvents([{ type: "response.content_part.done", ...lane, part }, events.at(-1)!], frame)).rejects.toThrow();
    await expect(decodeSamEvents([{ type: "response.completed", response: { output: [{ type: "image" }] } }], frame)).rejects.toThrow(/unrecognized/);
  });
  it("records clipping separately from provider mask counts", async () => {
    const audit = newSamRunLog("fixture", "upm", "tree").decoding;
    const outside: Polygon = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    expect((await decodeSamEvents(events, frame, outside, audit)).features).toHaveLength(0);
    expect(audit).toMatchObject({ masks: 1, clippedAway: 1, displayedSegments: 0 });
  });
  it("rejects external image URLs, inconsistent image sizes, invalid coordinates, and multi-concept prompts", () => {
    for (const invalid of [{ ...input, imageDataUrl: "https://example.com/image.png" }, { ...input, width: 9 }, { ...input, source: "google" }, { ...input, prompt: "tree, car" }, { ...input, corners: [[101, 99], ...frame.corners.slice(1)] }]) {
      expect(() => validateSamRequest(invalid)).toThrow();
    }
    expect(validateSamRequest(input).prompt).toBe("palm tree");
  });

  it("converts official one-bit mask output to bounded map polygons", async () => {
    const regions = await decodeSamEvents(events, frame);
    expect(regions.features).toHaveLength(1);
    expect(regions.features[0]!.geometry.type).toBe("MultiPolygon");
    for (const polygon of regions.features[0]!.geometry.coordinates) for (const ring of polygon) for (const [lon, lat] of ring) {
      expect(lon).toBeGreaterThanOrEqual(101); expect(lon).toBeLessThanOrEqual(102);
      expect(lat).toBeGreaterThanOrEqual(2 - 1e-9); expect(lat).toBeLessThanOrEqual(3 + 1e-9);
    }
  });

  it("accepts zero matches and rejects incomplete output, wrong models, and wrong frame dimensions", async () => {
    expect((await decodeSamEvents([{ type: "response.completed" }], frame)).features).toEqual([]);
    await expect(decodeSamEvents(events.slice(0, -1), frame)).rejects.toThrow();
    await expect(decodeSamEvents([{ type: "response.completed", response: { model: "other" } }], frame)).rejects.toThrow();
    await expect(decodeSamEvents(events, { ...frame, width: 9 })).rejects.toThrow();
  });

  it("clips masks to the selected polygon instead of returning the bounding rectangle", async () => {
    const triangle: Polygon = { type: "Polygon", coordinates: [[[0, 0], [8, 0], [0, 8], [0, 0]].map(([x, y]) => imagePixelToLngLat(frame, x!, y!))] };
    const regions = await decodeSamEvents(events, frame, triangle);
    expect(regions.features.length).toBeGreaterThan(0);
    for (const feature of regions.features) for (const polygon of feature.geometry.coordinates) for (const ring of polygon) for (const point of ring) {
      const [x, y] = lngLatToImagePixel(frame, [point[0]!, point[1]!]);
      expect(x).toBeGreaterThanOrEqual(-1e-8); expect(y).toBeGreaterThanOrEqual(-1e-8);
      expect(x + y).toBeLessThanOrEqual(8 + 1e-8);
    }
  });

  it("maps captured-image corners and centre correctly, including a rotated frame", () => {
    const topLeft = imagePixelToLngLat(frame, 0, 0), bottomRight = imagePixelToLngLat(frame, 8, 8);
    expect(topLeft[0]).toBeCloseTo(101, 9); expect(topLeft[1]).toBeCloseTo(3, 9);
    expect(bottomRight[0]).toBeCloseTo(102, 9); expect(bottomRight[1]).toBeCloseTo(2, 9);
    const rotated: SamFrame = { ...frame, corners: [[101.5, 3], [102, 2.5], [101.5, 2], [101, 2.5]] };
    expect(imagePixelToLngLat(rotated, 8, 0)).toEqual([102, expect.closeTo(2.5, 8)]);
    expect(imagePixelToLngLat(rotated, 4, 4)[0]).toBeCloseTo(101.5, 9);
  });
});

describe("SAM endpoint", () => {
  it("restores an earlier result without inference or replacing the latest result", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(stream()).mockResolvedValueOnce(stream([{ type: "response.completed" }]));
    const original = createSamHandler("key", send);
    const positive = await (await original(request({ ...input, mapId: "map-field", runId: "old-positive" }))).json();
    const empty = await (await original(request({ ...input, mapId: "map-field", runId: "new-empty" }))).json();
    const history = await (await original(new Request("http://localhost:5173/api/sam/runs"))).json();
    const offlineSend = vi.fn<typeof fetch>();
    const saveResult = vi.fn().mockResolvedValue(undefined);
    const restarted = createSamHandler("key", offlineSend, { initial: empty, initialRuns: history.runs, save: async () => {}, saveResult });
    const restored = await restarted(new Request("http://localhost:5173/api/sam/result?runId=old-positive&mapId=map-field"));
    expect(restored.status).toBe(200);
    const body = await restored.json();
    expect(body.result.regions).toEqual(positive.regions);
    expect(body.result.objects).toBe(1); expect(body.result.runLog.id).toBe("old-positive");
    expect(saveResult).toHaveBeenCalledWith(body.result);
    expect(offlineSend).not.toHaveBeenCalled();
    expect((await (await restarted(new Request("http://localhost:5173/api/sam/result"))).json()).result.runLog.id).toBe("new-empty");
    expect((await restarted(new Request("http://localhost:5173/api/sam/result?runId=old-positive&mapId=other-map"))).status).toBe(404);
  });
  it("loads an archived result when only a truncated summary remains", async () => {
    const original = createSamHandler("key", vi.fn<typeof fetch>().mockResolvedValueOnce(stream()));
    const positive = await (await original(request({ ...input, mapId: "map-field", runId: "archived-positive" }))).json();
    const run = { ...positive.runLog, provider: { ...positive.runLog.provider, outputTextTruncated: true } };
    const offlineSend = vi.fn<typeof fetch>(), loadResult = vi.fn().mockResolvedValue(positive);
    const restarted = createSamHandler("key", offlineSend, { initial: null, initialRuns: [run], save: async () => {}, hasResult: () => true, loadResult });
    expect((await (await restarted(new Request("http://localhost:5173/api/sam/runs"))).json()).runs[0].resultAvailable).toBe(true);
    const response = await restarted(new Request("http://localhost:5173/api/sam/result?runId=archived-positive&mapId=map-field"));
    expect(response.status).toBe(200); expect(loadResult).toHaveBeenCalledWith("archived-positive"); expect(offlineSend).not.toHaveBeenCalled();
  });
  it("returns and persists per-run provider evidence without input imagery or credentials", async () => {
    const contentOnly = [{ type: "response.content_part.done", ...lane, part: { type: "output_text", text: maskText } }, { type: "response.completed", response: { id: "provider-response-123", model: "sam-3.1", status: "completed", usage: { output_tokens: 20 } } }];
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(stream(contentOnly));
    const saveRuns = vi.fn().mockResolvedValue(undefined);
    const handle = createSamHandler("secret-model-key", send, { initial: null, save: async () => {}, saveRuns });
    const response = await handle(request({ ...input, runId: "run-content-only", mapId: "map-field" }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.objects).toBe(1);
    expect(result.runLog).toMatchObject({ id: "run-content-only", mapId: "map-field", status: "completed", provider: { httpStatus: 200, eventCount: 2, outputTextLength: maskText.length, response: { id: "provider-response-123" } }, decoding: { masks: 1, displayedSegments: 1 } });
    expect(saveRuns).toHaveBeenCalledWith([result.runLog]);
    const history = await (await handle(new Request("http://localhost:5173/api/sam/runs"))).json();
    expect(history.runs).toEqual([result.runLog]);
    expect(JSON.stringify(history)).not.toContain("secret-model-key");
    expect(JSON.stringify(history)).not.toContain("data:image");
  });
  it("logs a decoding failure and keeps the previous successful result", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(stream()).mockResolvedValueOnce(stream([{ type: "response.content_part.done", ...lane, part: { type: "output_text", text: "secret-model-key is unexpected output" } }, events.at(-1)!]));
    const handle = createSamHandler("secret-model-key", send);
    const success = await (await handle(request())).json();
    const failed = await handle(request({ ...input, prompt: "tree" }));
    expect(failed.status).toBe(502);
    const body = await failed.json();
    expect(body.runLog).toMatchObject({ status: "error", error: { stage: "decode" }, provider: { httpStatus: 200 } });
    expect(JSON.stringify(body)).not.toContain("secret-model-key");
    expect(body.runLog.provider.outputTextPreview).toContain("[REDACTED]");
    expect(await (await handle(new Request("http://localhost:5173/api/sam/result"))).json()).toEqual({ result: success });
    expect((await (await handle(new Request("http://localhost:5173/api/sam/runs"))).json()).runs).toHaveLength(2);
  });
  it("does not dispatch on page load, missing keys, cross-origin requests, or invalid input", async () => {
    const send = vi.fn<typeof fetch>();
    expect((await createSamHandler("", send)(request())).status).toBe(503);
    const handle = createSamHandler("secret-model-key", send);
    const status = await handle(new Request("http://localhost:5173/api/sam/status"));
    expect(await status.json()).toEqual({ configured: true, model: "sam-3.1", usdPerImage: 0.0025, running: false, lastRunAt: null });
    expect((await handle(new Request("http://localhost:5173/api/sam/run", { method: "POST", headers: { Origin: "https://other.example" }, body: JSON.stringify(input) }))).status).toBe(403);
    expect((await handle(request({ ...input, prompt: "" }))).status).toBe(400);
    expect((await handle(request({ ...input, area: undefined }))).status).toBe(400);
    expect((await handle(request({ ...input, area: { type: "Polygon", coordinates: [[[100, 4], [102, 4], [102, 2], [100, 4]]] } }))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("makes one authenticated provider call and returns georeferenced masks without exposing the key", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(stream());
    const save = vi.fn<(result: unknown) => Promise<void>>().mockResolvedValue();
    const handle = createSamHandler("secret-model-key", send, { initial: null, save });
    const response = await handle(request({ ...input, mapId: "map-field-b" }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.mapId).toBe("map-field-b");
    expect(result.model).toBe("sam-3.1"); expect(result.objects).toBe(1); expect(result.imageSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.attribution).toContain("Esri"); expect(JSON.stringify(result)).not.toContain("secret-model-key");
    expect(save).toHaveBeenCalledWith(result);
    expect(await (await handle(new Request("http://localhost:5173/api/sam/result"))).json()).toEqual({ result });
    expect((await (await handle(new Request("http://localhost:5173/api/sam/status"))).json()).lastRunAt).toBe(result.receivedAt);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, options] = send.mock.calls[0]!;
    expect(url).toBe("https://api.meta.ai/v1/responses");
    expect(new Headers(options!.headers).get("Authorization")).toBe("Bearer secret-model-key");
    expect(JSON.parse(options!.body as string)).toMatchObject({ model: "sam-3.1", stream: true, store: false });
  });

  it("does not retry provider errors or expose their bodies", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("secret-model-key", { status: 403 }));
    const response = await createSamHandler("secret-model-key", send)(request());
    expect(response.status).toBe(502); expect(await response.text()).not.toContain("secret-model-key"); expect(send).toHaveBeenCalledTimes(1);
  });

  it("prevents overlapping paid calls", async () => {
    let resolve!: (value: Response) => void;
    const send = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>((r) => { resolve = r; }));
    const handle = createSamHandler("key", send);
    const first = handle(request());
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((await handle(request())).status).toBe(409);
    resolve(stream([]));
    await first;
    expect(send).toHaveBeenCalledTimes(1);
  });
});
