import { useImperativeHandle, useLayoutEffect, useRef, type RefObject } from "react";
import { validateMapAgentCall, type AgentModel, type MapAgentHandle } from "../geo/mapAgent";
import { samePolygon } from "../geo/samArea";
import type { BasemapId, SatelliteMapHandle } from "../geo/sam";
import { planningCsv, planningFeatures, planningFigureSvg } from "../geo/planningPoints";
import type { PlanningController, PlanningEditMode } from "./usePlanningPoints";
import type { CrownMatchingController } from "./useCrownMatching";
import type { MuseController } from "./useMuse";
import type { SamController } from "./useSam";
import type { SamAreaController } from "./useSamArea";
import type { MusePyramidController } from "./useMusePyramid";
import type { EarthEngineController } from "./useEarthEngine";
import type { MapToolId } from "./MapTools";
import type { PlanningClustersController } from "./usePlanningClusters";
interface Input {
  mapId: string; mapName: string; adding: boolean; basemap: BasemapId; model: AgentModel; area: SamAreaController; planning: PlanningController; clusters: PlanningClustersController; matching: CrownMatchingController; muse: MuseController; sam: SamController; pyramid: MusePyramidController; earthEngine: EarthEngineController;
  canopy: { loading: boolean; error: string; clip: { stats: unknown } | null }; map: RefObject<SatelliteMapHandle | null>; planningScope: "map" | "selection";
  layers: Record<string, boolean>; setLayer(name: string, value: boolean): void; setOpacity(name: string, value: number): void;
  openTool(id: MapToolId | null): void; onBasemap(value: BasemapId): void; setPlanningScope(value: "map" | "selection"): void; setMuseSource(value: "esri" | "earth-engine"): void;
  cover(): Promise<unknown>; runSam(): Promise<unknown>; runMuse(): Promise<unknown>; captureCrowns(): Promise<unknown>; inspect(signal: AbortSignal): Promise<unknown>; useMuse(): Promise<unknown>;
}
const tick = () => new Promise<void>(resolve => { const timer = setTimeout(resolve, 100); requestAnimationFrame(() => { clearTimeout(timer); setTimeout(resolve, 0); }); });
export function useMapAgent(ref: RefObject<MapAgentHandle | null>, input: Input) {
  const latest = useRef(input);
  useLayoutEffect(() => { latest.current = input; });
  useImperativeHandle(ref, () => {
    const context = () => {
      const i = latest.current, p = i.planning, c = i.matching;
      return { mapId: i.mapId, mapName: i.mapName, basemap: i.basemap, addingMap: i.adding, polygon: { selected: !!i.area.polygon, drawing: i.area.drawing, editing: i.area.editing, usingDefault: i.area.usingDefault, corners: i.area.polygon ? i.area.polygon.coordinates[0]!.length - 1 : i.area.vertices.length, error: i.area.error, area: i.area.polygon },
        layers: i.layers, canopy: { loading: i.canopy.loading, loaded: !!i.canopy.clip, stats: i.canopy.clip?.stats, error: i.canopy.error },
        planning: { points: p.set?.points.length ?? 0, stale: p.stale, busy: p.busy, error: p.error, scope: i.planningScope, spacingM: p.treeSpacing, sensitivity: p.sensitivity, useChmv2: p.useChmv2, useSam: p.useSam, minimumHeightM: p.minimumHeightM, routes: p.routes ? { A: p.routes.A.lengthM, B: p.routes.B.lengthM } : null },
        clusters: !p.stale && i.clusters.result ? { count: i.clusters.result.clusters.length, totalAssigned: i.clusters.result.clusters.reduce((n, c) => n + c.pointIds.length, 0), unassigned: 0, settings: i.clusters.result.settings, groups: i.clusters.result.clusters.slice(0, 100).map(c => ({ id: c.id, points: c.pointIds.length })) } : null,
        sam: { configured: i.sam.configured, busy: i.sam.busy, prompt: i.sam.prompt, segments: i.sam.result?.objects, error: i.sam.error, runs: i.sam.logs.filter(r => r.mapId === i.mapId).slice(0, 12).map(r => ({ id: r.id, prompt: r.prompt, status: r.status, segments: r.decoding.displayedSegments })) },
        muse: { configured: i.muse.configured, busy: i.muse.busy, objective: i.muse.objective, method: i.muse.method, result: i.muse.result ? { id: i.muse.result.id, status: i.muse.result.status, analysis: i.muse.result.analysis } : null, pyramidLoaded: !!i.pyramid.layer, error: i.muse.error || i.pyramid.error },
        crowns: { busy: c.busy, error: c.error, image: c.image ? { source: c.image.source, width: c.image.width, height: c.image.height, matchesSelection: samePolygon(c.image.area, i.area.polygon) } : null, sample: c.sample, settings: c.settings, candidates: c.result?.matches.length ?? 0, goal: c.agentGoal, rounds: c.agentMaxRounds, templates: c.templateHistory.slice(0, 15).map(t => ({ id: t.id, sample: t.sample, status: t.status, candidates: t.candidates })) },
        earthEngine: { ready: !!i.earthEngine.preview, phase: i.earthEngine.phase, error: i.earthEngine.error } };
    };
    const cancel = () => { const i = latest.current; i.sam.cancel(); i.muse.cancel(); i.matching.cancel(); i.planning.cancelCoverage(); i.planning.cancelRoute(); i.earthEngine.cancel(); i.pyramid.cancel(); };
    return { context, cancel, async execute(raw, signal, model) {
      const { action: a, parameters: p } = validateMapAgentCall(raw); signal.throwIfAborted();
      const i = latest.current, c = i.matching, plan = i.planning;
      if (model !== i.model) throw Error("Wait for the selected Muse model to update.");
      const safe = ["open_tool", "set_layer", "set_opacity", "fit_area", "cancel_operation", "inspect_area"];
      if (!safe.includes(a) && (i.sam.busy || i.muse.busy || c.busy || plan.busy || i.earthEngine.phase)) throw Error("A map operation is still running. Wait or cancel it first.");
      if (i.adding && !["polygon", "open_tool", "cancel_operation"].includes(a)) throw Error("Finish adding the map before changing its analysis layers.");
      const finishedArea = () => { if (!i.area.polygon || i.area.drawing) throw Error("Finish a map polygon first."); };
      const abort = () => cancel(); signal.addEventListener("abort", abort, { once: true });
      let message: unknown = "Applied.";
      const inspectError = async (kind: "planning" | "matching" | "muse" | "sam" | "earthEngine") => { await tick(); signal.throwIfAborted(); const error = latest.current[kind].error; if (error) throw Error(error); };
      try {
        switch (a) {
          case "inspect_area": finishedArea(); return await i.inspect(signal);
          case "open_tool": i.openTool(p.tab === "hide" ? null : p.tab as MapToolId); break;
          case "set_basemap": i.onBasemap(p.value as BasemapId); break;
          case "set_layer": if (!(String(p.layer) in i.layers)) throw Error("That layer has no loaded data on this map."); i.setLayer(String(p.layer), p.shown as boolean); break;
          case "set_opacity": i.setOpacity(String(p.layer), p.value as number); break;
          case "fit_area": finishedArea(); if (!i.map.current) throw Error("Wait for the map to load."); i.map.current.fitArea(i.area.polygon!); break;
          case "polygon": {
            const op = p.operation as "draw" | "edit" | "finish" | "cancel" | "undo" | "clear";
            if (op === "draw") i.area.start(); else i.area[op]();
            await tick(); if (latest.current.area.error) throw Error(latest.current.area.error);
            message = op === "draw" || op === "edit" ? "Waiting for the user to place or drag polygon corners on the map. Right-click to finish." : "Polygon operation applied."; break;
          }
          case "configure_planning":
            if (p.scope !== undefined) i.setPlanningScope(p.scope as "map" | "selection");
            if (p.spacingM !== undefined) plan.setTreeSpacing(p.spacingM as number);
            if (p.sensitivity !== undefined) plan.setSensitivity(p.sensitivity as number);
            if (p.useChmv2 !== undefined) plan.setUseChmv2(p.useChmv2 as boolean);
            if (p.useSam !== undefined) plan.setUseSam(p.useSam as boolean);
            if (p.minimumHeightM !== undefined) plan.setMinimumHeightM(p.minimumHeightM as number); break;
          case "generate_points": finishedArea(); i.openTool("planning"); await i.cover(); await inspectError("planning"); break;
          case "load_matched_points": if (!c.result) throw Error("Run crown matching first."); plan.load(c.result); await inspectError("planning"); break;
          case "edit_points": if (!plan.set || plan.stale) throw Error("Load planning points for this polygon first."); plan.setMode(p.mode as PlanningEditMode); i.openTool("planning"); message = "Point edit mode selected; waiting for manual map interaction."; break;
          case "undo_points": if (!plan.canUndo) throw Error("No point edit to undo."); plan.undo(); break;
          case "compare_routes": {
            if (!plan.set || plan.stale || plan.set.points.length < 2) throw Error("Load at least two current planning points first.");
            const previous = plan.routes; plan.compare(); const start = Date.now();
            do { signal.throwIfAborted(); if (Date.now() - start > 35000) throw Error("Route calculation timed out."); await new Promise(r => setTimeout(r, 50));
            } while (latest.current.planning.busy || (!latest.current.planning.error && (!latest.current.planning.routes || latest.current.planning.routes === previous)));
            await inspectError("planning"); if (!latest.current.planning.routes) throw Error("No route result was produced."); break;
          }
          case "export_planning": {
            if (!plan.set || plan.stale) throw Error("Load current planning points first.");
            if (p.format === "svg" && !plan.routes) throw Error("Compare routes before exporting the figure.");
            const format = p.format as string, text = format === "csv" ? planningCsv(plan.set, plan.routes) : format === "svg" ? planningFigureSvg(plan.set, plan.routes!) : JSON.stringify({ ...planningFeatures(plan.set, plan.routes), planning: { ...plan.set, routes: plan.routes } }, null, 2);
            const url = URL.createObjectURL(new Blob([text], { type: format === "svg" ? "image/svg+xml" : format === "csv" ? "text/csv" : "application/geo+json" })); const link = document.createElement("a"); link.href = url; link.download = `approximate-crown-planning.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); message = "Download requested in the browser."; break;
          }
          case "configure_sam": i.sam.setPrompt(p.prompt as string); break;
          case "run_sam": finishedArea(); if (!i.sam.configured || i.basemap !== "esri") throw Error("SAM needs configured credentials and Esri World Imagery."); i.openTool("sam"); await i.runSam(); await inspectError("sam"); break;
          case "use_sam_run": { const result = await i.sam.selectRun(p.id as string); if (!result) throw Error("Could not load that completed SAM run."); i.map.current?.fitOutput(result); break; }
          case "configure_muse": if (p.objective !== undefined) i.muse.setObjective(p.objective as string); if (p.method !== undefined) i.muse.setMethod(p.method as "generative" | "adjustments"); if (p.source !== undefined) i.setMuseSource(p.source as "esri" | "earth-engine"); break;
          case "run_muse": finishedArea(); if (!i.muse.configured) throw Error("Muse credentials are not configured."); i.openTool("muse"); await i.runMuse(); await inspectError("muse"); break;
          case "use_muse": if (!i.muse.result) throw Error("Run Muse enhancement first."); if (!await i.useMuse()) throw Error("The enhancement could not be loaded."); break;
          case "capture_crowns": finishedArea(); i.openTool("crowns"); if (p.source === "muse") { if (!i.muse.result || !samePolygon(i.muse.result.input.area, i.area.polygon)) throw Error("No Muse original for this polygon."); await c.useImage(i.muse.result.input); } else if (p.source === "earth-engine") { if (!i.earthEngine.preview || !samePolygon(i.earthEngine.preview.area, i.area.polygon)) throw Error("Preview an Earth Engine image for this polygon first."); await c.useImage(i.earthEngine.preview); } else { if (i.basemap !== "esri") throw Error("Choose Esri to capture original imagery."); await i.captureCrowns(); } await inspectError("matching"); break;
          case "configure_crowns":
            c.setSettings({ ...c.settings, ...(p.threshold !== undefined ? { threshold: p.threshold as number } : {}), ...(p.spacing !== undefined ? { spacing: p.spacing as number } : {}), ...(p.multiScale !== undefined ? { multiScale: p.multiScale as boolean } : {}) });
            if (p.goal !== undefined) c.setAgentGoal(p.goal as string); if (p.rounds !== undefined) c.setAgentMaxRounds(p.rounds as number); if (p.diameter !== undefined) c.setReferenceDiameter(p.diameter as number); if (p.tolerance !== undefined) c.setDiameterTolerance(p.tolerance as number); if (p.clearance !== undefined) c.setCircleClearance(p.clearance as number); if (p.keepExisting !== undefined) c.setKeepExisting(p.keepExisting as boolean); break;
          case "select_template": if (!c.image || !samePolygon(c.image.area, i.area.polygon)) throw Error("Capture the current polygon first."); if ((p.x as number) + (p.width as number) > c.image.width || (p.y as number) + (p.height as number) > c.image.height) throw Error("Template extends beyond the original image."); c.setSample(p as unknown as { x: number; y: number; width: number; height: number }); break;
          case "use_template": if (!c.templateHistory.some(t => t.id === p.id && t.captureKey === c.templateCaptureKey)) throw Error("Choose a template from the current capture's history."); c.useTemplate(p.id as string); break;
          case "match_crowns": if (!c.image || !c.sample || !samePolygon(c.image.area, i.area.polygon)) throw Error("Select a whole crown template on the current capture first."); i.openTool("crowns"); await c.run(); await inspectError("matching"); break;
          case "detect_crowns": if (!c.image || !c.agentConfigured || !samePolygon(c.image.area, i.area.polygon)) throw Error("Load an original capture of this polygon before Muse crown detection."); i.openTool("crowns"); await c.runAgent(); await inspectError("matching"); break;
          case "apply_crown_constraints": if (!c.result) throw Error("No crown matches loaded."); c.applyConstraints(); await inspectError("matching"); break;
          case "search_earth_engine": await i.earthEngine.search(); await inspectError("earthEngine"); break;
          case "preview_earth_engine": finishedArea(); await i.earthEngine.capture(); await inspectError("earthEngine"); break;
          case "cancel_operation": cancel(); message = "Cancellation requested; completed results are retained."; break;
          default: throw Error("This action is handled by the map workspace.");
        }
        await tick(); signal.throwIfAborted(); return { message, context: context() };
      } finally { signal.removeEventListener("abort", abort); }
    } };
  }, []);
}
