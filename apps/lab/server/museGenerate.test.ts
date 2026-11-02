// @vitest-environment node
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { createMuseHandler } from "./muse";
import { prepareGeneratedImage } from "./museGenerate";
import { buildMusePyramid } from "./musePyramid";
import { MUSE_IMAGE_MODEL, MUSE_MODEL, type MuseResult } from "../src/geo/muse";
import type { SamImage } from "../src/geo/sam";

const png = (width: number, height: number, mask = false) => {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) image.data.set([180, 110, 40, mask && x < width / 2 ? 0 : 255], (y * width + x) * 4);
  return PNG.sync.write(image);
};
const original = png(8, 8, true);
const input: SamImage = { width: 8, height: 8, corners: [[101, 3], [102, 3], [102, 2], [101, 2]], source: "esri", imageDataUrl: `data:image/png;base64,${original.toString("base64")}`, area: { type: "Polygon", coordinates: [[[101, 3], [102, 3], [102, 2], [101, 2], [101, 3]]] } };
const request = () => new Request("http://localhost:5173/api/muse/run", { method: "POST", headers: { Origin: "http://localhost:5173" }, body: JSON.stringify({ ...input, method: "generative", mapId: "map-a", mapName: "A", objective: "Restore canopy detail" }) });
const review = () => Response.json({ model: MUSE_MODEL, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ summary: "Original canopy texture.", observations: ["Vegetation visible in the original."], improvements: [{ title: "Ground check", action: "Verify crowns in original imagery.", reason: "Generated fronds are unverified." }], enhancementReview: "Sharper synthetic detail does not verify real fronds.", limitations: ["Generated features may drift."] }) } }] });
const generated = () => Response.json({ data: [{ b64_json: png(16, 16).toString("base64") }], output_format: "png", usage: { images: 1 } });

describe("Muse Image GenAI enhancement", () => {
  it("calls the actual image-editing endpoint once and reviews the generated output", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(generated()).mockResolvedValueOnce(review());
    const save = vi.fn();
    const response = await createMuseHandler("fixture-key", send, { load: async () => null, save })(request());
    const result = await response.json() as MuseResult;
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ model: MUSE_IMAGE_MODEL, method: "generative", status: "completed", enhancedFrame: { width: 16, height: 16 }, generation: { nativeWidth: 16, nativeHeight: 16, geometryVerified: false } });
    expect(result.settings).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0]).toBe("https://api.meta.ai/v1/images/edits");
    const imageRequest = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(imageRequest).toMatchObject({ model: MUSE_IMAGE_MODEL, images: [{ image_url: input.imageDataUrl }], n: 1, size: "16x16", output_format: "png", response_format: "b64_json", tool_enablement: { enable_web_search: false, enable_image_search: false, enable_shell: false } });
    expect(imageRequest.tools).toBeUndefined();
    expect(result.generation?.prompt).toBe(imageRequest.prompt);
    const second = JSON.parse(send.mock.calls[1]![1]!.body as string);
    expect(second.model).toBe(MUSE_MODEL);
    expect(second.messages.at(-1).content[1].image_url.url).toBe(result.enhancedImageDataUrl);
    expect(result.input.imageDataUrl).toBe(input.imageDataUrl);
    expect(result.trace.some((step) => step.stage === "Restore polygon crop")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-key");
    expect(save).toHaveBeenCalledOnce();
  });
  it("restores the original polygon alpha instead of painting an opaque rectangle", () => {
    const prepared = prepareGeneratedImage(png(16, 16), input);
    const output = PNG.sync.read(prepared.bytes);
    expect([output.width, output.height]).toEqual([16, 16]);
    expect(output.data[(5 * 16 + 2) * 4 + 3]).toBe(0);
    expect(output.data[(5 * 16 + 13) * 4 + 3]).toBe(255);
    expect([...output.data.subarray((5 * 16 + 13) * 4, (5 * 16 + 13) * 4 + 3)]).toEqual([180, 110, 40]);
    expect(prepared.frame.corners).toEqual(input.corners);
  });
  it("rejects incompatible aspect ratios and oversized PNG headers before placement", () => {
    expect(() => prepareGeneratedImage(png(32, 8), input)).toThrow(/aspect ratio/);
    const header = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header); header.writeUInt32BE(5000, 16); header.writeUInt32BE(5000, 20);
    expect(() => prepareGeneratedImage(header, input)).toThrow(/limit/);
  });
  it("reports an unavailable image model without substituting filters or saving fake output", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "fixture-key has no image-model access" } }, { status: 403 }));
    const save = vi.fn();
    const response = await createMuseHandler("fixture-key", send, { load: async () => null, save })(request());
    const result = await response.json();
    expect(response.status).toBe(502);
    expect(result.error).toMatch(/HTTP 403/);
    expect(result.error).toMatch(/No filter fallback/);
    expect(JSON.stringify(result)).not.toContain("fixture-key");
    expect(save).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("keeps the real generated image if the text review fails", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(generated()).mockResolvedValueOnce(new Response("error", { status: 503 }));
    const response = await createMuseHandler("fixture-key", send)(request());
    const result = await response.json();
    expect(result).toMatchObject({ status: "partial", method: "generative", analysis: null });
    expect(result.enhancedImageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.trace.at(-1).status).toBe("error");
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("tiles the generated frame at its own resolution and labels it as a preview", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(generated()).mockResolvedValueOnce(review());
    const result = await (await createMuseHandler("fixture-key", send)(request())).json();
    const { manifest } = buildMusePyramid(result);
    expect(manifest).toMatchObject({ frame: { width: 16, height: 16 }, method: "generative", area: input.area });
    expect(manifest.imageSha256).toBe(createHash("sha256").update(Buffer.from(result.enhancedImageDataUrl.split(",")[1], "base64")).digest("hex"));
    expect(manifest.attribution).toContain("AI reconstructed preview");
    expect(manifest.tiles[0]).toContain("resampling=genai-v2");
  });
  it("uses Earth Engine pixels and preserves their provenance through generation, review and tiling", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(generated()).mockResolvedValueOnce(review());
    const earthEngine = { projectId: "example-project", assetId: "projects/example-project/assets/palms", collectionId: "SKYSAT/GEN-A/PUBLIC/ORTHO/RGB", bands: ["R", "G", "B"], displayMin: 0, displayMax: 255, sourceDate: "2015-01-01T00:00:00Z", nativeResolutionM: 0.8, exportResolutionMapM: 0.81, attribution: "Planet Labs · CC BY 4.0", previewedAt: "2026-11-02T02:00:00Z", access_token: "not-for-meta-or-disk" };
    const req = new Request("http://localhost:5173/api/muse/run", { method: "POST", headers: { Origin: "http://localhost:5173" }, body: JSON.stringify({ ...input, source: "earth-engine", earthEngine, method: "generative", mapId: "map-a", mapName: "A", objective: "Restore this crop" }) });
    const response = await createMuseHandler("fixture-key", send)(req), result = await response.json() as MuseResult;
    expect(response.status).toBe(200); expect(result.input.source).toBe("earth-engine");
    const first = JSON.parse(send.mock.calls[0]![1]!.body as string), second = JSON.parse(send.mock.calls[1]![1]!.body as string);
    expect(first.images[0].image_url).toBe(input.imageDataUrl);
    expect(second.messages[1].content[0].text).toContain(earthEngine.assetId);
    expect(second.messages[1].content[0].text).not.toContain("Esri World Imagery");
    expect(JSON.stringify(result) + JSON.stringify(send.mock.calls)).not.toContain("not-for-meta-or-disk");
    expect(buildMusePyramid(result).manifest.attribution).toContain("Planet Labs");
    expect(buildMusePyramid(result).manifest.attribution).not.toContain("Esri");
  });
  it("rejects Earth Engine input without provenance before any model call", async () => {
    const send = vi.fn<typeof fetch>();
    const req = new Request("http://localhost:5173/api/muse/run", { method: "POST", headers: { Origin: "http://localhost:5173" }, body: JSON.stringify({ ...input, source: "earth-engine", method: "generative", mapId: "map-a", mapName: "A", objective: "Restore this crop" }) });
    expect((await createMuseHandler("fixture-key", send)(req)).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
});
