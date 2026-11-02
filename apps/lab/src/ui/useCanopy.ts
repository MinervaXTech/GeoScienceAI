import { useEffect, useRef, useState } from "react";
import type { Polygon } from "geojson";
import type { CanopyClip } from "../geo/canopy";

export function useCanopy(area: Polygon | null, enabled: boolean, drawing: boolean) {
  const areaKey = area ? JSON.stringify(area) : "";
  const [clip, setClip] = useState<CanopyClip | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const saved = useRef<CanopyClip | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(false);
      if (!enabled || drawing || !areaKey) return;
      setError("");
      if (saved.current && JSON.stringify(saved.current.area) === areaKey) { setClip(saved.current); return; }
      setLoading(true);
      try {
        const response = await fetch("/api/canopy/window", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ area: JSON.parse(areaKey) }), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw Error(data.error ?? "CHMv2 could not be loaded for this polygon.");
        if (data.version !== 1 || data.dataset !== "Meta/WRI CHMv2" || JSON.stringify(data.area) !== areaKey || !data.imageDataUrl?.startsWith("data:image/png;base64,")) throw Error("CHMv2 response does not match the selected polygon.");
        if (controller.signal.aborted) return;
        saved.current = data; setClip(data);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "CHMv2 could not be loaded for this polygon."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    const timer = setTimeout(() => { void load(); }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [areaKey, enabled, drawing, attempt]);
  const visible = clip && JSON.stringify(clip.area) === areaKey ? clip : null;
  return { clip: visible, loading, error, retry: () => { saved.current = null; setAttempt((value) => value + 1); } };
}
