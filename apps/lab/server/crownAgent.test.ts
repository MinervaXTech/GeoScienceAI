// @vitest-environment node
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { createCrownAgentHandler } from "./crownAgent";
import { MUSE_MODEL } from "../src/geo/muse";

const png = new PNG({ width: 32, height: 32 });
for (let i = 0; i < 1024; i++) png.data.set([i % 255, (i * 7) % 255, 60, 255], i * 4);
const bytes = PNG.sync.write(png), imageSha256 = createHash("sha256").update(bytes).digest("hex");
const input = { mapId: "map-test", source: "esri", width: 32, height: 32, imageDataUrl: `data:image/png;base64,${bytes.toString("base64")}`, corners: [[101, 3], [102, 3], [102, 2], [101, 2]], area: { type: "Polygon", coordinates: [[[101, 3], [102, 3], [102, 2], [101, 2], [101, 3]]] }, objective: "Find representative crown candidates" };
const match = { id: "call-match", name: "match_crowns", arguments: { sample: { x: 6, y: 6, width: 8, height: 8 }, settings: { threshold: 0.7, spacing: 0.8, multiScale: true }, reason: "Use a resolved crown sample." } };
const stop = { id: "call-stop", name: "finish_crown_detection", arguments: { reason: "Candidates require visual inspection.", limitations: ["Not a verified tree count."] } };
const provider = (call: { id: string; name: string; arguments: unknown } = match) => Response.json({ id: "meta-response", model: MUSE_MODEL, choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } }], usage: { total_tokens: 120 } }, { headers: { "x-request-id": "provider-request" } });
const request = (data: unknown = input, origin = "http://localhost:5173") => new Request("http://localhost:5173/api/crown-agent/step", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(data) });
const outcome = { status: "completed", count: 3, truncated: false, durationMs: 70, selfMatchOnly: false, scores: { min: 0.7, max: 1, mean: 0.8 }, matches: [{ x: 6, y: 6, width: 8, height: 8, score: 1 }] };

describe("Muse crown-detection agent", () => {
  it("requests one bounded executable matcher tool and records the actual source hash/provider", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(provider());
    const response = await createCrownAgentHandler("fixture-key", send)(request()), data = await response.json();
    expect(response.status).toBe(200); expect(data).toMatchObject({ model: MUSE_MODEL, round: 1, imageSha256, call: match, provider: { requestId: "provider-request", responseId: "meta-response" } });
    expect(send).toHaveBeenCalledTimes(1);
    const body = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(body.messages[1].content[1].image_url.url).toBe(input.imageDataUrl);
    expect(body.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(["match_crowns", "finish_crown_detection"]);
    expect(body.store).toBe(false); expect(JSON.stringify(data)).not.toContain("fixture-key");
  });
  it("feeds actual tool outcomes and candidate overlay back to Muse for its second decision", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(provider(stop));
    const response = await createCrownAgentHandler("fixture", send)(request({ ...input, previous: { call: match, outcome, imageSha256 }, overlayImageDataUrl: input.imageDataUrl }));
    expect(await response.json()).toMatchObject({ round: 2, call: stop });
    const body = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(body.messages[2].tool_calls[0].id).toBe(match.id);
    expect(JSON.parse(body.messages[3].content)).toEqual(outcome);
    expect(body.messages.at(-1).content[1].image_url.url).toBe(input.imageDataUrl);
    expect(send).toHaveBeenCalledOnce();
  });
  it("allows matching errors as feedback so Muse can correct a low-texture sample", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(provider());
    const feedback = { ...outcome, status: "error", count: 0, matches: [], scores: null, error: "This sample has too little texture." };
    expect((await createCrownAgentHandler("fixture", send)(request({ ...input, maxRounds: 4, previous: { call: match, outcome: feedback, imageSha256 } }))).status).toBe(200);
    expect(JSON.parse(send.mock.calls[0]![1]!.body as string).messages[3].content).toContain("too little texture");
  });
  it("rejects forged history, invalid inputs and unsupported source resolution before inference", async () => {
    const send = vi.fn<typeof fetch>(), handler = createCrownAgentHandler("fixture", send);
    expect((await handler(request(input, "https://elsewhere.test"))).status).toBe(403);
    expect((await handler(request({ ...input, source: "google" }))).status).toBe(400);
    expect((await handler(request({ ...input, previous: { call: match, outcome, imageSha256: "wrong-image" } }))).status).toBe(400);
    expect((await handler(request({ ...input, previous: { call: match, outcome: { ...outcome, count: 9999999 }, imageSha256 } }))).status).toBe(400);
    const earthEngine = { projectId: "example-project", assetId: "projects/example-project/assets/image", bands: ["R", "G", "B"], displayMin: 0, displayMax: 255, nativeResolutionM: 10, exportResolutionMapM: 10, sourceDate: null, previewedAt: new Date().toISOString(), attribution: "Provider" };
    expect((await handler(request({ ...input, source: "earth-engine", earthEngine }))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects malformed or out-of-bounds tool choices without executing or retrying", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(provider({ ...match, arguments: { ...match.arguments, sample: { x: 30, y: 30, width: 8, height: 8 } } }));
    expect((await createCrownAgentHandler("fixture", send)(request())).status).toBe(502);
    expect(send).toHaveBeenCalledOnce();
  });
  it("does not decode huge overlay headers or send cancelled requests to the model", async () => {
    const send = vi.fn<typeof fetch>(), handler = createCrownAgentHandler("fixture", send);
    const header = Buffer.from(bytes); header.writeUInt32BE(50000, 16);
    expect((await handler(request({ ...input, previous: { call: match, outcome, imageSha256 }, overlayImageDataUrl: `data:image/png;base64,${header.toString("base64")}` }))).status).toBe(400);
    const controller = new AbortController(); controller.abort();
    expect((await handler(new Request(request(), { signal: controller.signal }))).status).toBe(499);
    expect(send).not.toHaveBeenCalled();
  });
  it("redacts provider errors and never retries them", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "fixture-key rejected data:image/png;base64,AAAA" } }, { status: 429 }));
    const data = await (await createCrownAgentHandler("fixture-key", send)(request())).json();
    expect(data.error).toContain("HTTP 429"); expect(data.error).not.toContain("fixture-key"); expect(data.error).not.toContain("AAAA");
    expect(send).toHaveBeenCalledOnce();
  });
  it("supports later coverage rounds and sends accumulated distribution rather than resetting the search", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(provider());
    const coverage = { mergedCount: 123, addedCandidates: 12, stagnantPasses: 0, samples: [match.arguments.sample], sectors: [{ id: "A1", x: 0, y: 0, width: 16, height: 16, validPixels: 200, count: 5 }] };
    const data = await (await createCrownAgentHandler("fixture", send)(request({ ...input, round: 6, maxRounds: 8, coverage, previous: { call: match, outcome: { ...outcome, coverage }, imageSha256 }, overlayImageDataUrl: input.imageDataUrl }))).json();
    expect(data.round).toBe(6);
    const body = JSON.parse(send.mock.calls[0]![1]!.body as string);
    const context = JSON.parse(body.messages[1].content[0].text);
    expect(context).toMatchObject({ round: 6, maxRounds: 8, coverage: { mergedCount: 123, addedCandidates: 12 } });
    expect(JSON.parse(body.messages[3].content).coverage.mergedCount).toBe(123);
  });
  it("reviews an existing candidate overlay at the start of a continuation and bounds the round budget", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(provider()), handler = createCrownAgentHandler("fixture", send);
    expect((await handler(request({ ...input, round: 1, maxRounds: 8, overlayImageDataUrl: input.imageDataUrl }))).status).toBe(200);
    const body = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(body.messages[2].content[1].image_url.url).toBe(input.imageDataUrl);
    expect((await handler(request({ ...input, round: 13, maxRounds: 13 }))).status).toBe(400);
    expect((await handler(request({ ...input, round: 3, maxRounds: 8 }))).status).toBe(400);
    expect(send).toHaveBeenCalledOnce();
  });
  it("reserves the final call for area review and rejects another matching pass", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(provider());
    expect((await createCrownAgentHandler("fixture", send)(request({ ...input, previous: { call: match, outcome, imageSha256 } }))).status).toBe(502);
    const body = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(body.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(["finish_crown_detection"]);
    expect(body.tools[0].function.parameters.required).toContain("sectorReviews");
  });
  it("requires a reasoned assessment for every actual sector, including zero-detection gaps", async () => {
    const coverage = { mergedCount: 0, addedCandidates: 0, stagnantPasses: 3, samples: [], sectors: [{ id: "A1", x: 0, y: 0, width: 16, height: 16, validPixels: 100, count: 0 }, { id: "B1", x: 16, y: 0, width: 16, height: 16, validPixels: 100, count: 0 }] };
    const finish = { ...stop, arguments: { ...stop.arguments, sectorReviews: [{ id: "A1", status: "uncertain", reason: "Crowns too blurry to resolve." }, { id: "B1", status: "no_visible_palms", reason: "Clearly visible bare road." }] } };
    const send = vi.fn<typeof fetch>().mockResolvedValue(provider(finish));
    const shapePolicy = { referenceDiameterPx: 10, minDiameterPx: 8, maxDiameterPx: 12, clearancePx: 1, maxAspectRatio: 1.4 };
    const data = { ...input, maxRounds: 8, reviewOnly: true, coverage, shapePolicy };
    expect((await createCrownAgentHandler("fixture", send)(request(data))).status).toBe(200);
    expect(JSON.parse(JSON.parse(send.mock.calls[0]![1]!.body as string).messages[1].content[0].text).shapePolicy).toEqual(shapePolicy);
    const missing = vi.fn<typeof fetch>().mockResolvedValue(provider(stop));
    expect((await createCrownAgentHandler("fixture", missing)(request(data))).status).toBe(502);
    const outside = vi.fn<typeof fetch>().mockResolvedValue(provider({ ...finish, arguments: { ...finish.arguments, sectorReviews: [{ ...finish.arguments.sectorReviews[0]!, id: "D4" }] } }));
    expect((await createCrownAgentHandler("fixture", outside)(request(data))).status).toBe(502);
    expect(send).toHaveBeenCalledOnce(); expect(missing).toHaveBeenCalledOnce(); expect(outside).toHaveBeenCalledOnce();
  });
});

it("uses the selected Muse model for crown decisions and records it", async () => {
  const model = "muse-wonder-1.0", body = await provider().json(); body.model = model;
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
  const result = await (await createCrownAgentHandler("fixture", send)(request({ ...input, model }))).json();
  expect(result.model).toBe(model); expect(JSON.parse(send.mock.calls[0]![1]!.body as string).model).toBe(model);
});
