import type { Connect, Plugin } from "vite";
import { photonPlaces, type PlaceResult } from "../src/geo/places.ts";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Deliberate searches only. Cache queries and cap upstream traffic to one request per second. */
export function createPlaceSearchHandler(endpoint = "https://photon.komoot.io/api/", send: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<string, { at: number; places: PlaceResult[] }>();
  let inFlight = false;
  let nextRequestAt = 0;
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
    const site = req.headers.get("sec-fetch-site"), origin = req.headers.get("origin");
    if ((site && site !== "same-origin" && site !== "none") || (origin && origin !== url.origin)) return json({ error: "Search places from this app." }, 403);
    const query = (url.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
    if (query.length < 2 || query.length > 160) return json({ error: "Enter a place name from 2 to 160 characters." }, 400);
    const key = query.toLocaleLowerCase("en");
    const saved = cache.get(key);
    if (saved && now() - saved.at < 86400000) return json({ places: saved.places });
    if (inFlight || now() < nextRequestAt) return json({ error: "Please wait a moment, then search again." }, 429);
    inFlight = true;
    nextRequestAt = now() + 1000;
    try {
      const upstream = new URL(endpoint);
      upstream.searchParams.set("q", query);
      upstream.searchParams.set("limit", "5");
      upstream.searchParams.set("lang", "en");
      const response = await send(upstream, { headers: { "User-Agent": "GeoScienceAI-Lab/0.1 (place search)", Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error("Provider unavailable.");
      const places = photonPlaces(await response.json());
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: now(), places });
      return json({ places });
    } catch {
      return json({ error: "Place search is unavailable. Try again or enter coordinates." }, 502);
    } finally { inFlight = false; }
  };
}

export function placeSearchPlugin(endpoint?: string): Plugin {
  const handle = createPlaceSearchHandler(endpoint || undefined);
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url?.split("?")[0] !== "/api/geocode/search") return next();
    const headers = new Headers();
    for (const name of ["origin", "sec-fetch-site"]) {
      const value = req.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    const response = await handle(new Request(new URL(req.url!, `http://${req.headers.host ?? "localhost"}`), { method: req.method, headers }));
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  return { name: "place-search-proxy", configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
