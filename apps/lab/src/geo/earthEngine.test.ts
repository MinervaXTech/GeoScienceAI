import { describe, expect, it, vi } from "vitest";
import type { Polygon } from "geojson";
import { EE_DATASETS, EE_SCOPE, earthEngineFrame, earthEngineRequest, normalizeAssetName, pixelExpression, sceneResolution, searchExpression, validateEarthEngineProvenance } from "./earthEngine";
import { lngLatToImagePixel } from "./sam";

const area: Polygon = { type: "Polygon", coordinates: [[[103.2265, 2.066], [103.2318, 2.066], [103.2318, 2.062], [103.2265, 2.066]]] };
describe("Earth Engine image capture", () => {
  it("uses Google's Filter.bounds Feature operand for every image collection", () => {
    // ee.Filter.bounds promotes the right operand to Feature, because '.all'
    // on an Image is not a Geometry. The live API rejects a bare polygon here.
    // Contract: google/earthengine-api/javascript/src/filter.js, Filter.bounds.
    for (const preset of EE_DATASETS) {
      const expression = JSON.parse(JSON.stringify(searchExpression(preset.collection, area, preset.id === "sentinel2")));
      const filter = expression.values.images.functionInvocationValue.arguments.collection.functionInvocationValue.arguments.filter.functionInvocationValue;
      expect(filter.functionName).toBe("Filter.intersects");
      expect(filter.arguments.leftField.constantValue).toBe(".all");
      expect(filter.arguments.rightValue.functionInvocationValue).toMatchObject({ functionName: "Feature", arguments: { geometry: { functionInvocationValue: {
        functionName: "GeometryConstructors.Polygon", arguments: { coordinates: { constantValue: area.coordinates } },
      } } } });
    }
  });
  it("bounds Sentinel queries by time before footprint filtering and metadata sorting", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-02T00:00:00Z"));
    try {
      const expression = JSON.parse(JSON.stringify(searchExpression("COPERNICUS/S2_SR_HARMONIZED", area, true)));
      const limit = expression.values.images.functionInvocationValue;
      const spatial = limit.arguments.collection.functionInvocationValue;
      const temporal = spatial.arguments.collection.functionInvocationValue;
      expect(limit.arguments.limit.constantValue).toBe(10);
      expect(temporal.arguments.collection.functionInvocationValue.functionName).toBe("ImageCollection.load");
      const dates = temporal.arguments.filter.functionInvocationValue.arguments.leftValue.functionInvocationValue.arguments;
      expect(dates.start.constantValue).toBe("2026-08-04T00:00:00.000Z");
      expect(dates.end.constantValue).toBe("2026-11-02T00:00:00.000Z");
    } finally { vi.useRealTimers(); }
  });
  it("keeps the requested native scale rather than inflating ten-metre pixels", () => {
    const coarse = earthEngineFrame(area, 10), fine = earthEngineFrame(area, 0.8);
    expect(coarse.width).toBeLessThan(65); expect(coarse.height).toBeLessThan(55);
    expect(fine.width).toBeGreaterThan(coarse.width * 10);
    expect([fine.width, fine.height].every((v) => v <= 1024)).toBe(true);
    for (const point of area.coordinates[0]!) {
      const [x, y] = lngLatToImagePixel(fine, point as [number, number]);
      expect(x).toBeGreaterThanOrEqual(-1e-6); expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(fine.width + 1e-6); expect(y).toBeLessThanOrEqual(fine.height + 1e-6);
    }
    const large: Polygon = { type: "Polygon", coordinates: [[[103, 2], [103.1, 2], [103.1, 2.1], [103, 2]]] };
    expect(Math.max(earthEngineFrame(large, 0.8).width, earthEngineFrame(large, 0.8).height)).toBe(1024);
  });
  it("selects image bands from real metadata and does not interpret geographic degrees as metres", () => {
    const scene = { name: "projects/test/assets/image", bands: ["R", "G", "B"].map((id) => ({ id, grid: { crsCode: "EPSG:32648", affineTransform: { scaleX: 0.8, scaleY: -0.8 } } })) };
    expect(sceneResolution(scene, ["R", "G", "B"])).toBe(0.8);
    expect(sceneResolution({ ...scene, bands: [{ id: "R", grid: { crsCode: "EPSG:4326", affineTransform: { scaleX: 0.00001, scaleY: -0.00001 } } }] }, ["R"])).toBeNull();
  });
  it("searches the actual polygon and exports a clipped image asset instead of the viewing basemap", () => {
    const expression = JSON.stringify(searchExpression("SKYSAT/GEN-A/PUBLIC/ORTHO/RGB", area));
    expect(expression).toContain(JSON.stringify(area.coordinates));
    const image = JSON.stringify(pixelExpression("projects/example-project/assets/palms", area, ["R", "G", "B"], 0, 255));
    expect(image).toContain("Image.clip"); expect(image).toContain("projects/example-project/assets/palms");
    expect(image).not.toMatch(/google-satellite|maps\.google/);
    expect(() => normalizeAssetName("https://example.com/image")).toThrow();
    expect(() => normalizeAssetName("projects/example/assets/../secret")).toThrow();
    expect(() => pixelExpression("projects/example/assets/image", area, ["R", "G", "B"], 255, 0)).toThrow();
  });
  it("sends auth only to Google's fixed API host, reports permission failures and never retries", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "test-access-token cannot access this asset" } }, { status: 403 }));
    await expect(earthEngineRequest("projects/example/assets/palms", "test-access-token", new AbortController().signal, undefined, send)).rejects.toThrow(/permissions/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe("https://earthengine.googleapis.com/v1/projects/example/assets/palms");
    expect(send.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: "Bearer test-access-token" });
    await expect(earthEngineRequest("https://example.com", "token", new AbortController().signal, undefined, send)).rejects.toThrow();
    expect(EE_SCOPE).toContain("read-only");
  });
  it("retains source metadata without credentials or arbitrary nested fields", () => {
    const value = { projectId: "example-project", assetId: "projects/example-project/assets/palms", bands: ["R", "G", "B"], displayMin: 0, displayMax: 255, sourceDate: null, nativeResolutionM: 0.8, exportResolutionMapM: 1, attribution: "Image provider", previewedAt: "2026-11-02T02:00:00Z", access_token: "never-save-this" };
    expect(JSON.stringify(validateEarthEngineProvenance(value))).not.toContain("never-save-this");
    expect(() => validateEarthEngineProvenance({ ...value, displayMax: 0 })).toThrow();
  });
});
