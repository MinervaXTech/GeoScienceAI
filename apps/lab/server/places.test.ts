// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createPlaceSearchHandler } from "./places";
import { photonPlaces } from "../src/geo/places";

const feature = { type: "Feature", geometry: { type: "Point", coordinates: [103.319, 2.032] }, properties: { name: "Kluang", state: "Johor", country: "Malaysia", type: "city", osm_type: "N", osm_id: 254072975, osm_value: "city" } };
const request = (q = "kluang johor") => new Request(`http://localhost:5173/api/geocode/search?q=${encodeURIComponent(q)}`);

describe("place search", () => {
  it("returns validated longitude/latitude results and caches repeated searches", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ features: [feature] }));
    const handler = createPlaceSearchHandler(undefined, send);
    const response = await handler(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.places[0]).toMatchObject({ name: "Kluang", label: "Kluang, Johor, Malaysia", center: [103.319, 2.032], zoom: 13 });
    expect(await (await handler(request(" KLUANG   JOHOR "))).json()).toEqual(body);
    expect(send).toHaveBeenCalledTimes(1);
    const url = new URL(String(send.mock.calls[0]![0]));
    expect(url.searchParams.get("q")).toBe("kluang johor");
    expect(url.searchParams.get("limit")).toBe("5");
  });
  it("validates queries and blocks cross-origin calls and excessive uncached requests", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ features: [] }));
    const handler = createPlaceSearchHandler(undefined, send, () => 1000);
    expect((await handler(request("x"))).status).toBe(400);
    expect((await handler(new Request(request().url, { headers: { Origin: "https://other.example" } }))).status).toBe(403);
    expect((await handler(new Request(request().url, { method: "POST" }))).status).toBe(405);
    expect(send).not.toHaveBeenCalled();
    expect((await handler(request())).status).toBe(200);
    expect((await handler(request("Johor Bahru"))).status).toBe(429);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("handles provider failure without leaking provider bodies", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("internal provider error", { status: 503 }));
    const response = await createPlaceSearchHandler(undefined, send)(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("internal provider error");
  });
  it("excludes invalid coordinates and duplicate places", () => {
    const bad = { ...feature, geometry: { type: "Point", coordinates: [200, 91] } };
    expect(photonPlaces({ features: [bad, null, feature, feature] })).toHaveLength(1);
    expect(photonPlaces({ features: [] })).toEqual([]);
    expect(() => photonPlaces({ error: "bad" })).toThrow();
  });
});
