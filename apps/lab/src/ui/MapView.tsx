import { useMemo, useState } from "react";
import type { FeatureCollection, LineString } from "geojson";
import { HOME_WGS84, PEAKS, RASTER, routeRun } from "../geo/layer";
import type { Item } from "../domain/types";
import { fmtNum, plural } from "./format";
import { slotLetter } from "./snapshotScope";
import { SatelliteMap } from "./SatelliteMap";

const HEIGHT_STEPS = ["#f6c7bc", "#ee9a86", "#e2583c", "#b92d16", "#6b0f06"];
const SPECTRUM_STOPS = [
  [110, 64, 170], [63, 99, 233], [29, 174, 227], [40, 199, 133],
  [158, 211, 78], [249, 211, 59], [248, 138, 43], [223, 54, 47],
] as const;
const SPECTRUM_GRADIENT = `linear-gradient(90deg, ${SPECTRUM_STOPS.map((rgb) => `rgb(${rgb.join(", ")})`).join(", ")})`;
const isVisibleCanopyHeight = (height: number | null): height is number => height !== null && Number.isFinite(height) && height > 0;
const CANOPY_RANGE = RASTER.values.reduce((range, height) => {
  if (isVisibleCanopyHeight(height)) {
    range.min = Math.min(range.min, height);
    range.max = Math.max(range.max, height);
  }
  return range;
}, { min: Infinity, max: -Infinity });

/** Scale the spectrum to the visible local canopy, excluding empty ground. */
function canopyColor(height: number): number[] {
  const normalized = Math.max(0, Math.min(1, (height - CANOPY_RANGE.min) / (CANOPY_RANGE.max - CANOPY_RANGE.min || 1)));
  const position = normalized * (SPECTRUM_STOPS.length - 1);
  const lower = Math.floor(position);
  const start = SPECTRUM_STOPS[lower]!;
  const end = SPECTRUM_STOPS[Math.min(lower + 1, SPECTRUM_STOPS.length - 1)]!;
  return start.map((channel, i) => Math.round(channel + (end[i]! - channel) * (position - lower)));
}

const heights = PEAKS.map((p) => p.h);
const H_MIN = Math.min(...heights);
const H_MAX = Math.max(...heights);
const stepOf = (h: number) => Math.min(HEIGHT_STEPS.length - 1, Math.floor(((h - H_MIN) / (H_MAX - H_MIN || 1)) * HEIGHT_STEPS.length));

/** Keep empty ground and missing data transparent over the satellite basemap. */
function rasterUrl(): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = RASTER.width;
  canvas.height = RASTER.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(RASTER.width, RASTER.height);
  RASTER.values.forEach((v, i) => {
    if (!isVisibleCanopyHeight(v)) return;
    img.data.set([...canopyColor(v), 255], i * 4);
  });
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

interface Props {
  snapshots: Item[];
  shown: boolean[];
  focusRequest: number;
  onToggle(index: number): void;
}

export function MapView({ snapshots, shown, focusRequest, onToggle }: Props) {
  const url = useMemo(rasterUrl, []);
  const [canopyShown, setCanopyShown] = useState(true);
  const [canopyOpacity, setCanopyOpacity] = useState(35);
  const peakColors = useMemo(() => PEAKS.map((p) => HEIGHT_STEPS[stepOf(p.h)]!), []);

  const compared = snapshots.slice(0, 2);
  const routes = compared.map((s, i) => {
    const algo = s.snapshot?.route ?? null;
    if (!algo) return null;
    const run = routeRun(algo);
    const coordinates = [HOME_WGS84, ...run.order.map((k) => PEAKS[k]!.lonLat), HOME_WGS84];
    return { index: i, id: s.id, coordinates, run };
  });
  const routeData: FeatureCollection<LineString> = {
    type: "FeatureCollection",
    features: routes.flatMap((r, i) => r && shown[i] ? [{ type: "Feature", properties: { slot: i }, geometry: { type: "LineString", coordinates: r.coordinates } }] : []),
  };

  return (
    <section className="map-view" aria-label="Map">
      <div className="map-frame">
        <SatelliteMap canopyUrl={url} canopyOpacity={canopyShown ? canopyOpacity / 100 : 0} routes={routeData} peakColors={peakColors} focusRequest={focusRequest} />

        <div className="legend" aria-label="Map legend">
          <h3>UPM, Selangor <span className="badge plain">Study area</span></h3>
          <hr />
          <h3>Google satellite <span className="badge plain">Basemap</span></h3>
          <hr />
          <h3>
            CHMv2 canopy height <span className="badge plain">Saved layer</span>
          </h3>
          <label className="legend-route"><input type="checkbox" checked={canopyShown} onChange={(e) => setCanopyShown(e.target.checked)} />Show canopy layer</label>
          <label className="canopy-opacity">Opacity <input type="range" min="0" max="100" step="5" value={canopyOpacity} disabled={!canopyShown} onChange={(e) => setCanopyOpacity(Number(e.target.value))} /><span>{canopyOpacity}%</span></label>
          <div className="ramp spectrum" style={{ background: SPECTRUM_GRADIENT }} aria-label={`CHMv2 spectrum from local minimum ${CANOPY_RANGE.min} m to local maximum ${CANOPY_RANGE.max} m`} />
          <div className="ramp-labels">
            <span title="Local minimum">{CANOPY_RANGE.min} m</span>
            <span>local height range</span>
            <span title="Local maximum">{CANOPY_RANGE.max} m</span>
          </div>
          <p className="hint">Predicted metres above ground</p>
          <h3>
            Crown peaks <span className="badge outline">Candidate (not trees)</span>
          </h3>
          <div className="ramp steps">
            {HEIGHT_STEPS.map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </div>
          <div className="ramp-labels">
            <span>{H_MIN} m</span>
            <span>peak height</span>
            <span>{H_MAX} m</span>
          </div>
          <hr />
          {compared.length === 0 && <p className="hint">No snapshots registered, so no routes are drawn.</p>}
          {compared.map((s, i) => (
            <label key={s.id} className="legend-route">
              <input type="checkbox" checked={shown[i] ?? true} disabled={!s.snapshot?.route} onChange={() => onToggle(i)} />
              <svg width="38" height="8" aria-hidden="true">
                <line x1="0" x2="38" y1="4" y2="4" className={`route route-${i === 0 ? "a" : "b"} swatch`} />
              </svg>
              Snapshot {slotLetter(i)} route{!s.snapshot?.route && <span className="hint"> (no route unit)</span>}
            </label>
          ))}
        </div>
      </div>
      <div className="map-caption">
        <span className="badge outline">Simulated ordering, not flight-validated</span>
        <span>
          Peaks are local maxima of the saved CHMv2 layer ({RASTER.sourceDate}). Route lengths are ground metres (UTM zone 47N), closed tours from home
          {routes.some(Boolean) && (
            <>
              : {routes.filter(Boolean).map((r) => `${slotLetter(r!.index)} ${fmtNum(r!.run.metrics.pathLengthM, 0)} m`).join(", ")}
            </>
          )}
          .
        </span>
      </div>
    </section>
  );
}

export const mapSummary = (snapshots: Item[]) =>
  `UPM · Google satellite · CHMv2 layer · ${plural(PEAKS.length, "candidate peak")} · ${plural(snapshots.slice(0, 2).filter((s) => s.snapshot?.route).length, "route overlay")}`;
