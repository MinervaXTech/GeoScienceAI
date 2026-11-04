import { useCallback, useEffect, useRef, useState } from "react";

interface Settings { wiki: boolean; graph: boolean; quietMinutes: number; graphDailyLimit: number }
interface Waiting { kind: string; id: string; title: string; destination: "wiki" | "graph"; reason: string; dueAt?: string; blocked?: string }
interface Event { at: string; destination: "wiki" | "graph"; kind: string; id: string; result: string; note?: string }
interface Snapshot { activeToday?: boolean; settings: Settings; today: { graphAttempts: number; limit: number }; lastScanAt?: string; recent: Event[]; waiting: Waiting[] }
const api = async (path: string, body?: unknown) => { const response = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw Error(data.error ?? "The request failed."); return data; };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const short = (t: string) => t.length > 48 ? `${t.slice(0, 47)}…` : t;
const NOUN: Record<string, string> = { replication: "replication", exploration: "exploration", workshop: "workshop" };
const DONE: Record<string, string> = { saved: "saved", refreshed: "refreshed", added: "added", replaced: "replaced", unchanged: "already current", failed: "failed" };
export const autoLabel = (s: Settings) => s.wiki && s.graph ? "on" : s.wiki ? "wiki only" : s.graph ? "graph only" : "off";

/** Keeps the wiki and the knowledge graph in step with the app by itself. This is where it is switched, limited and watched. */
export function AutoSyncControl({ every = 15000 }: { every?: number }) {
  const [snap, setSnap] = useState<Snapshot | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => { try { const d = await api("/api/autosync"); if (alive.current) { setSnap(d); setError(""); } } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Auto-sync is unavailable."); } }, []);
  useEffect(() => { void load(); const timer = setInterval(() => { void load(); }, every); return () => clearInterval(timer); }, [load, every]);
  const change = async (patch: Partial<Settings>) => { setBusy(true); try { await api("/api/autosync/settings", patch); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not change that."); } finally { if (alive.current) setBusy(false); } };
  const check = async () => { setBusy(true); try { await api("/api/autosync/run", {}); await load(); } catch (e) { setError(e instanceof Error ? e.message : "The check failed."); } finally { if (alive.current) setBusy(false); } };
  const s = snap?.settings, waiting = snap?.waiting ?? [], idle = snap?.activeToday === false && waiting.length > 0, blocked = waiting.some(w => w.blocked === "daily limit reached"), failing = waiting.some(w => w.blocked && w.blocked !== "daily limit reached" && w.blocked !== "no changes today");
  return <details className="autosync">
    <summary className="btn small" aria-label="Auto-sync settings">Auto-sync: {s ? autoLabel(s) : error ? "unavailable" : "…"}{s && waiting.length > 0 && (s.wiki || s.graph) ? ` · ${waiting.length} waiting` : ""}{idle ? " · idle today" : blocked ? " · daily limit reached" : failing ? " · needs a look" : ""}</summary>
    <div className="autosync-panel" role="group" aria-label="Auto-sync">
      {error && <p className="sam-error" role="alert">{error}</p>}
      {s && snap && <>
        <p className="hint">Keeps the wiki and the knowledge graph up to date by itself. A finished replication, exploration or workshop is added, and updated when it changes, but only after it has been quiet for a while. On a day when nothing changed, nothing is pushed.</p>{idle && <p className="hint" role="status"><strong>Nothing changed today, so nothing is pushed.</strong> Updates start again when something changes.</p>}
        <label className="pr-radio"><input type="checkbox" checked={s.wiki} disabled={busy} onChange={e => { void change({ wiki: e.target.checked }); }} /> <span><strong>Wiki</strong> <span className="hint">Local and free. Updates once an item has been quiet.</span></span></label>
        <label className="pr-radio"><input type="checkbox" checked={s.graph} disabled={busy} onChange={e => { void change({ graph: e.target.checked }); }} /> <span><strong>Knowledge graph</strong> <span className="hint">Costs about three Muse calls per item, so it reads one item at a time, within the daily limit.</span></span></label>
        <div className="autosync-row"><label>Wait until quiet for <select aria-label="Quiet time" value={s.quietMinutes} disabled={busy} onChange={e => { void change({ quietMinutes: Number(e.target.value) }); }}>{[...new Set([1, 5, 10, 30, 60, 120, s.quietMinutes])].sort((a, b) => a - b).map(m => <option key={m} value={m}>{m} minute{m === 1 ? "" : "s"}</option>)}</select></label>
          <label>Daily limit <input type="number" aria-label="Daily limit of graph reads" min={0} max={100} value={s.graphDailyLimit} disabled={busy} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n <= 100) void change({ graphDailyLimit: n }); }} /></label></div>
        <p className="hint">Graph reads today: {snap.today.graphAttempts} of {snap.today.limit}.{snap.lastScanAt ? ` Last check ${hhmm(snap.lastScanAt)}.` : " No check yet."} <button type="button" className="link-btn" disabled={busy} onClick={() => { void check(); }}>Check now</button></p>
        <h4>Waiting</h4>
        {!waiting.length ? <p className="hint">Nothing. Everything finished is up to date.</p> : <ul className="autosync-list">{waiting.slice(0, 6).map(w => <li key={`${w.destination}${w.id}`}><strong>{w.destination === "wiki" ? "Wiki" : "Graph"}</strong> {NOUN[w.kind]} <span className="hint">{short(w.title)}: {w.reason}{w.blocked ? `, ${w.blocked}` : w.dueAt ? `, due ${hhmm(w.dueAt)}` : ""}</span></li>)}{waiting.length > 6 && <li className="hint">and {waiting.length - 6} more</li>}</ul>}
        {snap.recent.length > 0 && <><h4>Recent</h4><ul className="autosync-list">{snap.recent.slice(0, 5).map((e, i) => <li key={i}><span className="hint">{hhmm(e.at)}</span> {e.destination === "wiki" ? "Wiki" : "Graph"} {DONE[e.result] ?? e.result}: {NOUN[e.kind]} {e.note ? <span className="sam-error">{e.note}</span> : null}</li>)}</ul></>}
      </>}
    </div>
  </details>;
}
