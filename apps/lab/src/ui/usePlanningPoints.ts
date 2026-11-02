import { useEffect, useRef, useState } from "react";
import type { Polygon } from "geojson";
import type { CrownImage, CrownMatchResult } from "../geo/templateMatch";
import { samePolygon } from "../geo/samArea";
import { imagePixelToLngLat, lngLatToImagePixel, type SamResult } from "../geo/sam";
import type { CanopyClip } from "../geo/canopy";
import { alignedCanopyHeights, samCoverageMask, samOutputPredicate, type TreeGuidanceSummary } from "../geo/treeGuidance";
import type { DenseCrownOutput, DenseCrownSeed } from "../geo/denseCrowns";
import { inPlanningArea, metricFrame, PLANNING_POINT_LIMIT, planningFromCrowns, planningLocationError, type LngLat, type PlanningPoint, type PlanningPoints, type PlanningRoutes } from "../geo/planningPoints";
export type PlanningEditMode = "view" | "add" | "move" | "delete" | "home" | "exclude";
export function usePlanningPoints(mapId: string, area: Polygon | null, sam: SamResult | null = null) {
  const [set, setSet] = useState<PlanningPoints | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(`lab.planningPoints.${mapId}`) ?? "null") as PlanningPoints | null;
      if (!value || value.version !== 1 || value.mapId !== mapId || !Array.isArray(value.points) || value.points.length > PLANNING_POINT_LIMIT || value.area?.type !== "Polygon" || !Array.isArray(value.home) || !value.home.every(Number.isFinite) || value.home.length !== 2 || !value.points.every((p) => typeof p.id === "string" && /^P\d+$/.test(p.id) && Array.isArray(p.coordinate) && p.coordinate.length === 2 && p.coordinate.every(Number.isFinite)) || !Number.isFinite(value.minSpacingM)) return null;
      return value;
    } catch { return null; }
  });
  const [treeSpacing, setTreeSpacing] = useState(set?.generationSettings?.spacingM ?? set?.coverage?.spacingM ?? 8), [sensitivity, setSensitivity] = useState(set?.generationSettings?.sensitivity ?? set?.coverage?.sensitivity ?? .6), [coverShown, setCoverShown] = useState(false);
  const [useChmv2, setUseChmv2] = useState(set?.generationSettings?.guidance?.useChmv2 ?? true);
  const [minimumHeightM, setMinimumHeightM] = useState(set?.generationSettings?.guidance?.minimumHeightM ?? 3);
  const [samPreference, setUseSam] = useState<boolean | null>(set?.generationSettings?.guidance?.useSam ?? null);
  const samReady = !!sam && sam.model === "sam-3.1" && (sam.mapId ?? "upm") === mapId && sam.objects > 0 && sam.regions.features.length > 0;
  const useSam = samPreference ?? samReady;
  const guidanceKey = JSON.stringify([useChmv2, minimumHeightM, useSam, useSam ? [sam?.imageSha256, sam?.receivedAt, sam?.runLog?.id] : null]);
  const [coveragePhase, setCoveragePhase] = useState("");
  const denseWorker = useRef<Worker | null>(null), denseController = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<PlanningEditMode>("view"), [shown, setShown] = useState(true), [labels, setLabels] = useState(false);
  const [spacing, setSpacing] = useState(4), [threshold, setThreshold] = useState(0.6);
  const [routes, setRoutes] = useState<PlanningRoutes | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [showA, setShowA] = useState(false), [showB, setShowB] = useState(true);
  const [undoStack, setUndoStack] = useState<(PlanningPoints | null)[]>([]);
  const worker = useRef<Worker | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stale = !!set && !samePolygon(set.area, area);
  const cancelRoute = () => { worker.current?.terminate(); worker.current = null; if (timer.current) clearTimeout(timer.current); setBusy(false); };
  useEffect(() => () => { worker.current?.terminate(); denseController.current?.abort(); denseWorker.current?.terminate(); if (timer.current) clearTimeout(timer.current); }, []);
  const areaKey = JSON.stringify(area);
  useEffect(() => { setMode("view"); denseController.current?.abort(); }, [areaKey]);
  useEffect(() => { denseController.current?.abort(); }, [guidanceKey]);
  const commit = (next: PlanningPoints | null, undo = true) => {
    cancelRoute(); setRoutes(null); setError("");
    if (next?.coverage && next.coverage === set?.coverage && next.points !== set.points) next = { ...next, coverage: { ...next.coverage, needsRefresh: true, estimatedCount: next.points.filter((p) => p.source === "canopy-estimate").length, retainedCount: next.points.filter((p) => p.source !== "canopy-estimate").length } };
    if (undo) setUndoStack((stack) => [...stack, set].slice(-30));
    setSet(next);
    try { if (next) localStorage.setItem(`lab.planningPoints.${mapId}`, JSON.stringify(next)); else localStorage.removeItem(`lab.planningPoints.${mapId}`); }
    catch { setError("Point edits work in this session, but storage failed. Download the points before closing."); }
  };
  const load = (result: CrownMatchResult) => {
    try { if (result.mapId !== mapId || !samePolygon(result.image.area, area)) throw Error("Load crown matches for the current finished polygon first."); commit(planningFromCrowns(result, spacing, threshold)); setShown(true); setMode("view"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create planning points."); }
  };
  const cover = async (getImage: (signal: AbortSignal) => Promise<CrownImage>, matches: CrownMatchResult | null) => {
    if (!area || denseController.current || busy) return;
    if (!Number.isFinite(treeSpacing) || treeSpacing < 2 || treeSpacing > 50) { setError("Choose estimated tree spacing from 2–50 m."); return; }
    if (useSam && !samReady) { setError("Load a nonempty SAM 3.1 output for this map, or explicitly disable the SAM constraint."); return false; }
    if (useChmv2 && (!Number.isFinite(minimumHeightM) || minimumHeightM < 0 || minimumHeightM > 254)) { setError("Choose a CHMv2 minimum height from 0–254 m."); return false; }
    const selectedSam = useSam && samReady ? sam : null;
    const controller = new AbortController(); denseController.current = controller; setMode("view"); setError(""); setCoveragePhase("Capturing original tree area…");
    try {
      const image = await getImage(controller.signal); controller.signal.throwIfAborted();
      if (!samePolygon(image.area, area) || (image.source !== "esri" && image.source !== "earth-engine")) throw Error("Load original imagery for the current polygon first.");
      if ("earthEngine" in image && (image.earthEngine?.nativeResolutionM ?? 0) >= 10) throw Error("This image is too coarse to estimate individual tree positions. Use a higher-resolution original capture.");
      const project = metricFrame(area), a = project(imagePixelToLngLat(image, 0, image.height / 2)), b = project(imagePixelToLngLat(image, image.width, image.height / 2)), metresPerPixel = Math.hypot(a.x - b.x, a.y - b.y) / image.width;
      let chmv2: CanopyClip | null = null;
      if (useChmv2) {
        setCoveragePhase("Loading numeric CHMv2 heights for the coverage area…");
        const response = await fetch("/api/canopy/window", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ area, numeric: true }), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw Error(data.error ?? "CHMv2 numeric height loading failed.");
        if (data.dataset !== "Meta/WRI CHMv2" || data.version !== 1 || !samePolygon(data.area, area) || !data.heightData) throw Error("CHMv2 numeric data does not match the coverage polygon. No RGB-only fallback was applied.");
        chmv2 = data;
      }
      const heightMetres = chmv2 ? alignedCanopyHeights(image, chmv2) : undefined;
      const samMask = selectedSam ? samCoverageMask(image, selectedSam.regions) : undefined;
      const insideSam = selectedSam ? samOutputPredicate(selectedSam.regions) : null;
      if (samMask && !samMask.some((value) => value === 1)) throw Error("The loaded SAM output polygons do not overlap this coverage area. Load the appropriate SAM result or disable that constraint.");
      const bitmap = await createImageBitmap(await (await fetch(image.imageDataUrl, { signal: controller.signal })).blob());
      let rgba: Uint8ClampedArray;
      const exclusions = set && !stale ? set.exclusions ?? [] : [];
      try {
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext("2d"); if (!ctx) throw Error("Image processing is unavailable.");
        ctx.drawImage(bitmap, 0, 0); ctx.globalCompositeOperation = "destination-out";
        for (const exclusion of exclusions) { ctx.beginPath(); exclusion.coordinates[0]!.forEach((point, i) => { const [x, y] = lngLatToImagePixel(image, point as LngLat); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill(); }
        rgba = ctx.getImageData(0, 0, image.width, image.height).data;
      } finally { bitmap.close(); }
      const existing = set && !stale ? set.points.filter((p) => p.source !== "canopy-estimate") : [];
      const sourcePoints: PlanningPoint[] = existing.length ? existing : matches && samePolygon(matches.image.area, area) ? matches.matches.map((hit, i) => ({ id: `P${i + 1}`, coordinate: imagePixelToLngLat(matches.image, hit.x + hit.width / 2, hit.y + hit.height / 2), source: "crown-match" as const, similarity: hit.score })) : [];
      const seeds: DenseCrownSeed[] = sourcePoints.flatMap((p, index) => { if (insideSam && !insideSam(p.coordinate)) return []; const [x, y] = lngLatToImagePixel(image, p.coordinate); return [{ x, y, index, manual: p.source === "manual" || !!p.edited }]; });
      controller.signal.throwIfAborted(); setCoveragePhase("Estimating points with the enabled RGB, CHMv2 and SAM constraints…");
      const output = await new Promise<DenseCrownOutput>((resolve, reject) => {
        const current = new Worker(new URL("./denseCrowns.worker.ts", import.meta.url), { type: "module" }); denseWorker.current = current;
        const finish = () => { clearTimeout(timeout); controller.signal.removeEventListener("abort", abort); current.terminate(); if (denseWorker.current === current) denseWorker.current = null; };
        const abort = () => { finish(); reject(Error("Dense coverage cancelled. Previous points are retained.")); };
        const timeout = setTimeout(() => { finish(); reject(Error("Dense coverage timed out. Use a smaller capture.")); }, 60000);
        controller.signal.addEventListener("abort", abort, { once: true });
        current.onmessage = (event: MessageEvent<{ output?: DenseCrownOutput; error?: string }>) => { finish(); if (event.data.output) resolve(event.data.output); else reject(Error(event.data.error ?? "Coverage failed.")); };
        current.onerror = () => { finish(); reject(Error("Dense coverage worker failed.")); };
        const transfer: Transferable[] = [rgba.buffer]; if (heightMetres) transfer.push(heightMetres.buffer); if (samMask) transfer.push(samMask.buffer);
        current.postMessage({ width: image.width, height: image.height, rgba, spacingPx: treeSpacing / metresPerPixel, sensitivity, seeds, limit: PLANNING_POINT_LIMIT, heightMetres, minimumHeightM, samMask }, transfer);
      });
      controller.signal.throwIfAborted();
      const points = output.points.map((p) => {
        const seed = p.seedIndex !== undefined ? sourcePoints[p.seedIndex]! : null;
        const { canopyHeightM: _oldHeight, ...base } = seed ?? { id: "", coordinate: imagePixelToLngLat(image, p.x, p.y), source: "canopy-estimate" as const }; void _oldHeight;
        return { ...base, ...(p.canopyHeightM !== undefined ? { canopyHeightM: p.canopyHeightM } : {}) };
      }).filter((p) => inPlanningArea(area, p.coordinate) && !exclusions.some((exclusion) => inPlanningArea(exclusion, p.coordinate)) && (!insideSam || insideSam(p.coordinate)));
      if (!points.length) throw Error("No points remain inside the enabled guidance constraints. Previous points were retained.");
      const guidance: TreeGuidanceSummary = {
        ...(chmv2 ? { chmv2: { clipId: chmv2.id, minimumHeightM, sourceDate: chmv2.sourceDate, fetchedAt: chmv2.fetchedAt, resolutionMapM: chmv2.resolutionMapM, missingPixels: output.guidance.heightMissingPixels, belowHeightPixels: output.guidance.belowHeightPixels, supportedPixels: output.guidance.heightSupportedPixels } } : {}),
        ...(selectedSam ? { sam: { imageSha256: selectedSam.imageSha256, receivedAt: selectedSam.receivedAt, objects: selectedSam.objects, prompt: selectedSam.prompt, excludedPixels: output.guidance.samExcludedPixels, ...(selectedSam.runLog ? { runId: selectedSam.runLog.id } : {}) } } : {}),
      };
      points.sort((a, b) => b.coordinate[1] - a.coordinate[1] || a.coordinate[0] - b.coordinate[0]); points.forEach((p, i) => { p.id = `P${String(i + 1).padStart(3, "0")}`; });
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext("2d")!; const pixels = ctx.createImageData(image.width, image.height);
      for (let i = 0; i < output.mask.length; i++) if (output.mask[i]) pixels.data.set([0, 255, 130, 100], i * 4); ctx.putImageData(pixels, 0, 0);
      commit({ version: 1, mapId, area, points, home: set && !stale && set.points.length ? set.home : points[0]!.coordinate, minSpacingM: output.minSpacingPx * metresPerPixel, createdAt: new Date().toISOString(), sourceResultAt: matches?.receivedAt ?? "", exclusions, generationSettings: { spacingM: treeSpacing, sensitivity, guidance: { useChmv2, useSam, minimumHeightM } },
        coverage: { method: useChmv2 || useSam ? "rgb-chmv2-sam-spaced-estimate-v1" : "rgb-texture-spaced-estimate-v1", guidance, spacingM: treeSpacing, sensitivity, eligiblePixels: output.eligiblePixels, coveredPixels: output.coveredPixels, retainedCount: points.filter((p) => p.source !== "canopy-estimate").length, estimatedCount: points.filter((p) => p.source === "canopy-estimate").length, maskDataUrl: canvas.toDataURL("image/png"), corners: image.corners } });
      setShown(true); setCoverShown(false); return true;
    } catch (e) { if (denseController.current === controller) setError(e instanceof Error ? e.message : "Dense coverage failed."); return false; }
    finally { if (denseController.current === controller) { denseController.current = null; setCoveragePhase(""); } }
  };
  const cancelCoverage = () => denseController.current?.abort();
  const exclude = (polygon: Polygon) => { if (set && !stale) commit({ ...set, exclusions: [...(set.exclusions ?? []), polygon], points: set.points.filter((p) => !inPlanningArea(polygon, p.coordinate)), coverage: undefined }); };
  const startManual = () => {
    if (!area) return;
    if (!Number.isFinite(spacing) || spacing < 0.5 || spacing > 50) { setError("Choose cleanup spacing from 0.5–50 m."); return; }
    if (!set || stale) commit({ version: 1, mapId, area, points: [], home: area.coordinates[0]![0]! as LngLat, minSpacingM: spacing, createdAt: new Date().toISOString(), sourceResultAt: "" });
    setShown(true); setMode("add");
  };
  const add = (coordinate: LngLat) => {
    if (!set || stale) return;
    if (set.points.length >= PLANNING_POINT_LIMIT) { setError("Limit: 5000 planning points. Use a smaller area."); return; }
    const issue = planningLocationError(set, coordinate); if (issue) { setError(issue); return; }
    const maxId = Math.max(0, ...set.points.map((p) => Number(p.id.slice(1))));
    commit({ ...set, points: [...set.points, { id: `P${String(maxId + 1).padStart(3, "0")}`, coordinate, source: "manual" }], home: set.points.length ? set.home : coordinate });
  };
  const move = (id: string, coordinate: LngLat) => {
    if (!set || stale) return;
    const issue = planningLocationError(set, coordinate, id); if (issue) { setError(issue); return; }
    commit({ ...set, points: set.points.map((p) => { if (p.id !== id) return p; const { canopyHeightM: _oldHeight, ...base } = p; void _oldHeight; return { ...base, coordinate, edited: true }; }) });
  };
  const remove = (id: string) => { if (set && !stale) commit({ ...set, points: set.points.filter((p) => p.id !== id) }); };
  const setHome = (coordinate: LngLat) => { if (set && !stale) { commit({ ...set, home: coordinate }); setMode("view"); } };
  const undo = () => { if (!undoStack.length) return; const previous = undoStack.at(-1)!; setUndoStack((stack) => stack.slice(0, -1)); commit(previous, false); };
  const compare = () => {
    if (!set || busy || coveragePhase || set.points.length < 2) return;
    cancelRoute(); setMode("view"); setError(""); setBusy(true); setRoutes(null);
    const current = new Worker(new URL("./planningRoutes.worker.ts", import.meta.url), { type: "module" }); worker.current = current;
    const finish = () => { current.terminate(); if (timer.current) clearTimeout(timer.current); if (worker.current === current) { worker.current = null; setBusy(false); } };
    current.onmessage = (event: MessageEvent<{ routes?: PlanningRoutes; error?: string }>) => { if (worker.current !== current) return; finish(); if (event.data.routes) setRoutes(event.data.routes); else setError(event.data.error ?? "Route calculation failed."); };
    current.onerror = () => { finish(); setError("Route calculation failed. Try fewer points."); };
    timer.current = setTimeout(() => { finish(); setError("Route comparison exceeded 30 seconds. Use fewer points."); }, 30000);
    current.postMessage(set);
  };
  return { useChmv2, setUseChmv2, useSam, setUseSam, samReady, minimumHeightM, setMinimumHeightM, cover, cancelCoverage, coveragePhase, treeSpacing, setTreeSpacing, sensitivity, setSensitivity, coverShown, setCoverShown, exclude, set, stale, mode, setMode, shown, setShown, labels, setLabels, spacing, setSpacing, threshold, setThreshold, load, startManual, add, move, remove, setHome, undo, canUndo: !!undoStack.length, compare, routes, showA, setShowA, showB, setShowB, busy: busy || !!coveragePhase, error, cancelRoute };
}
export type PlanningController = ReturnType<typeof usePlanningPoints>;
