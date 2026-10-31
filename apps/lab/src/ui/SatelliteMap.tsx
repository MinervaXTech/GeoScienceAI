import { useEffect, useRef, useState } from "react";
import type { FeatureCollection, LineString } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, RasterTileSource } from "maplibre-gl";
import { HOME_WGS84, PEAKS, RASTER_CORNERS } from "../geo/layer";
import { googleViewportCovered } from "../geo/googleCoverage";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

interface Props {
  canopyUrl: string | null;
  canopyOpacity: number;
  routes: FeatureCollection<LineString>;
  peakColors: string[];
  focusRequest: number;
}

const viewBounds: [[number, number], [number, number]] = [
  [Math.min(HOME_WGS84[0], ...RASTER_CORNERS.map((c) => c[0])), Math.min(HOME_WGS84[1], ...RASTER_CORNERS.map((c) => c[1]))],
  [Math.max(HOME_WGS84[0], ...RASTER_CORNERS.map((c) => c[0])), Math.max(HOME_WGS84[1], ...RASTER_CORNERS.map((c) => c[1]))],
];
const fitView = (map: MapLibreMap) => map.fitBounds(viewBounds, { padding: { top: 35, bottom: 55, left: map.getContainer().clientWidth > 700 ? 270 : 35, right: 50 }, duration: 0, maxZoom: 20 });

export function SatelliteMap({ canopyUrl, canopyOpacity, routes, peakColors, focusRequest }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<MapLibreMap | null>(null);
  const colors = useRef(peakColors);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState("Loading Google satellite…");
  const [attribution, setAttribution] = useState("");

  useEffect(() => {
    let disposed = false;
    let current: MapLibreMap | undefined;
    let resize: ResizeObserver | undefined;
    let renewal: ReturnType<typeof setTimeout> | undefined;
    let sequence = 0;
    const controller = new AbortController();
    const hideSatellite = () => {
      if (current?.getLayer("google-satellite")) current.setPaintProperty("google-satellite", "raster-opacity", 0);
    };
    const fail = (message: string) => {
      if (disposed) return;
      hideSatellite();
      setStatus(message);
      setAttribution("");
    };
    const read = async (url: string) => {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw Error(typeof data.error === "string" ? data.error : "Google satellite is unavailable.");
      return data;
    };
    void import("maplibre-gl").then(({ Map, NavigationControl, ScaleControl, Popup, setWorkerUrl }) => {
      if (disposed || !container.current) return;
      setWorkerUrl(workerUrl);
      current = new Map({
        container: container.current, center: HOME_WGS84, zoom: 18, minZoom: 2, maxZoom: 22,
        attributionControl: false, renderWorldCopies: false, maxPitch: 0, dragRotate: false, touchPitch: false,
        style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#25332d" } }] },
      });
      const m = current;
      instance.current = m;
      m.addControl(new NavigationControl({ showCompass: false }), "top-right");
      m.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
      resize = new ResizeObserver(() => m.resize());
      resize.observe(container.current);
      m.on("error", (event) => {
        if ((event as { sourceId?: string }).sourceId === "google-satellite") fail("Google satellite tiles are unavailable. Check the connection and reconnect.");
        else if (event.error.message.includes("Worker")) fail("The map overlay worker could not load. Reload the app.");
      });
      m.on("load", () => {
        if (disposed) return;
        fitView(m);
        m.addSource("google-satellite", { type: "raster", tiles: [], tileSize: 256, maxzoom: 22 });
        m.addLayer({ id: "google-satellite", type: "raster", source: "google-satellite", paint: { "raster-opacity": 0, "raster-fade-duration": 0 } });
        if (canopyUrl) {
          m.addSource("canopy", { type: "image", url: canopyUrl, coordinates: RASTER_CORNERS });
          m.addLayer({ id: "canopy", type: "raster", source: "canopy", paint: { "raster-opacity": 0, "raster-resampling": "nearest", "raster-fade-duration": 0 } });
        }
        m.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        for (const slot of [0, 1]) m.addLayer({
          id: `route-${slot}`, type: "line", source: "routes", filter: ["==", ["get", "slot"], slot],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": slot === 0 ? "#fff" : "#f0543a", "line-width": 3, ...(slot === 1 ? { "line-dasharray": [3, 2] } : {}) },
        });
        m.addSource("peaks", { type: "geojson", data: {
          type: "FeatureCollection", features: PEAKS.map((p, i) => ({ type: "Feature", properties: { id: p.id, height: p.h, color: colors.current[i] }, geometry: { type: "Point", coordinates: p.lonLat } })),
        } });
        m.addLayer({ id: "peaks", type: "circle", source: "peaks", paint: { "circle-radius": 4.5, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
        m.addSource("home", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: HOME_WGS84 } } });
        m.addLayer({ id: "home", type: "circle", source: "home", paint: { "circle-radius": 7, "circle-color": "#1f9d55", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
        m.on("click", "peaks", (event) => {
          const p = event.features?.[0]?.properties;
          if (p) new Popup().setLngLat(event.lngLat).setText(`Peak ${p.id}, CHMv2 ${p.height} m`).addTo(m);
        });
        m.on("click", "home", (event) => new Popup().setLngLat(event.lngLat).setText("Home · launch and landing").addTo(m));
        setMap(m);

        let view = "";
        const metadata = async () => {
          if (!view || disposed) return;
          const id = ++sequence;
          hideSatellite();
          const b = m.getBounds();
          const bounds = { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
          const zoom = Math.floor(m.getZoom());
          const query = new URLSearchParams({ view, zoom: String(zoom), ...Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, String(v)])) });
          try {
            const data = await read(`/api/maps/viewport?${query}`);
            if (disposed || id !== sequence) return;
            if (!Array.isArray(data.maxZoomRects) || !googleViewportCovered(bounds, zoom, data.maxZoomRects)) throw Error("Google satellite has no coverage at this zoom. Zoom out to try again.");
            setAttribution(data.copyright);
            setStatus("");
            m.setPaintProperty("google-satellite", "raster-opacity", 1);
          } catch (e) {
            if (!disposed && id === sequence) fail(e instanceof Error ? e.message : "Google satellite is unavailable.");
          }
        };
        const connect = async () => {
          try {
            const data = await read("/api/maps/session");
            if (disposed) return;
            view = data.view;
            (m.getSource("google-satellite") as RasterTileSource).setTiles([`${location.origin}/api/maps/tile/{z}/{x}/{y}?view=${encodeURIComponent(view)}`]);
            await metadata();
            renewal = setTimeout(() => { void connect(); }, Math.max(1000, data.expiresAt - Date.now() - 60000));
          } catch (e) { fail(e instanceof Error ? e.message : "Google satellite is unavailable."); }
        };
        m.on("movestart", () => { sequence++; hideSatellite(); });
        m.on("moveend", () => { void metadata(); });
        void connect();
      });
    }).catch(() => fail("The interactive map could not load. Check WebGL support and reload."));
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(renewal);
      resize?.disconnect();
      current?.remove();
      instance.current = null;
    };
  }, [canopyUrl, retry]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    (map.getSource("routes") as GeoJSONSource).setData(routes);
    if (map.getLayer("canopy")) map.setPaintProperty("canopy", "raster-opacity", canopyOpacity);
  }, [map, routes, canopyOpacity]);

  useEffect(() => {
    if (map && instance.current === map && focusRequest > 0) fitView(map);
  }, [map, focusRequest]);

  return (
    <>
      <div ref={container} className="satellite-map" aria-label="Google satellite map with canopy, crown peaks, home and routes" />
      {status && <div className="map-status" role="status"><span>{status}</span>{!status.startsWith("Loading") && <button type="button" className="btn small" onClick={() => { setStatus("Loading Google satellite…"); setAttribution(""); setMap(null); setRetry((n) => n + 1); }}>Reconnect</button>}</div>}
      {attribution && <div className="google-attribution"><img src="/brand/google-maps-white.png" alt="Google Maps" width="98" height="18" /><span>{attribution}</span><a href="https://www.google.com/help/terms_maps/" target="_blank" rel="noreferrer">Terms</a></div>}
      <button type="button" className="btn small map-fit" onClick={() => { if (map) fitView(map); }} disabled={!map}>Fit study area</button>
    </>
  );
}
