import { randomUUID } from "node:crypto";
import type { Connect, Plugin } from "vite";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const error = (message: string, status = 502) => json({ error: message }, status);
interface Session { view: string; token: string; expires: number }

/** Local visualization proxy. Google credentials and session tokens stay on the server. */
export function createGoogleMapsHandler(key: string, send: typeof fetch = fetch) {
  let session: Session | undefined;
  let pending: Promise<Session> | undefined;
  const request = (url: URL, init?: RequestInit) => {
    url.searchParams.set("key", key);
    return send(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
  };
  const getSession = async () => {
    if (session && session.expires > Date.now() + 60000) return session;
    if (!pending) pending = (async () => {
      const response = await request(new URL("https://tile.googleapis.com/v1/createSession"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapType: "satellite", language: "en-US", region: "MY" }),
      });
      if (!response.ok) throw Error("session");
      const data = await response.json();
      const expires = Number(data.expiry) * 1000;
      if (typeof data.session !== "string" || !data.session || data.tileWidth !== 256 || !Number.isFinite(expires) || expires <= Date.now() + 60000) throw Error("session");
      session = { view: randomUUID(), token: data.session, expires };
      return session;
    })().finally(() => { pending = undefined; });
    return pending;
  };

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method !== "GET") return error("Method not allowed.", 405);
    const site = req.headers.get("sec-fetch-site");
    const origin = req.headers.get("origin");
    if ((site && site !== "same-origin" && site !== "none") || (origin && origin !== url.origin)) return error("Use maps from this app.", 403);
    if (!key.trim()) return error("Google satellite is not configured. Add GOOGLE_MAPS_API_KEY to apps/lab/.env.local and restart the app.", 503);
    try {
      if (url.pathname === "/api/maps/session") {
        const s = await getSession();
        return json({ view: s.view, expiresAt: s.expires });
      }
      const s = session;
      if (!s || url.searchParams.get("view") !== s.view || s.expires <= Date.now()) return error("Satellite session expired. Reconnect the map.", 401);
      let upstream: URL;
      const tile = /^\/api\/maps\/tile\/(\d+)\/(\d+)\/(\d+)$/.exec(url.pathname);
      if (tile) {
        const [z, x, y] = tile.slice(1).map(Number) as [number, number, number];
        if (![z, x, y].every(Number.isSafeInteger) || z > 22 || x >= 2 ** z || y >= 2 ** z) return error("Invalid tile coordinates.", 400);
        upstream = new URL(`https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}`);
      } else if (url.pathname === "/api/maps/viewport") {
        const names = ["zoom", "north", "south", "east", "west"] as const;
        const [zoom, north, south, east, west] = names.map((n) => Number(url.searchParams.get(n))) as [number, number, number, number, number];
        if (names.some((n) => !url.searchParams.has(n)) || ![zoom, north, south, east, west].every(Number.isFinite) || !Number.isInteger(zoom) || zoom < 0 || zoom > 22 || north <= south || east <= west || north > 85.051129 || south < -85.051129 || east > 180 || west < -180) return error("Invalid map viewport.", 400);
        upstream = new URL("https://tile.googleapis.com/tile/v1/viewport");
        names.forEach((name) => upstream.searchParams.set(name, url.searchParams.get(name)!));
      } else return error("Unknown map operation.", 404);
      upstream.searchParams.set("session", s.token);
      const response = await request(upstream);
      if (!response.ok) return error(`Google satellite request failed (HTTP ${response.status}). Check Map Tiles API, billing, and key restrictions.`);
      if (!tile) {
        const data = await response.json();
        if (typeof data.copyright !== "string" || !data.copyright.trim() || !Array.isArray(data.maxZoomRects)) return error("Google satellite attribution is unavailable.");
        return json({ copyright: data.copyright, maxZoomRects: data.maxZoomRects });
      }
      const mime = response.headers.get("content-type")?.split(";")[0]?.trim();
      if (!mime || !["image/png", "image/jpeg", "image/webp"].includes(mime)) return error("Invalid satellite tile response.");
      return new Response(await response.arrayBuffer(), { headers: { "Content-Type": mime, "Cache-Control": "no-store" } });
    } catch {
      // Provider bodies, URLs, and errors can echo the key. Never send or log them.
      return error("Google satellite could not connect. Check Map Tiles API, billing, key restrictions, and your connection.");
    }
  };
}

/** Works with both `vite` and `vite preview`; static hosting needs an equivalent backend. */
export function googleMapsPlugin(key: string): Plugin {
  const handle = createGoogleMapsHandler(key);
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/maps/")) return next();
    const headers = new Headers();
    for (const name of ["origin", "sec-fetch-site"]) {
      const value = req.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    const response = await handle(new Request(new URL(req.url, `http://${req.headers.host ?? "localhost"}`), { method: req.method, headers }));
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  return {
    name: "google-satellite-proxy",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
