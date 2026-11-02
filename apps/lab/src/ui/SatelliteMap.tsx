import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import type { FeatureCollection, LineString, MultiPolygon, Point, Polygon } from "geojson";
import type { ExpressionSpecification, GeoJSONSource, ImageSource, Map as MapLibreMap, RasterTileSource } from "maplibre-gl";
import { HOME_WGS84, PEAKS, RASTER_CORNERS } from "../geo/layer";
import type { SavedMap } from "../domain/types";
import { googleViewportCovered } from "../geo/googleCoverage";
import { BASEMAP_NAMES, ESRI_CREDITS, type BasemapId, type MapCorners, type SamResult, type SatelliteMapHandle } from "../geo/sam";
import { captureSatelliteView } from "./captureMap";
import { SamDrawTools } from "./SamDrawTools";
import { bindMapPanGestures } from "./mapPanGestures";
import type { SamAreaController } from "./useSamArea";
import { areaBounds, type AreaPoint } from "../geo/samArea";
import { edgeAt, insidePolygon, vertexAt } from "../geo/polygonEdit";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { PlanningPoints, LngLat } from "../geo/planningPoints";
import type { PlanningEditMode } from "./usePlanningPoints";
import type { MusePyramid } from "../geo/musePyramid";

interface Props {
  savedMap: SavedMap;
  boundaryShown: boolean;
  canopyUrl: string | null;
  canopyCorners: MapCorners | null;
  canopyOpacity: number;
  routes: FeatureCollection<LineString>;
  peakColors: string[];
  peaksShown: boolean;
  focusRequest: number;
  basemap: BasemapId;
  captureRef: RefObject<SatelliteMapHandle | null>;
  samResult: SamResult | null;
  samShown: boolean;
  musePyramid: MusePyramid | null;
  musePyramidShown: boolean;
  musePyramidOpacity: number;
  crownMatches: FeatureCollection<Point | Polygon>;
  crownMatchesShown: boolean;
  crownReviewShown: boolean;
  estimatedCover: PlanningPoints["coverage"] | null;
  estimatedCoverShown: boolean;
  planningData: FeatureCollection<Point | LineString>;
  planningShown: boolean;
  planningLabels: boolean;
  clusterData: FeatureCollection<MultiPolygon | Point | LineString>;
  clustersShown: boolean;
  clusterLabels: boolean;
  planningRouteA: boolean;
  planningRouteB: boolean;
  planningEditor: { mode: PlanningEditMode; add(p: LngLat): void; move(id: string, p: LngLat): void; remove(id: string): void; setHome(p: LngLat): void; exclude(area: Polygon): void };
  samArea: SamAreaController;
  samBusy: boolean;
  addingMap: boolean;
}

const viewBounds: [[number, number], [number, number]] = [
  [Math.min(HOME_WGS84[0], ...RASTER_CORNERS.map((c) => c[0])), Math.min(HOME_WGS84[1], ...RASTER_CORNERS.map((c) => c[1]))],
  [Math.max(HOME_WGS84[0], ...RASTER_CORNERS.map((c) => c[0])), Math.max(HOME_WGS84[1], ...RASTER_CORNERS.map((c) => c[1]))],
];
const fitView = (map: MapLibreMap, saved: SavedMap) => saved.id === "upm" ? map.fitBounds(viewBounds, { padding: { top: 35, bottom: 55, left: 35, right: 50 }, duration: 0, maxZoom: 20 }) : saved.boundary ? map.fitBounds(areaBounds(saved.boundary), { padding: { top: 80, bottom: 60, left: 35, right: 35 }, duration: 0, maxZoom: 22 }) : map.jumpTo({ center: saved.center, zoom: saved.zoom, bearing: 0 });

export function SatelliteMap({ savedMap, boundaryShown, canopyUrl, canopyCorners, canopyOpacity, routes, peakColors, peaksShown, focusRequest, basemap, captureRef, samResult, samShown, musePyramid, musePyramidShown, musePyramidOpacity, crownMatches, crownMatchesShown, crownReviewShown, estimatedCover, estimatedCoverShown, planningData, planningShown, planningLabels, clusterData, clustersShown, clusterLabels, planningRouteA, planningRouteB, planningEditor, samArea, samBusy, addingMap }: Props) {
  const planningState = useRef(planningEditor);
  useEffect(() => { planningState.current = planningEditor; }, [planningEditor]);
  const planningFrame = useRef(planningData);
  useEffect(() => { planningFrame.current = planningData; }, [planningData]);
  const initialMap = useRef(savedMap).current;
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<MapLibreMap | null>(null);
  const colors = useRef(peakColors);
  const camera = useRef<{ center: [number, number]; zoom: number; bearing: number } | null>(null);
  const lastFocus = useRef(focusRequest);
  const drawing = useRef(samArea.drawing);
  const areaState = useRef({ area: samArea, busy: samBusy, boundaryShown });
  const vertexDrag = useRef<{ index: number; checkpoint: boolean } | null>(null);
  const lastFinishedAt = useRef(0);
  const panGestures = useRef<ReturnType<typeof bindMapPanGestures> | null>(null);
  const [pointer, setPointer] = useState<AreaPoint | null>(null);
  const [outputAreaShown, setOutputAreaShown] = useState(false);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState(`Loading ${BASEMAP_NAMES[basemap]}…`);
  const [attribution, setAttribution] = useState("");

  useEffect(() => {
    let disposed = false;
    let current: MapLibreMap | undefined;
    let resize: ResizeObserver | undefined;
    let renewal: ReturnType<typeof setTimeout> | undefined;
    let sequence = 0;
    let sourceFailed = false;
    const rasterId = basemap === "esri" ? "esri-satellite" : "google-satellite";
    const controller = new AbortController();
    const hideSatellite = () => {
      if (current?.getLayer(rasterId)) current.setPaintProperty(rasterId, "raster-opacity", 0);
    };
    const fail = (message: string) => {
      if (disposed) return;
      sourceFailed = true;
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
      setStatus(`Loading ${BASEMAP_NAMES[basemap]}…`);
      setAttribution("");
      setWorkerUrl(workerUrl);
      current = new Map({
        container: container.current, center: initialMap.center, zoom: initialMap.zoom, ...camera.current, minZoom: 2, maxZoom: 22,
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
        if ((event as { sourceId?: string }).sourceId === rasterId) fail(`${BASEMAP_NAMES[basemap]} tiles are unavailable. Check the connection and reconnect.`);
        else if (event.error.message.includes("Worker")) fail("The map overlay worker could not load. Reload the app.");
      });
      m.on("load", () => {
        if (disposed) return;
        if (!camera.current) fitView(m, initialMap);
        m.addSource(rasterId, { type: "raster", tiles: basemap === "esri" ? ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] : [], tileSize: 256, maxzoom: basemap === "esri" ? 19 : 22 });
        m.addLayer({ id: rasterId, type: "raster", source: rasterId, paint: { "raster-opacity": basemap === "esri" ? 1 : 0, "raster-fade-duration": 0 } });
        m.addSource("sam", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "sam-fill", type: "fill", source: "sam", paint: { "fill-color": "#a3a3a3", "fill-opacity": 0.4 } });
        m.addLayer({ id: "sam-outline-halo", type: "line", source: "sam", paint: { "line-color": "#303030", "line-width": 6, "line-opacity": 0.9 } });
        m.addLayer({ id: "sam-outline", type: "line", source: "sam", paint: { "line-color": "#e0e0e0", "line-width": 3 } });
        m.addSource("crown-matches", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        const reviewColor: ExpressionSpecification = ["match", ["get", "status"], "crowns_accounted_for", "#34d058", "no_visible_palms", "#b9c0c9", "uncertain", "#cb8bff", "missed_palms", "#ff6840", "#ffb700"];
        m.addLayer({ id: "crown-sector-fill", type: "fill", source: "crown-matches", filter: ["==", ["get", "kind"], "sector-review"], paint: { "fill-color": reviewColor, "fill-opacity": 0.08 } });
        m.addLayer({ id: "crown-sector-outline", type: "line", source: "crown-matches", filter: ["==", ["get", "kind"], "sector-review"], paint: { "line-color": reviewColor, "line-width": 1, "line-dasharray": [3, 2] } });
        m.addLayer({ id: "crown-sector-label", type: "symbol", source: "crown-matches", filter: ["==", ["get", "kind"], "sector-review"], layout: { "text-field": ["get", "sectorId"], "text-size": 12 }, paint: { "text-color": reviewColor, "text-halo-color": "#111111", "text-halo-width": 2 } });
        m.addLayer({ id: "crown-match-box-halo", type: "line", source: "crown-matches", filter: ["all", ["==", ["geometry-type"], "Polygon"], ["!=", ["get", "kind"], "sector-review"]], paint: { "line-color": "#302400", "line-width": 4 } });
        m.addLayer({ id: "crown-match-box", type: "line", source: "crown-matches", filter: ["all", ["==", ["geometry-type"], "Polygon"], ["!=", ["get", "kind"], "sector-review"]], paint: { "line-color": "#ffda00", "line-width": 1.5 } });
        m.addLayer({ id: "crown-match-center", type: "circle", source: "crown-matches", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 3, "circle-color": "#ffda00", "circle-stroke-color": "#302400", "circle-stroke-width": 1 } });
        m.addSource("sam-output-area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "sam-output-area-halo", type: "line", source: "sam-output-area", paint: { "line-color": "#303030", "line-width": 6, "line-opacity": 0.9, "line-dasharray": [1.5, 1] } });
        m.addLayer({ id: "sam-output-area", type: "line", source: "sam-output-area", paint: { "line-color": "#e0e0e0", "line-width": 3, "line-dasharray": [3, 2] } });
        m.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        for (const slot of [0, 1]) m.addLayer({
          id: `route-${slot}`, type: "line", source: "routes", filter: ["==", ["get", "slot"], slot],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": slot === 0 ? "#fff" : "#f0543a", "line-width": 3, ...(slot === 1 ? { "line-dasharray": [3, 2] } : {}) },
        });
        m.addSource("peaks", { type: "geojson", data: {
          type: "FeatureCollection", features: initialMap.id === "upm" ? PEAKS.map((p, i) => ({ type: "Feature", properties: { id: p.id, height: p.h, color: colors.current[i] }, geometry: { type: "Point", coordinates: p.lonLat } })) : [],
        } });
        m.addLayer({ id: "peaks", type: "circle", source: "peaks", paint: { "circle-radius": 4.5, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
        m.addSource("home", { type: "geojson", data: { type: "FeatureCollection", features: initialMap.id === "upm" ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: HOME_WGS84 } }] : [] } });
        m.addLayer({ id: "home", type: "circle", source: "home", paint: { "circle-radius": 7, "circle-color": "#1f9d55", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
        m.addSource("sam-area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addSource("study-area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "study-area-halo", type: "line", source: "study-area", paint: { "line-color": "#102b30", "line-width": 5, "line-opacity": 0.8, "line-dasharray": [2, 1] } });
        m.addLayer({ id: "study-area-outline", type: "line", source: "study-area", paint: { "line-color": "#00d5ef", "line-width": 2.5, "line-dasharray": [4, 2] } });
        m.addLayer({ id: "sam-area-fill", type: "fill", source: "sam-area", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#00d5ef", "fill-opacity": 0.08 } });
        m.addLayer({ id: "sam-area-line", type: "line", source: "sam-area", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": "#00d5ef", "line-width": 2.5 } });
        m.addLayer({ id: "sam-area-points", type: "circle", source: "sam-area", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-color": "#00a4c3", "circle-stroke-width": 2 } });
        const c = initialMap.center;
        m.addSource("estimated-tree-cover", { type: "image", url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4AWMAAQAABQABNtCI3QAAAABJRU5ErkJggg==", coordinates: [[c[0] - .001, c[1] + .001], [c[0] + .001, c[1] + .001], [c[0] + .001, c[1] - .001], [c[0] - .001, c[1] - .001]] });
        m.addLayer({ id: "estimated-tree-cover", type: "raster", source: "estimated-tree-cover", paint: { "raster-opacity": 0, "raster-fade-duration": 0 } });
        m.addSource("planning-exclusion-draft", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "planning-exclusion-fill", type: "fill", source: "planning-exclusion-draft", paint: { "fill-color": "#ff5e00", "fill-opacity": .2 } });
        m.addLayer({ id: "planning-exclusion-line", type: "line", source: "planning-exclusion-draft", paint: { "line-color": "#ff5e00", "line-width": 2 } });
        m.addSource("planning-clusters", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "planning-cluster-fill", type: "fill", source: "planning-clusters", filter: ["==", ["get", "kind"], "cluster-boundary"], paint: { "fill-color": ["get", "color"], "fill-opacity": .13 } });
        m.addLayer({ id: "planning-cluster-outline", type: "line", source: "planning-clusters", filter: ["==", ["get", "kind"], "cluster-boundary"], paint: { "line-color": ["get", "color"], "line-width": 2.5 } });
        m.addLayer({ id: "planning-cluster-road", type: "line", source: "planning-clusters", filter: ["==", ["get", "kind"], "road-reference"], paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [2, 2], "line-opacity": .9 } });
        m.addSource("planning", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        for (const id of ["A", "B"]) m.addLayer({ id: `planning-route-${id}`, type: "line", source: "planning", filter: ["all", ["==", ["get", "kind"], "planning-route"], ["==", ["get", "algorithm"], id]], paint: { "line-color": id === "A" ? "#ffae00" : "#00e6ff", "line-width": 3, ...(id === "A" ? { "line-dasharray": [3, 2] } : {}) } });
        m.addLayer({ id: "planning-points", type: "circle", source: "planning", filter: ["==", ["get", "kind"], "planning-point"], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 16, 2.5, 19, 4.5, 22, 6], "circle-color": ["coalesce", ["get", "clusterColor"], ["match", ["get", "source"], "canopy-estimate", "#ffee00", "manual", "#00e6ff", "#b6ff00"]], "circle-stroke-color": "#142c00", "circle-stroke-width": 1.5 } });
        m.addLayer({ id: "planning-labels", type: "symbol", source: "planning", filter: ["==", ["get", "kind"], "planning-point"], layout: { "text-field": ["get", "id"], "text-size": 11, "text-offset": [0, 1.3] }, paint: { "text-color": "#fff", "text-halo-color": "#111", "text-halo-width": 2 } });
        m.addLayer({ id: "planning-cluster-labels", type: "symbol", source: "planning-clusters", filter: ["==", ["get", "kind"], "cluster-label"], layout: { "text-field": ["get", "label"], "text-size": 13, "text-offset": [0, -1.3] }, paint: { "text-color": ["get", "color"], "text-halo-color": "#111", "text-halo-width": 2 } });
        m.addLayer({ id: "planning-cluster-starts", type: "circle", source: "planning-clusters", filter: ["==", ["get", "kind"], "cluster-start"], paint: { "circle-radius": 6, "circle-color": "#ffffff", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 3 } });
        m.addLayer({ id: "planning-home", type: "circle", source: "planning", filter: ["==", ["get", "kind"], "planning-home"], paint: { "circle-radius": 8, "circle-color": "#ffc400", "circle-stroke-color": "#111", "circle-stroke-width": 2 } });
        m.on("click", "planning-points", (event) => { if (planningState.current.mode !== "view" || drawing.current) return; const p = event.features?.[0]?.properties; if (p) new Popup().setLngLat(event.lngLat).setText(`${p.id} · ${p.source === "canopy-estimate" ? "estimated tree centre" : "approximate crown centre"}${p.clusterId ? ` · cluster ${p.clusterId}` : ""}${p.edited ? " · manually adjusted" : ""}${typeof p.canopyHeightM === "number" ? ` · CHMv2 ${p.canopyHeightM} m` : ""}`).addTo(m); });
        m.on("click", "peaks", (event) => {
          if (drawing.current || planningState.current.mode !== "view") return;
          const p = event.features?.[0]?.properties;
          if (p) new Popup().setLngLat(event.lngLat).setText(`Peak ${p.id}, CHMv2 ${p.height} m`).addTo(m);
        });
        m.on("click", "home", (event) => { if (!drawing.current && planningState.current.mode === "view") new Popup().setLngLat(event.lngLat).setText("Home · launch and landing").addTo(m); });
        m.on("click", "sam-fill", (event) => {
          if (drawing.current || planningState.current.mode !== "view") return;
          const p = event.features?.[0]?.properties;
          if (p) new Popup().setLngLat(event.lngLat).setText(`SAM 3.1 segment ${p.objectId}${typeof p.confidence === "number" ? ` · confidence ${(p.confidence * 100).toFixed(0)}%` : ""}`).addTo(m);
        });
        m.on("click", "crown-match-center", (event) => {
          if (drawing.current || planningState.current.mode !== "view") return;
          const p = event.features?.[0]?.properties;
          if (p) new Popup().setLngLat(event.lngLat).setText(`Template candidate ${p.candidateId} · similarity ${Number(p.similarity).toFixed(2)} · not a verified tree`).addTo(m);
        });
        setMap(m);

        if (basemap === "esri") {
          m.on("sourcedata", (event) => {
            if (!disposed && !sourceFailed && event.sourceId === rasterId && m.isSourceLoaded(rasterId)) { setAttribution(ESRI_CREDITS); setStatus(""); }
          });
          return;
        }

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
      if (current) camera.current = { center: current.getCenter().toArray(), zoom: current.getZoom(), bearing: current.getBearing() };
      current?.remove();
      instance.current = null;
    };
  }, [retry, basemap, initialMap]);

  useImperativeHandle(captureRef, () => ({ getView: () => map && instance.current === map ? { center: map.getCenter().toArray(), zoom: map.getZoom() } : null, locate: (location) => {
    if (!map || instance.current !== map) return false;
    map.jumpTo({ center: location.center, zoom: location.zoom, bearing: 0 });
    return true;
  }, capture: async (signal, area) => {
    if (!map || instance.current !== map || !attribution || status) throw Error("Wait for the satellite map to finish loading.");
    return captureSatelliteView(map, basemap, signal, area);
  }, fitOutput: (result) => {
    if (!map || instance.current !== map) return;
    const bounds = areaBounds(result.area ?? { type: "Polygon", coordinates: [[...result.frame.corners, result.frame.corners[0]]] });
    setOutputAreaShown(true);
    map.fitBounds(bounds, { padding: { top: 45, bottom: 55, left: 35, right: 45 }, duration: 400, maxZoom: 20 });
  }, fitArea: (area) => {
    if (!map || instance.current !== map) return;
    map.fitBounds(areaBounds(area), { padding: { top: 45, bottom: 55, left: 35, right: 45 }, duration: 400, maxZoom: 20 });
  } }), [map, attribution, status, basemap]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    const gestures = bindMapPanGestures(map, () => drawing.current, () => { vertexDrag.current = null; setPointer(null); });
    panGestures.current = gestures;
    return () => { gestures.destroy(); panGestures.current = null; };
  }, [map]);

  useEffect(() => {
    areaState.current = { area: samArea, busy: samBusy, boundaryShown };
    drawing.current = samArea.drawing;
    if (!samArea.drawing) vertexDrag.current = null;
    if (vertexDrag.current) map?.getCanvas().style.setProperty("cursor", "grabbing");
    else panGestures.current?.updateCursor();
  }, [samArea, samBusy, boundaryShown, map]);

  useEffect(() => {
    if (!map || instance.current !== map || !samArea.drawing) return;
    const wasEnabled = map.doubleClickZoom.isEnabled();
    map.doubleClickZoom.disable(); map.getCanvas().focus({ preventScroll: true });
    return () => { if (wasEnabled) map.doubleClickZoom.enable(); };
  }, [map, samArea.drawing]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    const canvas = map.getCanvas(), win = canvas.ownerDocument.defaultView!;
    const finish = (blockReopen = false) => { lastFinishedAt.current = blockReopen ? performance.now() : 0; vertexDrag.current = null; areaState.current.area.finish(); };
    const click = (event: import("maplibre-gl").MapMouseEvent) => {
      const { area } = areaState.current;
      if (!area.drawing) return;
      event.preventDefault();
      if (area.editing || event.originalEvent.button !== 0 || event.originalEvent.detail > 1 || panGestures.current?.active()) return;
      const point = event.lngLat.toArray(), first = area.vertices[0];
      if (first && area.vertices.length >= 3 && map.project(first).dist(event.point) < 10) { finish(true); return; }
      area.addVertex(point); setPointer(point);
    };
    const move = (event: import("maplibre-gl").MapMouseEvent) => {
      const { area } = areaState.current;
      if (panGestures.current?.active() || vertexDrag.current) return;
      if (area.editing) {
        const points = area.vertices.map((p) => map.project(p));
        canvas.style.cursor = vertexAt(points, event.point) >= 0 ? "grab" : edgeAt(points, event.point) ? "copy" : "crosshair";
      } else if (area.drawing) setPointer(event.lngLat.toArray());
    };
    const doubleClick = (event: import("maplibre-gl").MapMouseEvent) => {
      if (planningState.current.mode !== "view") { event.preventDefault(); return; }
      if (panGestures.current?.active()) { event.preventDefault(); return; }
      const { area, busy } = areaState.current;
      if (area.editing) {
        event.preventDefault();
        const points = area.vertices.map((p) => map.project(p));
        if (vertexAt(points, event.point) >= 0) return;
        const edge = edgeAt(points, event.point);
        if (edge) area.insertVertex(edge.index, map.unproject([edge.point.x, edge.point.y]).toArray());
      } else if (area.drawing) { event.preventDefault(); finish(); }
      else if (area.polygon) {
        if (area.usingDefault && !areaState.current.boundaryShown) return;
        const points = area.polygon.coordinates[0]!.slice(0, -1).map((p) => map.project([p[0]!, p[1]!]));
        if (edgeAt(points, event.point) || insidePolygon(points, event.point)) {
          event.preventDefault();
          if (!busy && performance.now() - lastFinishedAt.current > 250) { setPointer(null); area.edit(); }
        }
      }
    };
    const rightClick = (event: MouseEvent) => {
      if (!areaState.current.area.drawing) return;
      event.preventDefault(); event.stopPropagation(); finish();
    };
    const key = (event: KeyboardEvent) => {
      const { area } = areaState.current;
      if (!area.drawing) return;
      if (event.key === "Escape") { event.preventDefault(); vertexDrag.current = null; area.cancel(); }
      else if (event.key === "Enter") { event.preventDefault(); finish(); }
      else if (event.key === "Backspace" || event.key === "Delete") { event.preventDefault(); area.undo(); }
    };
    const position = (event: MouseEvent): [number, number] => { const rect = canvas.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top]; };
    const down = (event: MouseEvent) => {
      const { area, busy } = areaState.current;
      if (!area.editing || busy || event.button !== 0 || panGestures.current?.active()) return;
      const [x, y] = position(event);
      const index = vertexAt(area.vertices.map((p) => map.project(p)), { x, y });
      if (index < 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      vertexDrag.current = { index, checkpoint: true };
      canvas.focus({ preventScroll: true }); canvas.style.cursor = "grabbing"; map.stop();
    };
    const drag = (event: MouseEvent) => {
      const current = vertexDrag.current;
      if (!current || panGestures.current?.active()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      areaState.current.area.moveVertex(current.index, map.unproject(position(event)).toArray(), current.checkpoint);
      current.checkpoint = false;
    };
    const release = (event?: MouseEvent) => {
      if (!vertexDrag.current || (event && event.button !== 0)) return;
      event?.preventDefault(); event?.stopImmediatePropagation(); vertexDrag.current = null; panGestures.current?.updateCursor();
    };
    const blur = () => release();
    map.on("click", click); map.on("mousemove", move); map.on("dblclick", doubleClick);
    canvas.addEventListener("keydown", key); canvas.addEventListener("contextmenu", rightClick, true); canvas.addEventListener("mousedown", down, true);
    win.addEventListener("mousemove", drag, true); win.addEventListener("mouseup", release, true); win.addEventListener("blur", blur);
    return () => {
      vertexDrag.current = null;
      map.off("click", click); map.off("mousemove", move); map.off("dblclick", doubleClick);
      canvas.removeEventListener("keydown", key); canvas.removeEventListener("contextmenu", rightClick, true); canvas.removeEventListener("mousedown", down, true);
      win.removeEventListener("mousemove", drag, true); win.removeEventListener("mouseup", release, true); win.removeEventListener("blur", blur);
    };
  }, [map]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    const canvas = map.getCanvas(), win = canvas.ownerDocument.defaultView!;
    let dragging: { id: string; coordinate: LngLat } | null = null;
    let excluding: { start: LngLat; end: LngLat } | null = null;
    const emptyDraft = () => (map.getSource("planning-exclusion-draft") as GeoJSONSource).setData({ type: "FeatureCollection", features: [] });
    const rectangle = (a: LngLat, b: LngLat): Polygon => ({ type: "Polygon", coordinates: [[[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])], [Math.min(a[0], b[0]), Math.max(a[1], b[1])], [Math.min(a[0], b[0]), Math.min(a[1], b[1])]]] });
    const source = () => map.getSource("planning") as GeoJSONSource;
    const pointId = (point: [number, number]) => map.queryRenderedFeatures([[point[0] - 8, point[1] - 8], [point[0] + 8, point[1] + 8]], { layers: ["planning-points"] })[0]?.properties?.id as string | undefined;
    const position = (event: MouseEvent): [number, number] => { const rect = canvas.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top]; };
    const click = (event: import("maplibre-gl").MapMouseEvent) => {
      const editor = planningState.current;
      if (editor.mode === "view" || drawing.current || panGestures.current?.active() || event.originalEvent.detail > 1) return;
      event.preventDefault(); const point = event.lngLat.toArray();
      if (editor.mode === "add") editor.add(point);
      else if (editor.mode === "home") editor.setHome(point);
      else if (editor.mode === "delete") { const id = pointId([event.point.x, event.point.y]); if (id) editor.remove(id); }
    };
    const down = (event: MouseEvent) => {
      if (drawing.current || event.button !== 0 || panGestures.current?.active()) return;
      if (planningState.current.mode === "exclude") { event.preventDefault(); event.stopImmediatePropagation(); const coordinate = map.unproject(position(event)).toArray(); excluding = { start: coordinate, end: coordinate }; map.stop(); return; }
      if (planningState.current.mode !== "move") return;
      const point = position(event), id = pointId(point); if (!id) return;
      event.preventDefault(); event.stopImmediatePropagation(); map.stop();
      dragging = { id, coordinate: map.unproject(point).toArray() }; canvas.style.cursor = "grabbing";
    };
    const move = (event: MouseEvent) => {
      if (excluding && !panGestures.current?.active()) { event.preventDefault(); event.stopImmediatePropagation(); excluding.end = map.unproject(position(event)).toArray(); (map.getSource("planning-exclusion-draft") as GeoJSONSource).setData({ type: "Feature", properties: {}, geometry: rectangle(excluding.start, excluding.end) }); return; }
      if (!dragging || panGestures.current?.active()) return;
      event.preventDefault(); event.stopImmediatePropagation(); dragging.coordinate = map.unproject(position(event)).toArray();
      const current = dragging;
      source().setData({ type: "FeatureCollection", features: planningFrame.current.features.filter((f) => f.properties?.kind !== "planning-route").map((f) => f.properties?.id === current.id ? { ...f, geometry: { type: "Point" as const, coordinates: current.coordinate } } : f) });
    };
    const release = (event: MouseEvent) => {
      if (excluding && event.button === 0) { event.preventDefault(); event.stopImmediatePropagation(); const current = excluding; excluding = null; emptyDraft(); const a = map.project(current.start), b = map.project(current.end); if (Math.abs(a.x - b.x) > 6 && Math.abs(a.y - b.y) > 6) planningState.current.exclude(rectangle(current.start, current.end)); return; }
      if (!dragging || event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation(); const current = dragging; dragging = null;
      source().setData(planningFrame.current); canvas.style.cursor = "grab";
      planningState.current.move(current.id, current.coordinate);
    };
    const blur = () => { excluding = null; emptyDraft(); if (dragging) { dragging = null; source().setData(planningFrame.current); panGestures.current?.updateCursor(); } };
    map.on("click", click); canvas.addEventListener("mousedown", down, true); win.addEventListener("mousemove", move, true); win.addEventListener("mouseup", release, true); win.addEventListener("blur", blur);
    return () => { dragging = null; excluding = null; map.off("click", click); canvas.removeEventListener("mousedown", down, true); win.removeEventListener("mousemove", move, true); win.removeEventListener("mouseup", release, true); win.removeEventListener("blur", blur); };
  }, [map]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    (map.getSource("planning-clusters") as GeoJSONSource).setData(clusterData);
    for (const layer of ["planning-cluster-fill", "planning-cluster-outline", "planning-cluster-road", "planning-cluster-starts"]) map.setLayoutProperty(layer, "visibility", clustersShown ? "visible" : "none");
    map.setLayoutProperty("planning-cluster-labels", "visibility", clustersShown && clusterLabels ? "visible" : "none");
  }, [map, clusterData, clustersShown, clusterLabels]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    if (estimatedCover) (map.getSource("estimated-tree-cover") as ImageSource).updateImage({ url: estimatedCover.maskDataUrl, coordinates: estimatedCover.corners });
    map.setPaintProperty("estimated-tree-cover", "raster-opacity", estimatedCover && estimatedCoverShown ? .7 : 0);
  }, [map, estimatedCover, estimatedCoverShown]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    (map.getSource("planning") as GeoJSONSource).setData(planningData);
    for (const layer of ["planning-points", "planning-home"]) map.setLayoutProperty(layer, "visibility", planningShown ? "visible" : "none");
    map.setLayoutProperty("planning-labels", "visibility", planningShown && planningLabels ? "visible" : "none");
    map.setLayoutProperty("planning-route-A", "visibility", planningRouteA ? "visible" : "none");
    map.setLayoutProperty("planning-route-B", "visibility", planningRouteB ? "visible" : "none");
  }, [map, planningData, planningShown, planningLabels, clusterData, clustersShown, clusterLabels, planningRouteA, planningRouteB]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    const data: FeatureCollection = { type: "FeatureCollection", features: [] };
    if (samArea.editing) {
      const points = samArea.vertices;
      if (points.length >= 3) data.features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...points, points[0]!]] } });
      points.forEach((point, index) => data.features.push({ type: "Feature", properties: { vertexIndex: index }, geometry: { type: "Point", coordinates: point } }));
    } else if (samArea.drawing) {
      const points = [...samArea.vertices];
      const last = points.at(-1);
      if (pointer && last && (pointer[0] !== last[0] || pointer[1] !== last[1])) points.push(pointer);
      if (points.length >= 2) data.features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } });
      if (points.length >= 3) data.features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...points, points[0]!]] } });
      for (const point of samArea.vertices) data.features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: point } });
    } else if (samArea.polygon) data.features.push({ type: "Feature", properties: {}, geometry: samArea.polygon });
    (map.getSource("sam-area") as GeoJSONSource).setData(data);
  }, [map, samArea.drawing, samArea.editing, samArea.vertices, samArea.polygon, pointer]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    (map.getSource("study-area") as GeoJSONSource).setData({ type: "FeatureCollection", features: savedMap.boundary && !addingMap ? [{ type: "Feature", properties: {}, geometry: savedMap.boundary }] : [] });
  }, [map, savedMap.boundary, addingMap]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    for (const layer of ["study-area-halo", "study-area-outline"]) map.setLayoutProperty(layer, "visibility", boundaryShown ? "visible" : "none");
    const selectionVisible = samArea.drawing || addingMap || !samArea.usingDefault || boundaryShown;
    for (const layer of ["sam-area-fill", "sam-area-line", "sam-area-points"]) map.setLayoutProperty(layer, "visibility", selectionVisible ? "visible" : "none");
  }, [map, boundaryShown, samArea.drawing, samArea.usingDefault, addingMap]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    const data: FeatureCollection = { type: "FeatureCollection", features: [] };
    if (samResult && outputAreaShown) data.features.push({ type: "Feature", properties: {}, geometry: samResult.area ?? { type: "Polygon", coordinates: [[...samResult.frame.corners, samResult.frame.corners[0]]] } });
    (map.getSource("sam-output-area") as GeoJSONSource).setData(data);
  }, [map, samResult, outputAreaShown]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    (map.getSource("routes") as GeoJSONSource).setData(routes);
  }, [map, routes]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    if (!canopyUrl || !canopyCorners) {
      if (map.getLayer("canopy")) map.removeLayer("canopy");
      if (map.getSource("canopy")) map.removeSource("canopy");
      return;
    }
    const source = map.getSource("canopy") as ImageSource | undefined;
    if (source) source.updateImage({ url: canopyUrl, coordinates: canopyCorners });
    else {
      map.addSource("canopy", { type: "image", url: canopyUrl, coordinates: canopyCorners });
      map.addLayer({ id: "canopy", type: "raster", source: "canopy", paint: { "raster-opacity": 0, "raster-resampling": "nearest", "raster-fade-duration": 0 } }, "sam-fill");
    }
  }, [map, canopyUrl, canopyCorners]);

  useEffect(() => {
    if (map && instance.current === map && map.getLayer("canopy")) map.setPaintProperty("canopy", "raster-opacity", canopyOpacity);
  }, [map, canopyUrl, canopyCorners, canopyOpacity]);

  useEffect(() => {
    if (map && instance.current === map) map.setLayoutProperty("peaks", "visibility", peaksShown ? "visible" : "none");
  }, [map, peaksShown]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    (map.getSource("sam") as GeoJSONSource).setData(samResult?.regions ?? { type: "FeatureCollection", features: [] });
    for (const layer of ["sam-fill", "sam-outline-halo", "sam-outline"]) map.setLayoutProperty(layer, "visibility", samShown ? "visible" : "none");
  }, [map, samResult, samShown]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    if (map.getLayer("muse-enhancement")) map.removeLayer("muse-enhancement");
    if (map.getSource("muse-enhancement")) map.removeSource("muse-enhancement");
    if (!musePyramid) return;
    map.addSource("muse-enhancement", { type: "raster", tiles: musePyramid.tiles.map((url) => `${location.origin}${url}`), tileSize: musePyramid.tileSize, minzoom: musePyramid.minzoom, maxzoom: musePyramid.maxzoom, bounds: musePyramid.bounds, attribution: musePyramid.attribution });
    map.addLayer({ id: "muse-enhancement", type: "raster", source: "muse-enhancement", paint: { "raster-opacity": 0, "raster-fade-duration": 0, "raster-resampling": "linear" } }, map.getLayer("canopy") ? "canopy" : "sam-fill");
  }, [map, musePyramid]);

  useEffect(() => {
    if (!map || instance.current !== map || !map.getLayer("muse-enhancement")) return;
    map.setPaintProperty("muse-enhancement", "raster-opacity", musePyramidOpacity);
    map.setLayoutProperty("muse-enhancement", "visibility", musePyramidShown ? "visible" : "none");
  }, [map, musePyramid, musePyramidShown, musePyramidOpacity]);

  useEffect(() => {
    if (!map || instance.current !== map) return;
    (map.getSource("crown-matches") as GeoJSONSource).setData(crownMatches);
    for (const layer of ["crown-match-box-halo", "crown-match-box", "crown-match-center"]) map.setLayoutProperty(layer, "visibility", crownMatchesShown ? "visible" : "none");
    for (const layer of ["crown-sector-fill", "crown-sector-outline", "crown-sector-label"]) map.setLayoutProperty(layer, "visibility", crownReviewShown ? "visible" : "none");
  }, [map, crownMatches, crownMatchesShown, crownReviewShown]);

  useEffect(() => {
    if (map && instance.current === map && focusRequest !== lastFocus.current) { lastFocus.current = focusRequest; fitView(map, savedMap); }
  }, [map, focusRequest, savedMap]);

  return (
    <>
      <div ref={container} className="satellite-map" aria-label={`${BASEMAP_NAMES[basemap]} map of ${savedMap.name}${savedMap.id === "upm" ? " with canopy, crown peaks, SAM masks, home and routes" : " with SAM masks"}`} />
      <SamDrawTools area={samArea} addingMap={addingMap} />
      {status && <div className="map-status" role="status"><span>{status}</span>{!status.startsWith("Loading") && <button type="button" className="btn small" onClick={() => { setStatus(`Loading ${BASEMAP_NAMES[basemap]}…`); setAttribution(""); setMap(null); setRetry((n) => n + 1); }}>Reconnect</button>}</div>}
      {attribution && <div className="google-attribution">{basemap === "google" ? <img src="/brand/google-maps-white.png" alt="Google Maps" width="98" height="18" /> : <strong>Esri World Imagery</strong>}<span>{attribution}</span>{musePyramid && musePyramidShown && <span>{musePyramid.attribution}</span>}{canopyUrl && canopyOpacity > 0 && <span>CHMv2: Meta/WRI · Vantor · CC BY 4.0</span>}<a href={basemap === "google" ? "https://www.google.com/help/terms_maps/" : "https://goto.arcgis.com/termsofuse/viewsummary"} target="_blank" rel="noreferrer">Terms</a></div>}
    </>
  );
}
