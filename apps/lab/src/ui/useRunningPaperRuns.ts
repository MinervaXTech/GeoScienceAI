import { useEffect, useState } from "react";

/** How many PaperRuns are working right now (Muse mid-pipeline, or an external agent active in the last few minutes), checked every few seconds, so the tab can show a spinner even while another tab is open. */
export function useRunningPaperRuns(intervalMs = 5000): number {
  const [running, setRunning] = useState(0);
  useEffect(() => {
    let live = true;
    const check = async () => { try { const data = await (await fetch("/api/paperrun/status")).json(); const list = Array.isArray(data.working) ? data.working : Array.isArray(data.running) ? data.running : null; if (live && list) setRunning(list.length); } catch { /* the pulse simply stays as it was */ } };
    void check(); const timer = setInterval(() => { void check(); }, intervalMs);
    return () => { live = false; clearInterval(timer); };
  }, [intervalMs]);
  return running;
}
