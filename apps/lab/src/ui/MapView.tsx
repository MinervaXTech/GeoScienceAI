import { useEffect, useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { FeatureCollection, LineString } from "geojson";
import { HOME_WGS84, PEAKS, RASTER, RASTER_CORNERS, routeRun } from "../geo/layer";
import type { Item, SavedMap } from "../domain/types";
import { UPM_MAP } from "../geo/maps";
import { fmtNum, plural } from "./format";
import { slotLetter } from "./snapshotScope";
import { SatelliteMap } from "./SatelliteMap";
import { BASEMAP_NAMES, type BasemapId, type SatelliteMapHandle } from "../geo/sam";
import { SamPanel } from "./SamPanel";
import { SamOutput } from "./SamOutput";
import type { SamController } from "./useSam";
import type { SamAreaController } from "./useSamArea";
import { useMuse } from "./useMuse";
import { MusePanel } from "./MusePanel";
import { CrownMatchingPanel } from "./CrownMatchingPanel";
import { useCrownMatching } from "./useCrownMatching";
import { crownReviewFeatures } from "../geo/crownReview";
import { crownMatchFeatures } from "../geo/templateMatch";
import { samePolygon } from "../geo/samArea";
import { useMusePyramid } from "./useMusePyramid";
import { useCanopy } from "./useCanopy";
import { CANOPY_GRADIENT } from "../geo/canopy";
import { useEarthEngine } from "./useEarthEngine";
import { usePlanningPoints, type PlanningEditMode } from "./usePlanningPoints";
import { PlanningPointsPanel } from "./PlanningPointsPanel";
import { PlanningClustersPanel } from "./PlanningClustersPanel";
import { usePlanningClusters } from "./usePlanningClusters";
import { roadReference } from "../geo/roadReference";
import { clusterAssignments, clusterFocusArea, planningClusterFeatures } from "../geo/planningClusters";
import { MapTools, type MapToolId } from "./MapTools";
import { useMapAgent } from "./useMapAgent";
import type { AgentModel, MapAgentHandle } from "../geo/mapAgent";
import { planningFeatures } from "../geo/planningPoints";

const UPM_CANOPY_AREA = { type: "Polygon" as const, coordinates: [[...RASTER_CORNERS, RASTER_CORNERS[0]]] };

const HEIGHT_STEPS = ["#f6c7bc", "#ee9a86", "#e2583c", "#b92d16", "#6b0f06"];
const heights = PEAKS.map((p) => p.h);
const H_MIN = Math.min(...heights);
const H_MAX = Math.max(...heights);
const stepOf = (h: number) => Math.min(HEIGHT_STEPS.length - 1, Math.floor(((h - H_MIN) / (H_MAX - H_MIN || 1)) * HEIGHT_STEPS.length));

interface Props {
  savedMap: SavedMap;
  agentRef: RefObject<MapAgentHandle | null>;
  agentModel: AgentModel;
  mapRef: RefObject<SatelliteMapHandle | null>;
  layerHost: HTMLDivElement | null;
  legendHidden: boolean;
  onOpenLayers(): void;
  snapshots: Item[];
  shown: boolean[];
  focusRequest: number;
  basemap: BasemapId;
  onBasemap(value: BasemapId): void;
  sam: SamController;
  samArea: SamAreaController;
  onToggle(index: number): void;
}

export function MapView({ agentRef, agentModel, savedMap, mapRef, layerHost, legendHidden, onOpenLayers, snapshots, shown, focusRequest, basemap, onBasemap, sam, samArea, onToggle }: Props) {
  const isUpm = savedMap.id === "upm";
  const [canopyShown, setCanopyShown] = useState(true);
  const [peaksShown, setPeaksShown] = useState(true);
  const [boundaryShown, setBoundaryShown] = useState(true);
  const [canopyOpacity, setCanopyOpacity] = useState(35);
  const canopyArea = samArea.polygon ?? savedMap.boundary ?? (isUpm ? UPM_CANOPY_AREA : null);
  const canopy = useCanopy(canopyArea, canopyShown && !legendHidden, samArea.drawing);
  const [activeTool, setActiveTool] = useState<MapToolId | null>("planning");
  const muse = useMuse(savedMap.id, savedMap.name, agentModel);
  const earthEngine = useEarthEngine(savedMap.id, samArea.polygon);
  const [chosenMuseSource, setChosenMuseSource] = useState<"esri" | "earth-engine" | null>(null);
  const museInputSource = chosenMuseSource ?? (basemap === "google" ? "earth-engine" : "esri");
  const musePyramid = useMusePyramid(savedMap.id);
  const matching = useCrownMatching(savedMap.id, samArea.polygon, agentModel);
  const [planningScope, setPlanningScope] = useState<"map" | "selection">("map");
  const planningArea = planningScope === "map" ? savedMap.boundary ?? samArea.polygon : samArea.polygon;
  const planning = usePlanningPoints(savedMap.id, planningArea, sam.result);
  const road = useMemo(() => planning.set ? roadReference(planning.set.area, sam.result, savedMap.id) : null, [planning.set, sam.result, savedMap.id]);
  const clusters = usePlanningClusters(savedMap.id, planning.set, road);
  const clusterResult = planning.stale ? null : clusters.result;
  const clusterData = useMemo(() => planningClusterFeatures(clusterResult, road), [clusterResult, road]);
  const planningData = useMemo(() => {
    const data = planningFeatures(planning.set, planning.routes);
    const membership = clusterAssignments(clusters.shown ? clusterResult : null);
    for (const feature of data.features) if (feature.properties?.kind === "planning-point") Object.assign(feature.properties, membership.get(feature.properties.id));
    return data;
  }, [planning.set, planning.routes, clusters.shown, clusterResult]);
  const planningBlocked = legendHidden || sam.busy || samArea.drawing;
  const setPlanningMode = planning.setMode;
  useEffect(() => { if (planningBlocked) setPlanningMode("view"); }, [planningBlocked, setPlanningMode]);
  const editPlanning = (mode: PlanningEditMode) => { planning.setShown(true); planning.setMode(mode); document.querySelector(".satellite-map")?.scrollIntoView({ behavior: "smooth", block: "center" }); };
  const crownData = useMemo(() => {
    const data = crownMatchFeatures(matching.result);
    if (matching.image && matching.areaReview) data.features.push(...crownReviewFeatures(matching.image, matching.areaReview).features);
    return data;
  }, [matching.result, matching.image, matching.areaReview]);
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


  const coverPoints = async () => { if (!planningArea) return; const area = planningArea; return planning.cover(async (signal) => {
        const candidates = [matching.image, muse.result?.input, earthEngine.preview];
        const existing = candidates.find((image) => image && samePolygon(image.area, area));
        if (existing) return existing;
        if (basemap !== "esri") throw Error("Switch to Esri World Imagery or load an original Earth Engine image of the whole map for coverage.");
        if (!mapRef.current) throw Error("Wait for the satellite map to load.");
        return mapRef.current.capture(signal, area);
      }, matching.result).then((done) => { if (done) { matching.setShown(false); matching.setReviewShown(false); mapRef.current?.fitArea(area); document.querySelector(".satellite-map")?.scrollIntoView({ behavior: "smooth", block: "center" }); } }); };
  const runSam = async () => { if (legendHidden) return; setActiveTool("sam"); return sam.run(async (signal) => {
            if (!samArea.polygon || samArea.drawing) throw Error("Finish a polygon before running SAM.");
            if (!mapRef.current) throw Error("Wait for the satellite map to load.");
            return mapRef.current.capture(signal, samArea.polygon);
          }); };
  const runMuse = async () => {
        if (legendHidden || sam.busy || !samArea.polygon || samArea.drawing || earthEngine.phase) return;
        const polygon = samArea.polygon;
        return muse.run(async (signal) => {
          if (museInputSource === "earth-engine") {
            if (!earthEngine.preview || !samePolygon(earthEngine.preview.area, polygon)) throw Error("Preview an Earth Engine image for this polygon first.");
            signal.throwIfAborted(); return earthEngine.preview;
          }
          if (basemap !== "esri") throw Error("Choose Earth Engine input while viewing Google Satellite.");
          if (!mapRef.current) throw Error("Wait for the satellite map to load.");
          const image = await mapRef.current.capture(signal, polygon);
          if (image.source !== "esri") throw Error("The viewing basemap changed during capture. Choose the input source again.");
          return { ...image, source: "esri" };
        }); };
  const captureCrowns = async () => {
        if (legendHidden || sam.busy || !samArea.polygon || samArea.drawing || basemap !== "esri") return;
        const polygon = samArea.polygon;
        return matching.capture(async (signal) => {
          if (!mapRef.current) throw Error("Wait for the satellite map to load.");
          return mapRef.current.capture(signal, polygon);
        }); };
  const loadMuseLayer = async () => { if (muse.result) return musePyramid.useResult(muse.result).then((layer) => {
        if (!layer) return null;
        onOpenLayers();
        mapRef.current?.fitArea(layer.area);
        document.querySelector(".satellite-map")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return layer;
      }); };
  useMapAgent(agentRef, {
    mapId: savedMap.id, mapName: savedMap.name, adding: legendHidden, basemap, model: agentModel, area: samArea, planning, clusters, matching, muse, sam, pyramid: musePyramid, earthEngine, canopy, map: mapRef, planningScope,
    layers: { canopy: canopyShown, boundary: boundaryShown, ...(isUpm ? { peaks: peaksShown } : {}), ...(sam.result ? { sam: sam.shown } : {}), ...(musePyramid.layer ? { muse: musePyramid.shown } : {}), ...(matching.result ? { crowns: matching.shown } : {}), ...(matching.areaReview ? { review: matching.reviewShown } : {}), ...(planning.set ? { points: planning.shown, labels: planning.labels, cover: planning.coverShown } : {}), ...(clusterResult ? { clusters: clusters.shown } : {}), ...(planning.routes ? { route_a: planning.showA, route_b: planning.showB } : {}) },
    setLayer(name, value) { const setters: Record<string, (value: boolean) => void> = { canopy: setCanopyShown, peaks: setPeaksShown, boundary: setBoundaryShown, sam: sam.setShown, muse: musePyramid.setShown, crowns: matching.setShown, review: matching.setReviewShown, points: planning.setShown, labels: planning.setLabels, cover: planning.setCoverShown, clusters: clusters.setShown, route_a: planning.setShowA, route_b: planning.setShowB }; setters[name]?.(value); },
    setOpacity(name, value) { if (name === "canopy") setCanopyOpacity(value); else musePyramid.setOpacity(value); },
    openTool: setActiveTool, onBasemap, setPlanningScope, setMuseSource: setChosenMuseSource, cover: coverPoints, runSam, runMuse, captureCrowns, useMuse: loadMuseLayer,
    async inspect(signal) {
      if (!samArea.polygon || samArea.drawing) throw Error("Finish the selected polygon first.");
      const existing = [matching.image, muse.result?.input, earthEngine.preview].find(image => image && samePolygon(image.area, samArea.polygon));
      if (existing) return existing;
      if (basemap !== "esri") throw Error("Select Esri imagery or preview an Earth Engine image for this polygon. Google imagery is view-only.");
      if (!mapRef.current) throw Error("Wait for the map to load.");
      return mapRef.current.capture(signal, samArea.polygon);
    },
  });

  return (
    <section className={`map-view${activeTool ? "" : " tools-collapsed"}`} aria-label="Map">
      <div className="map-frame">
        <SatelliteMap savedMap={savedMap} boundaryShown={boundaryShown} canopyUrl={canopyShown && !legendHidden ? canopy.clip?.imageDataUrl ?? null : null} canopyCorners={canopy.clip?.corners ?? null} canopyOpacity={canopyShown ? canopyOpacity / 100 : 0} routes={routeData} peakColors={peakColors} peaksShown={isUpm && peaksShown} focusRequest={focusRequest} basemap={basemap} captureRef={mapRef} samResult={sam.result} samShown={sam.shown} musePyramid={musePyramid.layer} musePyramidShown={musePyramid.shown && !legendHidden} musePyramidOpacity={musePyramid.opacity / 100} crownMatches={crownData} crownMatchesShown={matching.shown && !legendHidden} crownReviewShown={matching.reviewShown && !legendHidden} estimatedCover={planning.set?.coverage ?? null} estimatedCoverShown={planning.coverShown && !legendHidden} planningData={planningData} planningShown={planning.shown && !legendHidden} planningLabels={planning.labels} clusterData={clusterData} clustersShown={clusters.shown && !legendHidden && !!clusterResult} clusterLabels={clusters.labels} planningRouteA={planning.showA && !legendHidden} planningRouteB={planning.showB && !legendHidden} planningEditor={{ mode: planningBlocked || planning.stale ? "view" : planning.mode, add: planning.add, move: planning.move, remove: planning.remove, setHome: planning.setHome, exclude: planning.exclude }} samArea={samArea} samBusy={sam.busy} addingMap={legendHidden} />

        {planning.mode !== "view" && !planningBlocked && !planning.stale && <div className="map-planning-tools" role="region" aria-label="Planning point edit tools"><strong>{planning.mode === "add" ? "Click visible crowns to add points" : planning.mode === "move" ? "Drag points to crown centres" : planning.mode === "delete" ? "Click points to delete them" : planning.mode === "exclude" ? "Drag a box over an empty region" : "Click the home / start location"}</strong><div className="sam-actions"><button className="btn small" onClick={() => planning.setMode("view")}>Finish point editing</button><button className="btn small" disabled={!planning.canUndo} onClick={planning.undo}>Undo point edit</button></div>{planning.error && <p className="sam-error">{planning.error}</p>}</div>}
        {layerHost && legendHidden && createPortal(<p className="hint">Finish adding the map to manage its layers. Choose the satellite basemap in the Maps tab.</p>, layerHost)}
        {layerHost && createPortal(<div className="legend" aria-label="Map layers" hidden={legendHidden}>
          <h3><span className="legend-title">{savedMap.name}</span><span className="badge plain">Study area</span></h3>
          <div className="legend-content">
          <hr />
          <label className="basemap-choice">Basemap<select aria-label="Basemap" value={basemap} onChange={(e) => onBasemap(e.target.value as BasemapId)}><option value="esri">Esri World Imagery</option><option value="google">Google satellite</option></select></label>
          {musePyramid.layer && <>
            <hr /><h3>Muse enhancement <span className="badge plain">{musePyramid.layer.method === "generative" ? "GenAI preview" : "Tonal pyramid"}</span></h3>
            <label className="legend-route"><input type="checkbox" checked={musePyramid.shown} onChange={(event) => musePyramid.setShown(event.target.checked)} /><i className="muse-layer-swatch" aria-hidden="true" />Show Muse enhancement</label>
            <label className="canopy-opacity">Opacity <input aria-label="Muse enhancement opacity" type="range" min="0" max="100" step="5" value={musePyramid.opacity} disabled={!musePyramid.shown} onChange={(event) => musePyramid.setOpacity(Number(event.target.value))} /><span>{musePyramid.opacity}%</span></label>
            {musePyramid.layer.method === "generative" && <p className="hint">AI-reconstructed detail; feature positions are unverified.</p>}
          </>}
          <hr />
          <h3>CHMv2 canopy height <span className="badge plain">Polygon clip</span></h3>
          <label className="legend-route"><input type="checkbox" checked={canopyShown} onChange={(event) => setCanopyShown(event.target.checked)} />Show canopy layer</label>
          <label className="canopy-opacity">Opacity <input aria-label="Canopy opacity" type="range" min="0" max="100" step="5" value={canopyOpacity} disabled={!canopyShown} onChange={(event) => setCanopyOpacity(Number(event.target.value))} /><span>{canopyOpacity}%</span></label>
          {canopy.loading && <p className="hint" role="status">Loading CHMv2 for selected polygon…</p>}
          {canopy.error && <p className="sam-error" role="alert">{canopy.error} <button type="button" className="btn small" onClick={canopy.retry}>Retry CHMv2</button></p>}
          {!canopyArea && <p className="hint">Draw and finish a polygon to load CHMv2.</p>}
          {samArea.drawing && <p className="hint">CHMv2 updates after you finish the polygon.</p>}
          {canopy.clip && <>
            {canopy.clip.stats.minimumM !== null && canopy.clip.stats.maximumM !== null ? <>
              <div className="ramp spectrum" style={{ background: CANOPY_GRADIENT }} aria-label={`CHMv2 spectrum from local minimum ${canopy.clip.stats.minimumM} m to local maximum ${canopy.clip.stats.maximumM} m`} />
              <div className="ramp-labels"><span>{canopy.clip.stats.minimumM} m</span><span>{canopy.clip.sampled ? "sampled local range" : "local height range"}</span><span>{canopy.clip.stats.maximumM} m</span></div>
            </> : <p className="hint">{canopy.clip.sources.every((source) => !source.available) ? "No CHMv2 coverage found for this polygon." : "No positive canopy heights in this polygon."}</p>}
            <p className="hint">Predicted metres above ground · {canopy.clip.sourceDate ?? "Historical imagery; observation dates vary"}</p>
            <p className="hint">{canopy.clip.stats.positiveCells.toLocaleString()} positive samples · {canopy.clip.resolutionMapM.toFixed(2)} m map grid{canopy.clip.sampled ? " (overview)" : " (native)"}</p>
            {canopy.clip.stats.missingCells > 0 && <p className="hint">{canopy.clip.stats.missingCells.toLocaleString()} cells have missing data. Missing/zero heights stay transparent.</p>}
            <a className="hint" href="https://registry.opendata.aws/dataforgood-fb-forestsv2/" target="_blank" rel="noreferrer">Meta/WRI CHMv2 · Vantor · CC BY 4.0</a>
          </>}
          {isUpm && <><hr />
          <h3>
            Crown peaks <span className="badge outline">Candidate (not trees)</span>
          </h3>
          <label className="legend-route"><input type="checkbox" checked={peaksShown} onChange={(e) => setPeaksShown(e.target.checked)} />Show crown points</label>
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
          </>}
          {savedMap.boundary && <>
            <hr />
            <h3>Map boundary</h3>
            <label className="legend-route"><input type="checkbox" checked={boundaryShown} onChange={(event) => setBoundaryShown(event.target.checked)} /><i className="boundary-swatch" aria-hidden="true" />Show map boundary</label>
          </>}
          {sam.result && <>
            <hr />
            <h3>SAM 3.1 masks <span className="badge plain">{plural(sam.result.objects, "segment")}</span></h3>
            <label className="legend-route"><input type="checkbox" checked={sam.shown && sam.result.objects > 0} disabled={sam.result.objects === 0} onChange={(event) => sam.setShown(event.target.checked)} /><i className="sam-swatch" aria-hidden="true" />Show SAM masks</label>
            <p className="hint">{sam.result.prompt}</p>
          </>}
          {matching.result && <>
            <hr /><h3>Template crown matches <span className="badge plain">{matching.result.matches.length} candidates</span></h3>
            <label className="legend-route"><input type="checkbox" checked={matching.shown} onChange={(event) => matching.setShown(event.target.checked)} /><i className="crown-match-swatch" aria-hidden="true" />Show crown matches</label>
          </>}
          {planning.set && <><hr /><h3>Planning points <span className="badge plain">{planning.set.points.length} approximate centres</span></h3><label className="legend-route"><input type="checkbox" checked={planning.shown} onChange={(e) => planning.setShown(e.target.checked)} />Show planning centres</label>{planning.routes && <><label className="legend-route"><input type="checkbox" checked={planning.showA} onChange={(e) => planning.setShowA(e.target.checked)} />Planning route A</label><label className="legend-route"><input type="checkbox" checked={planning.showB} onChange={(e) => planning.setShowB(e.target.checked)} />Planning route B</label></>}</>}
          {clusterResult && <><hr /><h3>Planning clusters <span className="badge plain">{clusterResult.clusters.length} groups</span></h3><label className="legend-route"><input type="checkbox" checked={clusters.shown} onChange={e => clusters.setShown(e.target.checked)} />Show planning clusters</label></>}
          {matching.areaReview && <><hr /><h3>Crown area review</h3><label className="legend-route"><input type="checkbox" checked={matching.reviewShown} onChange={(event) => matching.setReviewShown(event.target.checked)} />Show crown area review</label><p className="hint">Orange: unreviewed or missed · Purple: uncertain · Green: accounted for · Grey: genuine gap.</p></>}
          <hr />
          <p className="hint">{savedMap.boundary ? "The cyan outline is the saved map boundary. Use it for SAM or draw a smaller region." : "Draw a cyan polygon to choose the SAM input area."} Results appear in the output panel below.</p>
          </div>
        </div>, layerHost)}
      </div>
      {isUpm && <div className="map-caption">
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
      </div>}
      <MapTools active={activeTool} onChange={setActiveTool} panels={[
        { id: "planning", label: "Planning points", status: planning.busy ? "Working" : planning.set ? `${planning.set.points.length} points` : undefined, content: (
          <PlanningPointsPanel planning={planning} matches={matching.result} scope={planningScope} onScope={setPlanningScope} onCover={() => { void coverPoints(); }} available={!!planningArea && !samArea.drawing} blocked={planningBlocked} onMode={editPlanning} />
        ) },
        { id: "clusters", label: "Clusters", status: clusters.busy ? "Grouping" : clusterResult ? `${clusterResult.clusters.length} clusters` : undefined, content: (
          <PlanningClustersPanel road={road} clusters={{ ...clusters, result: clusterResult, stale: clusters.stale || (planning.stale && !!clusters.result) }} points={planning.set} blocked={planningBlocked || planning.busy || planning.stale || planning.mode !== "view"} onGenerate={() => { planning.setShown(true); clusters.generate(); }} onFocus={cluster => { mapRef.current?.fitArea(clusterFocusArea(cluster)); }} />
        ) },
        { id: "sam", label: "SAM 3.1", status: sam.loadingRunId ? "Loading" : sam.busy ? "Running" : sam.result ? plural(sam.result.objects, "segment") : sam.configured ? "Ready" : "Not configured", content: (
          <section className="sam-workspace" aria-label="SAM 3.1 workspace">
        <div className="sam-section-header">
          <h2>SAM 3.1 <span className="badge plain">{sam.loadingRunId ? "Loading" : sam.busy ? "Running" : sam.configured ? "Ready" : "Not configured"}</span>{sam.result && <span className="badge plain">{sam.result.objects} {sam.result.objects === 1 ? "segment" : "segments"}</span>}</h2>
        </div>
        <div id="sam-workspace-content" className="sam-workspace-content">
          <SamPanel sam={sam} basemap={basemap} area={samArea} addingMap={legendHidden} onDraw={() => { samArea.start(); document.querySelector(".satellite-map")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} onRun={() => { void runSam(); }} />
          <SamOutput sam={sam} onUseResult={(result) => { mapRef.current?.fitOutput(result); document.querySelector(".satellite-map")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} onFit={() => { if (sam.result) { mapRef.current?.fitOutput(sam.result); document.querySelector(".satellite-map")?.scrollIntoView({ behavior: "smooth", block: "center" }); } }} />
        </div>
      </section>
        ) },
        { id: "muse", label: "Muse map agent", status: muse.busy ? "Working" : muse.configured ? "Ready" : "Not configured", content: (
          <MusePanel muse={muse} pyramid={musePyramid} onUse={() => { void loadMuseLayer(); }} basemap={basemap} area={samArea} blocked={legendHidden || sam.busy} engine={earthEngine} inputSource={museInputSource} onInputSource={setChosenMuseSource} onRun={() => { void runMuse(); }} />
        ) },
        { id: "crowns", label: "Crown detection", status: matching.busy ? "Working" : matching.result ? `${matching.result.matches.length} candidates` : undefined, content: (
          <CrownMatchingPanel matching={matching} canCapture={!legendHidden && !sam.busy && basemap === "esri" && !!samArea.polygon && !samArea.drawing} canAgent={!legendHidden && !sam.busy && !samArea.drawing && !!matching.image && samePolygon(matching.image.area, samArea.polygon)} museImage={muse.result && !legendHidden && samePolygon(muse.result.input.area, samArea.polygon) ? muse.result.input : null} earthEngineImage={!legendHidden ? earthEngine.preview : null} onCapture={() => { void captureCrowns(); }} />
        ) },
      ]} />
    </section>
  );
}

export const mapSummary = (snapshots: Item[], basemap: BasemapId = "esri", map: SavedMap = UPM_MAP) =>
  map.id === "upm" ? `UPM · ${BASEMAP_NAMES[basemap]} · CHMv2 layer · ${plural(PEAKS.length, "candidate peak")} · ${plural(snapshots.slice(0, 2).filter((s) => s.snapshot?.route).length, "route overlay")}` : `${map.name} · ${BASEMAP_NAMES[basemap]}`;
