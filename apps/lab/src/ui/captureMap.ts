import type { Map as MapLibreMap, RasterTileSource } from "maplibre-gl";
import type { Polygon } from "geojson";
import type { BasemapId, MapCorners, SamImage } from "../geo/sam";
import { areaBounds, samAreaError } from "../geo/samArea";

/** A separate, bounded renderer captures only the basemap without disturbing the visible map. */
export async function captureSatelliteView(current: MapLibreMap, source: BasemapId, signal: AbortSignal, area: Polygon): Promise<SamImage> {
  signal.throwIfAborted();
  const areaError = samAreaError(area);
  if (areaError) throw Error(areaError);
  if (current.isMoving()) throw Error("Wait for the map to stop moving before capturing the selected area.");
  const rasterId = source === "esri" ? "esri-satellite" : "google-satellite";
  const raster = current.getSource(rasterId) as RasterTileSource | undefined;
  // Overlay workers may still be updating after typing a prompt; capture only needs imagery.
  if (!raster || !current.isSourceLoaded(rasterId)) throw Error("Wait for satellite imagery to finish loading.");
  const bounds = areaBounds(area);
  const style = { version: 8 as const, sources: { satellite: raster.serialize() }, layers: [{ id: "satellite", type: "raster" as const, source: "satellite", paint: { "raster-fade-duration": 0 } }] };
  const { Map } = await import("maplibre-gl");
  signal.throwIfAborted();
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-10000px;top:0;width:1024px;height:1024px;pointer-events:none;";
  document.body.append(container);
  let capture: MapLibreMap | undefined;
  try {
    capture = new Map({ container, bounds, fitBoundsOptions: { padding: 0, maxZoom: 19, duration: 0 }, style, interactive: false, attributionControl: false, pixelRatio: 1, canvasContextAttributes: { preserveDrawingBuffer: true }, renderWorldCopies: false, maxPitch: 0 });
    const map = capture;
    return await new Promise<SamImage>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); map.off("idle", idle); map.off("error", error); };
      const abort = () => { cleanup(); reject(Error("Satellite capture cancelled.")); };
      const error = () => { cleanup(); reject(Error("Satellite capture failed to load all tiles. No analysis request was sent.")); };
      const idle = () => {
        if (!map.areTilesLoaded()) return;
        try {
          const topLeft = map.project([bounds[0][0], bounds[1][1]]), bottomRight = map.project([bounds[1][0], bounds[0][1]]);
          const left = Math.max(0, Math.floor(topLeft.x)), top = Math.max(0, Math.floor(topLeft.y));
          const right = Math.min(1024, Math.ceil(bottomRight.x)), bottom = Math.min(1024, Math.ceil(bottomRight.y));
          const width = right - left, height = bottom - top;
          if (width < 8 || height < 8) { cleanup(); reject(Error("Selected polygon is too small. Draw a larger area.")); return; }
          const image = document.createElement("canvas"); image.width = width; image.height = height;
          const context = image.getContext("2d");
          if (!context) throw Error("Image capture is unavailable.");
          context.beginPath();
          area.coordinates[0]!.forEach((point, i) => { const p = map.project([point[0]!, point[1]!]); if (i === 0) context.moveTo(p.x - left, p.y - top); else context.lineTo(p.x - left, p.y - top); });
          context.closePath(); context.clip(); context.drawImage(map.getCanvas(), -left, -top);
          const corners = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => { const p = map.unproject([x!, y!]); return [p.lng, p.lat]; }) as MapCorners;
          const imageDataUrl = image.toDataURL("image/png");
          cleanup(); resolve({ imageDataUrl, width, height, corners, source, area });
        } catch { error(); }
      };
      const timer = setTimeout(() => { cleanup(); reject(Error("Satellite capture timed out. No analysis request was sent.")); }, 30000);
      signal.addEventListener("abort", abort, { once: true });
      map.on("idle", idle); map.on("error", error);
      if (signal.aborted) abort();
    });
  } finally { capture?.remove(); container.remove(); }
}
