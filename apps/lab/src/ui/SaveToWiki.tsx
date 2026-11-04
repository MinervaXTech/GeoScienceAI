import { useCallback, useEffect, useRef, useState } from "react";

type Kind = "replication" | "exploration" | "workshop";
export interface CopyState { saved: boolean; stale: boolean }
export interface Auto { wiki: boolean; graph: boolean; quietMinutes: number }
export interface SyncStatus { changedAt: string; wiki: CopyState & { writtenAt?: string }; graph: CopyState & { addedAt?: string }; auto?: Auto }
const api = async (path: string, body?: unknown) => { const response = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw Error(data.error ?? "The request failed."); return data; };

/** One destination's line. Nothing to do shows as a quiet note; something new to update is the only thing that asks for attention. */
function Line({ ok, stale, what, nothing, button, onClick, busy, extra, auto }: { ok: boolean; stale: boolean; what: string; nothing: string; button: string; onClick(): void; busy?: boolean; extra?: React.ReactNode; auto?: string }) {
  if (!ok) return <div className="save-wiki"><button type="button" className="btn small" disabled={busy} onClick={onClick}>{button}</button><span className="hint">{nothing}{auto ? ` ${auto}` : ""}</span>{extra}</div>;
  if (stale) return <div className="save-wiki save-stale" role="status"><span className="hint"><strong>{what}</strong> has older content: this changed after it was saved.{auto ? ` ${auto}` : ""}</span><button type="button" className="btn small primary" disabled={busy} onClick={onClick}>{button}</button>{extra}</div>;
  return <div className="save-wiki save-current"><span className="hint">✓ {what}, up to date.</span><button type="button" className="link-btn" disabled={busy} onClick={onClick}>Update anyway</button>{extra}</div>;
}

/** Writes this item to the wiki folder as markdown pages. Saving again refreshes the page. */
export function SaveToWiki({ kind, id, state, onChanged, auto }: { kind: Kind; id: string; state: CopyState | null; onChanged(): void; auto?: Auto }) {
  const [folder, setFolder] = useState(""), [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setMessage(""); setError(""); void api("/api/wiki").then(d => { if (alive.current) setFolder(d.folder); }).catch(() => undefined); }, [kind, id]);
  const save = async () => {
    if (busy) return; setBusy(true); setError("");
    try { const d = await api("/api/wiki/save", { kind, id }); if (!alive.current) return; setFolder(d.folder); setMessage(`${d.action === "refreshed" ? "Refreshed" : "Saved"} in the wiki: ${(d.pages as string[]).length} page${d.pages.length === 1 ? "" : "s"} written.`); onChanged(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Could not save to the wiki."); } finally { if (alive.current) setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(folder); setMessage("Wiki folder path copied."); } catch { setMessage(`Could not copy. The folder is ${folder}`); } };
  if (!state) return <div className="save-wiki"><span className="hint">Checking the wiki…</span></div>;
  return <>
    <Line ok={state.saved} stale={state.stale} what="The wiki page" nothing={`Writes this ${kind} as markdown pages in a local wiki folder. Nothing is saved until you click.`} button={state.saved ? "Update wiki page" : "Save to wiki"} onClick={() => { void save(); }} busy={busy} auto={auto?.wiki ? `It will be saved by itself once it has been quiet for ${auto.quietMinutes} minute${auto.quietMinutes === 1 ? "" : "s"}.` : undefined}
      extra={<>{state.saved && folder && <button type="button" className="link-btn" onClick={() => { void copy(); }}>Copy folder path</button>}{message && <span className="hint" role="status">{message}</span>}{error && <span className="sam-error" role="alert">{error}</span>}</>} />
  </>;
}

/** Adds this item to the knowledge graph. It costs Muse calls and creates an entry beside the papers, so it asks first and says what it will do. */
export function AddToGraph({ kind, id, state, onChanged, auto }: { kind: Kind; id: string; state: CopyState | null; onChanged(): void; auto?: Auto }) {
  const [step, setStep] = useState<"idle" | "asking" | "working">("idle"), [message, setMessage] = useState(""), [error, setError] = useState("");
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setStep("idle"); setMessage(""); setError(""); }, [kind, id]);
  const add = async () => {
    setStep("working"); setError("");
    try { const d = await api("/api/graph-sync/graph", { kind, id, confirmed: true }); if (!alive.current) return; setStep("idle"); setMessage(d.duplicate ? "Already in the knowledge graph, and unchanged." : `Added to the knowledge graph${d.replaced ? ", replacing its earlier version" : ""}. Find it in the Papers tab under the collection App knowledge.`); onChanged(); }
    catch (e) { if (alive.current) { setStep("idle"); setError(e instanceof Error ? e.message : "Could not add this to the knowledge graph."); } }
  };
  if (!state) return <div className="save-wiki"><span className="hint">Checking the knowledge graph…</span></div>;
  if (step === "asking") return <div className="save-wiki"><div className="graph-confirm" role="group" aria-label="Confirm adding to the knowledge graph">
    <p>Muse will read this {kind} and extract its nodes and edges, about three model calls. It becomes its own entry in the Papers tab, under the collection App knowledge, marked as made by the app and not a paper. Quotes are checked against this text only, so a claim an agent reported is stored as reported and not as verified.{state.saved ? " Its earlier entry is replaced once the new one is stored." : ""}</p>
    <div className="session-action-buttons"><button type="button" className="btn small primary" onClick={() => { void add(); }}>Add to graph</button><button type="button" className="btn small" onClick={() => setStep("idle")}>Cancel</button></div>
  </div></div>;
  return <Line ok={state.saved} stale={state.stale} what="The knowledge graph entry" nothing="Nothing goes into the graph until you agree." button={state.saved ? "Update in knowledge graph" : "Add to knowledge graph"} onClick={() => setStep("asking")} busy={step === "working"} auto={auto?.graph ? `It will be added by itself once it has been quiet for ${auto.quietMinutes} minute${auto.quietMinutes === 1 ? "" : "s"}.` : undefined}
    extra={<>{step === "working" && <span className="hint" role="status">Muse is reading it. This takes a minute or two.</span>}{message && <span className="hint" role="status">{message}</span>}{error && <span className="sam-error" role="alert">{error}</span>}</>} />;
}

/** The wiki and the graph for one item, with where each stands. The status is read again every few seconds, because a workshop changes while an agent works. */
export function SaveToKnowledge({ kind, id, every = 6000 }: { kind: Kind; id: string; every?: number }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => { try { const d = await api(`/api/graph-sync/status?kind=${kind}&id=${encodeURIComponent(id)}`); if (alive.current) setStatus(d); } catch { if (alive.current) setStatus(null); } }, [kind, id]);
  useEffect(() => { setStatus(null); void load(); const timer = setInterval(() => { void load(); }, every); return () => clearInterval(timer); }, [load, every]);
  return <div className="save-knowledge"><SaveToWiki kind={kind} id={id} state={status?.wiki ?? null} onChanged={() => { void load(); }} {...(status?.auto ? { auto: status.auto } : {})} /><AddToGraph kind={kind} id={id} state={status?.graph ?? null} onChanged={() => { void load(); }} {...(status?.auto ? { auto: status.auto } : {})} /></div>;
}
