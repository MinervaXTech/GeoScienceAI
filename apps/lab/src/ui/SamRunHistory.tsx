import type { SamRunLog } from "../geo/sam";
import { SAM_LOG_LIMIT } from "../geo/samRunLog";

export function SamRunHistory({ logs, activeRunId, loadingRunId, busy = false, onUse }: { logs: SamRunLog[]; activeRunId?: string; loadingRunId?: string | null; busy?: boolean; onUse?(id: string): void }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "sam-run-log.json"; link.click(); URL.revokeObjectURL(url);
  };
  return <section className="sam-run-history" aria-label="SAM run log">
    <div className="sam-log-heading"><h3>Run log · {logs.length}</h3>{logs.length > 0 && <button type="button" className="btn small" onClick={download}>Download log JSON</button>}</div>
    <p className="hint">Latest {SAM_LOG_LIMIT} summaries are retained. Each run records the provider response and decoding counts.</p>
    {!logs.length && <p className="hint">No recorded summaries yet. Earlier runs cannot be verified because their provider responses were not retained.</p>}
    <ol>{logs.map((log, index) => <li key={log.id} data-run-id={log.id} className={activeRunId === log.id ? "sam-log-active" : ""}>
      <div className="sam-log-use"><button type="button" className="btn small" disabled={busy || log.status !== "completed" || log.resultAvailable === false || activeRunId === log.id} aria-label={`Use “${log.prompt}” result from ${new Date(log.startedAt).toLocaleString()}`} aria-pressed={activeRunId === log.id} title={log.status !== "completed" ? "This run did not complete." : log.resultAvailable === false ? "Only a summary was retained; masks are unavailable." : "Load this saved result onto the map"} onClick={() => onUse?.(log.id)}>{loadingRunId === log.id ? "Loading…" : activeRunId === log.id ? "In use" : "Use"}</button></div>
      <details open={index === 0}>
      <summary><span>{new Date(log.startedAt).toLocaleString()} · “{log.prompt}”</span><strong>{log.status}{log.status === "completed" ? log.decoding.status === "completed" ? ` · ${log.decoding.masks} masks → ${log.decoding.displayedSegments} ${log.decoding.displayedSegments === 1 ? "segment" : "segments"}` : " · provider diagnostics unavailable" : log.error ? ` · ${log.error.stage}` : ""}</strong></summary>
      <pre aria-label={`JSON summary for ${log.id}`}>{JSON.stringify(log, null, 2)}</pre>
    </details></li>)}</ol>
  </section>;
}
