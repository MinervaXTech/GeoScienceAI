// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createGoogleMapsHandler } from "./googleMaps";

const req = (path: string, init?: RequestInit) => new Request(`http://localhost:5173/api/maps/${path}`, init);
const sessionResponse = () => Response.json({ session: "provider-secret-session", expiry: Math.floor(Date.now() / 1000) + 3600, tileWidth: 256 });

describe("Google satellite proxy", () => {
  it("reports missing configuration without making upstream calls", async () => {
    const send = vi.fn<typeof fetch>();
    const response = await createGoogleMapsHandler("", send)(req("session"));
    expect(response.status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });

  it("shares concurrent satellite sessions and returns only an opaque view handle", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(sessionResponse());
    const handle = createGoogleMapsHandler("private-google-key", send);
    const [a, b] = await Promise.all([handle(req("session")), handle(req("session"))]);
    const first = await a.json();
    expect(await b.json()).toEqual(first);
    expect(first.view).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(first)).not.toMatch(/private-google-key|provider-secret-session/);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0]!;
    expect(new URL(String(url)).hostname).toBe("tile.googleapis.com");
    expect(JSON.parse(init!.body as string)).toEqual({ mapType: "satellite", language: "en-US", region: "MY" });
  });

  it("rejects cross-site requests and invalid tile/viewport bounds before contacting Google", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(sessionResponse());
    const handle = createGoogleMapsHandler("key", send);
    expect((await handle(req("session", { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
    expect((await handle(req("session", { headers: { origin: "https://other.example" } }))).status).toBe(403);
    expect((await handle(req("session", { method: "POST" }))).status).toBe(405);
    const { view } = await (await handle(req("session"))).json();
    for (const path of [`tile/2/4/0?view=${view}`, `tile/23/0/0?view=${view}`, `viewport?view=${view}&zoom=18&north=1&south=2&east=102&west=101`, `viewport?view=${view}&zoom=18`]) {
      expect((await handle(req(path))).status).toBe(400);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("forwards image bytes and attribution, without forwarding provider URLs, headers or tokens", async () => {
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png", "x-secret": "key" } }))
      .mockResolvedValueOnce(Response.json({ copyright: "Imagery © Provider", maxZoomRects: [], privateField: "key" }));
    const handle = createGoogleMapsHandler("key", send);
    const { view } = await (await handle(req("session"))).json();
    const tile = await handle(req(`tile/18/205000/128000?view=${view}`));
    expect(tile.status).toBe(200);
    expect([...new Uint8Array(await tile.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(tile.headers.get("x-secret")).toBeNull();
    expect(tile.headers.get("Cache-Control")).toBe("no-store");
    const metadata = await handle(req(`viewport?view=${view}&zoom=18&north=3&south=2&east=102&west=101`));
    expect(await metadata.json()).toEqual({ copyright: "Imagery © Provider", maxZoomRects: [] });
    const url = new URL(String(send.mock.calls[1]![0]));
    expect(url.searchParams.get("key")).toBe("key");
    expect(url.searchParams.get("session")).toBe("provider-secret-session");
  });

  it("does not expose upstream error text or accept unknown sessions", async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValueOnce(Error("https://tile.googleapis.com/?key=private-google-key"));
    const handle = createGoogleMapsHandler("private-google-key", send);
    const response = await handle(req("session"));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private-google-key");
    expect((await handle(req("tile/1/0/0?view=unknown"))).status).toBe(401);
  });
});
