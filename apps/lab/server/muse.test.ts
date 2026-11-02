// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import { createMuseHandler } from "./muse";
import { enhancePng } from "./museEnhance";
import { MUSE_MODEL, type MuseResult } from "../src/geo/muse";

const image = new PNG({ width: 8, height: 8 });
for (let i = 0; i < 64; i++) image.data.set([40 + i, 70 + i, 90 + i, i % 4 ? 255 : 0], i * 4);
const png = PNG.sync.write(image);
const area = { type: "Polygon", coordinates: [[[101, 3], [102, 3], [102, 2], [101, 2], [101, 3]]] };
const input = { mapId: "test-map", mapName: "Test map", objective: "Improve canopy visibility and analyze this area.", source: "esri", width: 8, height: 8, corners: area.coordinates[0]!.slice(0, 4), area, imageDataUrl: `data:image/png;base64,${png.toString("base64")}` };
const settings = { brightness: 10, contrast: 1.1, saturation: 1.05, sharpen: 0.25, reason: "Lift dark canopy details conservatively." };
const analysis = { summary: "Plantation-like rows are visible.", observations: ["Repeated canopy patterns."], improvements: [{ title: "Inspect gaps", action: "Draw a smaller region around gaps.", reason: "Improve segmentation specificity." }], limitations: ["RGB alone does not measure canopy height."], enhancementReview: "Contrast improves row visibility, but creates no new detail." };
const plan = (args: unknown = settings) => Response.json({ id: "plan", model: MUSE_MODEL, choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call-enhance", type: "function", function: { name: "enhance_satellite_image", arguments: JSON.stringify(args) } }] } }], usage: { total_tokens: 10 } });
const review = () => Response.json({ id: "review", model: MUSE_MODEL, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(analysis) } }], usage: { total_tokens: 20 } });
const request = (data: unknown = input, origin = "http://localhost:5173") => new Request("http://localhost:5173/api/muse/run", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(data) });

describe("Muse selected-area enhancement agent", () => {
  it("preserves identity settings, alpha and exact pixel positions", () => {
    const identity = enhancePng(png, { brightness: 0, contrast: 1, saturation: 1, sharpen: 0, reason: "Identity" });
    expect(identity.changedPixels).toBe(0);
    expect(PNG.sync.read(identity.bytes).data).toEqual(image.data);
    const output = PNG.sync.read(enhancePng(png, settings).bytes);
    expect([output.width, output.height]).toEqual([8, 8]);
    for (let i = 0; i < 64; i++) {
      expect(output.data[i * 4 + 3]).toBe(image.data[i * 4 + 3]);
      if (!image.data[i * 4 + 3]) expect(output.data.subarray(i * 4, i * 4 + 4)).toEqual(image.data.subarray(i * 4, i * 4 + 4));
    }
  });
  it("executes exactly one allowed image tool and reviews the actual output", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(plan()).mockResolvedValueOnce(review());
    const save = vi.fn();
    const handler = createMuseHandler("secret-fixture", send, { load: async () => null, save });
    const response = await handler(request());
    const result = await response.json() as MuseResult;
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ status: "completed", mapId: input.mapId, settings, analysis });
    expect(send).toHaveBeenCalledTimes(2);
    const first = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(first.tool_choice).toBe("auto");
    expect(first.parallel_tool_calls).toBeUndefined();
    const second = JSON.parse(send.mock.calls[1]![1]!.body as string);
    expect(second.tools).toBeUndefined();
    expect(second.tool_choice).toBeUndefined();
    expect(second.messages.at(-1).content[1].image_url.url).toBe(result.enhancedImageDataUrl);
    expect(second.messages.at(-2)).toMatchObject({ role: "tool", tool_call_id: "call-enhance" });
    expect(second.store).toBe(false);
    expect(second.model).toBe(MUSE_MODEL);
    expect(JSON.stringify(result)).not.toContain("secret-fixture");
    expect(save).toHaveBeenCalledWith(result);
    expect((await (await handler(new Request("http://localhost:5173/api/muse/result?mapId=other"))).json()).result).toBeNull();
    expect((await (await handler(new Request("http://localhost:5173/api/muse/result?mapId=test-map"))).json()).result.id).toBe(result.id);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("retains the enhancement as partial output when review fails without retrying", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(plan()).mockResolvedValueOnce(new Response("upstream error", { status: 503 }));
    const response = await createMuseHandler("fixture", send)(request());
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ status: "partial", analysis: null });
    expect(result.enhancedImageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.trace.at(-1).status).toBe("error");
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("rejects unsafe tool parameters instead of applying arbitrary edits", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(plan({ ...settings, contrast: 100 }));
    const response = await createMuseHandler("fixture", send)(request());
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/out-of-range/);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-origin, Google imagery, invalid polygons and corrupt PNGs before inference", async () => {
    const send = vi.fn<typeof fetch>();
    const handler = createMuseHandler("fixture", send);
    expect((await handler(request(input, "https://other.test"))).status).toBe(403);
    expect((await handler(request({ ...input, source: "google" }))).status).toBe(400);
    expect((await handler(request({ ...input, area: null }))).status).toBe(400);
    expect((await handler(request({ ...input, imageDataUrl: input.imageDataUrl.slice(0, -12) + "AAAAAAAAAAAA" }))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it("does not dispatch with a missing key and never retries provider errors", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("upstream", { status: 429 }));
    expect((await createMuseHandler("", send)(request())).status).toBe(503);
    expect(send).not.toHaveBeenCalled();
    expect((await createMuseHandler("fixture", send)(request())).status).toBe(502);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not label truncated or malformed review text as a completed analysis", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(plan()).mockResolvedValueOnce(Response.json({ model: MUSE_MODEL, choices: [{ finish_reason: "length", message: { content: JSON.stringify(analysis) } }] }));
    const response = await createMuseHandler("fixture", send)(request());
    expect(await response.json()).toMatchObject({ status: "partial", analysis: null, error: "Muse did not complete the analysis report." });
  });
  it("records useful provider errors while redacting credentials and image bytes", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "fixture-secret rejected data:image/png;base64,AAAA", param: "tool_choice", type: "invalid_request_error" } }, { status: 400 }));
    const response = await createMuseHandler("fixture-secret", send)(request());
    const value = await response.json();
    expect(value.trace.find((step: { stage: string }) => step.stage === "Muse inspects original")).toMatchObject({ status: "error", detail: { httpStatus: 400, providerError: { param: "tool_choice" } } });
    expect(JSON.stringify(value)).not.toContain("fixture-secret");
    expect(JSON.stringify(value)).not.toContain("base64,AAAA");
  });
  it("aborts before the review and does not save a cancelled run", async () => {
    const controller = new AbortController();
    const send = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return plan(); });
    const save = vi.fn();
    const handler = createMuseHandler("fixture", send, { load: async () => null, save });
    const originalRequest = request();
    const response = await handler(new Request(originalRequest, { signal: controller.signal }));
    expect(response.status).toBe(499);
    expect(send).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects overlapping runs and unlocks after completion", async () => {
    let finish!: (response: Response) => void;
    const send = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockResolvedValueOnce(review());
    const handler = createMuseHandler("fixture", send);
    const first = handler(request());
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((await handler(request())).status).toBe(409);
    finish(plan());
    expect((await first).status).toBe(200);
    expect((await (await handler(new Request("http://localhost:5173/api/muse/status"))).json()).running).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

it("uses the selected chat model for both tonal planning and review", async () => {
  const model = "muse-spark-1.2";
  const p = await plan().json(), r = await review().json(); p.model = model; r.model = model;
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(p)).mockResolvedValueOnce(Response.json(r));
  const result = await (await createMuseHandler("fixture", send)(request({ ...input, model }))).json();
  expect(result).toMatchObject({ model, reviewModel: model, status: "completed" });
  expect(send.mock.calls.map(call => JSON.parse(call[1]!.body as string).model)).toEqual([model, model]);
});
