import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { assertPlanningClusters, clusterLimits, clusterMethod, clusterSourceKey, DEFAULT_CLUSTER_SETTINGS, type ClusterSettings, type PlanningClusters } from "../geo/planningClusters";
import type { PlanningPoints } from "../geo/planningPoints";
import { sampleCanopyHeights } from "../geo/treeGuidance";
import type { CanopyClip } from "../geo/canopy";
import type { RoadReference } from "../geo/roadReference";

export function usePlanningClusters(mapId: string, points: PlanningPoints | null, road: RoadReference | null = null) {
  const [saved] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(`lab.planningClusters.${mapId}`) ?? "null");
      if (!value || value.version !== 1) return null;
      clusterLimits(value.settings);
      return value as { version: 1; settings: ClusterSettings; result: PlanningClusters | null; shown: boolean; labels: boolean };
    } catch { return null; }
  });
  const [settings, setSettings] = useState<ClusterSettings>(saved?.settings ?? DEFAULT_CLUSTER_SETTINGS);
  const [storedResult, setResult] = useState<PlanningClusters | null>(saved?.result ?? null);
  const [shown, setShown] = useState(saved?.shown ?? true), [labels, setLabels] = useState(saved?.labels ?? true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [storageError, setStorageError] = useState("");
  const key = useMemo(() => points ? clusterSourceKey(points) : "", [points]);
  const latestKey = useRef(key);
  useLayoutEffect(() => { latestKey.current = key; }, [key]);
  const job = useRef<{ worker?: Worker; abort?: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const result = useMemo(() => {
    if (!points || !storedResult) return null;
    try { assertPlanningClusters(points, storedResult); return storedResult; } catch { return null; }
  }, [points, storedResult]);
  const stop = () => { if (job.current) { job.current.worker?.terminate(); job.current.abort?.abort(); clearTimeout(job.current.timer); job.current = null; } };
  const cancel = () => { stop(); setBusy(false); };
  // Cancel any running job only when the point set changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cancel(); return stop; }, [key]);
  useEffect(() => {
    try { localStorage.setItem(`lab.planningClusters.${mapId}`, JSON.stringify({ version: 1, settings, result: storedResult, shown, labels })); setStorageError(""); }
    catch { setStorageError("Clusters work in this session, but could not be saved. Download GeoJSON before closing."); }
  }, [mapId, settings, storedResult, shown, labels]);
  const generate = () => {
    if (!points || job.current) return;
    setError("");
    try { clusterLimits(settings); } catch (e) { setError(e instanceof Error ? e.message : "Clustering could not start."); return; }
    const run = (heights?: Record<string, number>) => {
      let worker: Worker;
      try { worker = new Worker(new URL("./planningClusters.worker.ts", import.meta.url), { type: "module" }); }
      catch (e) { setBusy(false); setError(e instanceof Error ? e.message : "Clustering could not start."); return; }
      const fail = (text: string) => { cancel(); setError(text); };
      stop();
      job.current = { worker, timer: setTimeout(() => fail("Clustering took too long. The previous result is kept; try again with larger groups."), 30000) };
      worker.onmessage = (event: MessageEvent<{ result?: PlanningClusters; error?: string }>) => {
        if (job.current?.worker !== worker || latestKey.current !== key) return;
        cancel();
        try { if (!event.data.result) throw Error(event.data.error ?? "Clustering failed."); assertPlanningClusters(points, event.data.result); setResult(event.data.result); setShown(true); }
        catch (e) { setError(e instanceof Error ? e.message : "Invalid clustering result."); }
      };
      worker.onerror = () => { if (job.current?.worker === worker) fail("Clustering failed. The previous result is kept."); };
      worker.postMessage({ set: points, settings, heights, road: road ?? undefined });
    };
    setBusy(true);
    if (clusterMethod(settings) !== "elevation") { run(); return; }
    // Elevation: read CHMv2 at every point's own lng/lat. Nothing stored on the point or borrowed from a neighbour is used.
    const abort = new AbortController();
    const fail = (text: string) => { cancel(); setError(text); };
    job.current = { abort, timer: setTimeout(() => fail("Loading CHMv2 heights took too long. The previous result is kept; try again."), 30000) };
    (async () => {
      const response = await fetch("/api/canopy/window", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ area: points.area, numeric: true }), signal: abort.signal });
      const data = await response.json() as CanopyClip & { error?: string };
      if (!response.ok) throw Error(data.error ?? "CHMv2 numeric height loading failed.");
      if (data.dataset !== "Meta/WRI CHMv2" || data.version !== 1 || !data.heightData) throw Error("CHMv2 numeric heights are unavailable for this area, so elevation grouping was not run.");
      if (job.current?.abort !== abort || latestKey.current !== key) return;
      const sampled = sampleCanopyHeights(data, points.points.map(p => p.coordinate));
      const heights: Record<string, number> = {};
      points.points.forEach((p, i) => { if (sampled[i] !== null) heights[p.id] = sampled[i]!; });
      run(heights);
    })().catch(e => { if (abort.signal.aborted || job.current?.abort !== abort) return; fail(e instanceof Error ? e.message : "CHMv2 heights could not be loaded."); });
  };
  const roadChanged = !!result?.road && !!road && result.road.key !== road.key;
  return { settings, setSettings, result, roadChanged, stale: !!storedResult && !result, shown, setShown, labels, setLabels, busy, error, storageError, generate, cancel };
}
export type PlanningClustersController = ReturnType<typeof usePlanningClusters>;
