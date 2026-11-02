import { useEffect, useRef, useState } from "react";
import type { MuseResult } from "../geo/muse";
import type { MusePyramid } from "../geo/musePyramid";

export function useMusePyramid(mapId: string) {
  const key = `lab.muse.pyramid.${mapId}`;
  const [preferences] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(key) ?? "{}"); return { shown: saved.shown !== false, opacity: Number.isFinite(saved.opacity) ? Math.max(0, Math.min(100, saved.opacity)) : 100 }; }
    catch { return { shown: true, opacity: 100 }; }
  });
  const [layer, setLayer] = useState<MusePyramid | null>(null);
  const [shown, setShown] = useState(preferences.shown);
  const [opacity, setOpacity] = useState<number>(preferences.opacity);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const selectionVersion = useRef(0);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify({ shown, opacity })); } catch { /* The server retains the selected pyramid when browser storage is unavailable. */ } }, [key, shown, opacity]);
  useEffect(() => {
    const controller = new AbortController();
    const version = selectionVersion.current;
    void fetch(`/api/muse/pyramid?${new URLSearchParams({ mapId })}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (controller.signal.aborted || pending.current || selectionVersion.current !== version) return;
      if (!response.ok) throw Error(data.error ?? "Saved Muse layer could not be restored.");
      if (data.layer?.mapId === mapId && data.layer.version === 1) setLayer(data.layer);
    }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Saved Muse layer could not be restored."); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, [mapId]);
  const useResult = async (result: MuseResult): Promise<MusePyramid | null> => {
    if (pending.current || result.mapId !== mapId) return null;
    selectionVersion.current++;
    if (layer?.runId === result.id) { setShown(true); setError(""); return layer; }
    const controller = new AbortController(); pending.current = controller; setLoading(true); setError("");
    try {
      const response = await fetch("/api/muse/pyramid/use", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ mapId, runId: result.id }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Enhancement could not be loaded.");
      if (data.layer?.version !== 1 || data.layer.runId !== result.id || data.layer.mapId !== mapId || data.layer.imageSha256 !== result.enhancedSha256) throw Error("Enhancement pyramid does not match this map and result.");
      if (controller.signal.aborted) return null;
      setLayer(data.layer); setShown(true); setOpacity(100);
      return data.layer;
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Enhancement could not be loaded."); return null; }
    finally { if (pending.current === controller) { pending.current = null; setLoading(false); } }
  };
  return { cancel: () => pending.current?.abort(), layer, shown, setShown, opacity, setOpacity, loading, error, useResult };
}
export type MusePyramidController = ReturnType<typeof useMusePyramid>;
