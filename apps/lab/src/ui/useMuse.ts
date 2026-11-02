import { useEffect, useRef, useState } from "react";
import { DEFAULT_MUSE_OBJECTIVE, isMuseModel, type MuseCapture, type MuseMethod, type MuseResult, type MuseStep } from "../geo/muse";

export function useMuse(mapId: string, mapName: string, model = "muse-spark-1.3") {
  const [configured, setConfigured] = useState(false);
  const [objective, setObjective] = useState(DEFAULT_MUSE_OBJECTIVE);
  const [method, setMethod] = useState<MuseMethod>("generative");
  const [result, setResult] = useState<MuseResult | null>(null);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [failedTrace, setFailedTrace] = useState<MuseStep[]>([]);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/muse/status", { signal: controller.signal, cache: "no-store" });
        const status = await response.json();
        if (response.ok && !controller.signal.aborted) setConfigured(status.configured === true);
        if (pending.current) return;
        const saved = await fetch(`/api/muse/result?${new URLSearchParams({ mapId })}`, { signal: controller.signal, cache: "no-store" });
        const data = await saved.json();
        if (saved.ok && !controller.signal.aborted && !pending.current && isMuseModel(data.result?.model) && data.result.mapId === mapId) setResult(data.result);
      } catch { /* Status reads never dispatch a model call. */ }
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 10000);
    return () => { controller.abort(); clearInterval(interval); pending.current?.abort(); };
  }, [mapId]);
  const run = async (capture: MuseCapture) => {
    if (pending.current || !objective.trim()) return;
    const controller = new AbortController(); pending.current = controller;
    setError(""); setFailedTrace([]); setPhase("Capturing selected polygon…");
    try {
      const image = await capture(controller.signal);
      controller.signal.throwIfAborted();
      setPhase(method === "generative" ? "Muse Image is restoring the image, then Spark will check crown scale and texture…" : "Muse is choosing tonal adjustments and reviewing the area…");
      const response = await fetch("/api/muse/run", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ ...image, mapId, mapName, model, method, objective: objective.trim() }) });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) { if (Array.isArray(data.trace)) setFailedTrace(data.trace); throw Error(data.error ?? "Muse could not process this area."); }
      if (!isMuseModel(data.model) || data.mapId !== mapId || !data.enhancedImageDataUrl?.startsWith("data:image/png;base64,")) throw Error("Muse returned an invalid map result.");
      setResult(data);
    } catch (e) {
      if (pending.current === controller) setError(controller.signal.aborted ? "Muse run cancelled." : e instanceof Error ? e.message : "Muse run failed.");
    } finally { if (pending.current === controller) { pending.current = null; setPhase(""); } }
  };
  return { model, configured, objective, setObjective, method, setMethod, result, phase, error, failedTrace, busy: !!phase, run, cancel: () => pending.current?.abort() };
}
export type MuseController = ReturnType<typeof useMuse>;
