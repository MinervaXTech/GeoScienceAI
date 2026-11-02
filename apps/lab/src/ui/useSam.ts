import { useEffect, useRef, useState } from "react";
import { DEFAULT_SAM_CONCEPT, type CaptureMap, type SamImage, type SamResult, type SamRunLog } from "../geo/sam";
import { isSamRunLog, mergeSamRunLogs, newSamRunLog, SAM_LOG_LIMIT } from "../geo/samRunLog";

const LOG_KEY = "lab.sam.runLogs";
const SELECTION_KEY = "lab.sam.selectedRuns";
function cachedSelections(): Record<string, string> {
  try { const data = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? "{}"); return data && typeof data === "object" && !Array.isArray(data) ? Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => /^[\w-]{1,100}$/.test(entry[0]) && typeof entry[1] === "string" && /^[\w-]{1,100}$/.test(entry[1]))) : {}; } catch { return {}; }
}
function cachedLogs(): SamRunLog[] {
  try { const data = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]"); return Array.isArray(data) ? data.filter(isSamRunLog).slice(0, SAM_LOG_LIMIT) : []; } catch { return []; }
}

export function useSam(mapId = "upm") {
  const [configured, setConfigured] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_SAM_CONCEPT);
  const [phase, setPhase] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const error = errors[mapId] ?? "";
  const setError = (message: string) => setErrors((saved) => ({ ...saved, [mapId]: message }));
  const [results, setResults] = useState<Record<string, SamResult>>({});
  const [previews, setPreviews] = useState<Record<string, SamImage>>({});
  const result = results[mapId] ?? null;
  const preview = previews[mapId] ?? null;
  const [shown, setShown] = useState(true);
  const pending = useRef<AbortController | null>(null);
  const lastRun = useRef<string | null | undefined>(undefined);
  const [initialSelections] = useState(cachedSelections);
  const selections = useRef(initialSelections);
  const selectionRequest = useRef<AbortController | null>(null);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const saveSelections = () => { try { localStorage.setItem(SELECTION_KEY, JSON.stringify(selections.current)); } catch { /* Full saved results remain available on the server. */ } };
  const [logs, setLogs] = useState<SamRunLog[]>(cachedLogs);
  const addLog = (log: SamRunLog) => setLogs((saved) => mergeSamRunLogs(saved, [log]));
  useEffect(() => { try { localStorage.setItem(LOG_KEY, JSON.stringify(logs)); } catch { /* Server history remains available when browser storage is full. */ } }, [logs]);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const res = await fetch("/api/sam/status", { signal: controller.signal, cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (controller.signal.aborted) return;
        setConfigured(data.configured === true);
        try {
          const response = await fetch("/api/sam/runs", { signal: controller.signal, cache: "no-store" });
          const history = await response.json();
          if (response.ok && Array.isArray(history.runs) && !controller.signal.aborted) setLogs((saved) => mergeSamRunLogs(saved, history.runs.filter(isSamRunLog)));
        } catch { /* Preserve cached logs if the local history endpoint is unavailable. */ }
        if (!pending.current && data.lastRunAt !== lastRun.current) {
          const saved = await fetch("/api/sam/result", { signal: controller.signal, cache: "no-store" });
          const value = await saved.json();
          if (saved.ok && !controller.signal.aborted && !pending.current) {
            if (value.result?.model === "sam-3.1" && !selections.current[value.result.mapId ?? "upm"]) setResults((saved) => ({ ...saved, [value.result.mapId ?? "upm"]: value.result }));
            lastRun.current = data.lastRunAt;
          }
        }
      } catch { /* A failed local status read does not dispatch inference. */ }
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 5000);
    return () => { controller.abort(); clearInterval(interval); pending.current?.abort(); selectionRequest.current?.abort(); };
  }, []);

  useEffect(() => {
    const id = selections.current[mapId];
    if (!id) return;
    const controller = new AbortController();
    const restore = async () => {
      try {
        const response = await fetch(`/api/sam/result?${new URLSearchParams({ runId: id, mapId })}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (controller.signal.aborted || selections.current[mapId] !== id) return;
        if (!response.ok || data.result?.model !== "sam-3.1" || data.result?.runLog?.id !== id || (data.result.mapId ?? "upm") !== mapId) throw Error(data.error ?? "Saved SAM result could not be restored.");
        setResults((saved) => ({ ...saved, [mapId]: data.result })); setPrompt(data.result.prompt); setShown(true);
      } catch (error) {
        if (!controller.signal.aborted && selections.current[mapId] === id) {
          delete selections.current[mapId];
          try { localStorage.setItem(SELECTION_KEY, JSON.stringify(selections.current)); } catch { /* No cached selection is required for inference. */ }
          lastRun.current = undefined;
          setErrors((saved) => ({ ...saved, [mapId]: error instanceof Error ? error.message : "Saved SAM result could not be restored." }));
        }
      }
    };
    void restore();
    return () => controller.abort();
  }, [mapId]);

  const selectRun = async (id: string): Promise<SamResult | null> => {
    if (pending.current || loadingRunId) return null;
    const log = logs.find((entry) => entry.id === id && entry.mapId === mapId);
    if (!log || log.status !== "completed") { setError("Only completed runs have a result to load."); return null; }
    const controller = new AbortController(); selectionRequest.current?.abort(); selectionRequest.current = controller;
    setLoadingRunId(id); setError("");
    try {
      const response = await fetch(`/api/sam/result?${new URLSearchParams({ runId: id, mapId })}`, { signal: controller.signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Saved SAM result could not be loaded.");
      const chosen = data.result as SamResult;
      if (chosen?.model !== "sam-3.1" || chosen.regions?.type !== "FeatureCollection" || chosen.runLog?.id !== id || (chosen.mapId ?? "upm") !== mapId) throw Error("Saved SAM result does not match the selected map and run.");
      selections.current[mapId] = id; saveSelections();
      setResults((saved) => ({ ...saved, [mapId]: chosen })); setPrompt(chosen.prompt); setShown(true);
      setPreviews((saved) => { const next = { ...saved }; delete next[mapId]; return next; });
      addLog({ ...log, resultAvailable: true });
      return chosen;
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Saved SAM result could not be loaded.");
      return null;
    } finally { if (selectionRequest.current === controller) { selectionRequest.current = null; setLoadingRunId(null); } }
  };

  const run = async (capture: CaptureMap) => {
    if (pending.current || loadingRunId) return;
    const concept = prompt.trim();
    if (!concept || concept.length > 100 || /[\n,;+<>]/.test(concept)) {
      const message = "Enter one short concept, such as palm tree.";
      setError(message);
      const rejected = newSamRunLog(crypto.randomUUID(), mapId, concept.slice(0, 100));
      addLog({ ...rejected, status: "error", finishedAt: rejected.startedAt, durationMs: 0, error: { stage: "validation", message } });
      return;
    }
    const controller = new AbortController(); pending.current = controller;
    let log = newSamRunLog(crypto.randomUUID(), mapId, concept);
    let stage = "capture";
    addLog(log);
    setError(""); setPhase("Capturing satellite view…");
    try {
      const image = await capture(controller.signal); setPreviews((saved) => ({ ...saved, [mapId]: image }));
      log = { ...log, status: "running", input: { source: image.source, width: image.width, height: image.height, polygonCorners: image.area.coordinates[0]!.length - 1 } }; addLog(log);
      controller.signal.throwIfAborted(); setPhase("Running SAM 3.1…");
      stage = "request";
      const res = await fetch("/api/sam/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...image, prompt: concept, mapId, runId: log.id }), signal: controller.signal });
      log = { ...log, transport: { httpStatus: res.status } };
      const data = await res.json();
      if (isSamRunLog(data.runLog)) { log = data.runLog; addLog(log); }
      if (!res.ok) throw Error(data.error ?? "SAM could not process this image.");
      if (data.model !== "sam-3.1" || data.regions?.type !== "FeatureCollection") throw Error("Invalid SAM result.");
      delete selections.current[mapId]; saveSelections();
      setResults((saved) => ({ ...saved, [mapId]: data })); lastRun.current = data.receivedAt; setShown(true);
      if (!log.finishedAt) { log = { ...log, status: "completed", finishedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(log.startedAt), warnings: ["This response did not include provider diagnostics."] }; addLog(log); }
    } catch (e) {
      const message = controller.signal.aborted ? "SAM run cancelled." : e instanceof Error ? e.message : "SAM run failed.";
      setError(message);
      if (!log.finishedAt) addLog({ ...log, status: controller.signal.aborted ? "cancelled" : "error", finishedAt: new Date().toISOString(), durationMs: Date.now() - Date.parse(log.startedAt), error: { stage, message } });
    }
    finally { pending.current = null; setPhase(""); }
  };

  const download = () => {
    if (!result) return;
    const data = { ...result.regions, sam: { ...result, regions: undefined } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/geo+json" }));
    const a = document.createElement("a"); a.href = url; a.download = `sam-3.1-${result.receivedAt.replaceAll(":", "-")}.geojson`; a.click(); URL.revokeObjectURL(url);
  };

  return { configured, prompt, setPrompt, phase, error, result, preview, logs: logs.filter((log) => log.mapId === mapId), shown, setShown, run, selectRun, loadingRunId, busy: !!phase || !!loadingRunId, cancel: () => pending.current?.abort(), download };
}
export type SamController = ReturnType<typeof useSam>;
