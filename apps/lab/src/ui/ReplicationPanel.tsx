import { CodeSourcesNote } from "./CodeSourcesNote";
import type { CodeSources } from "../domain/codeSources";
import { useEffect, useRef, useState } from "react";
import type { KnowledgeEntry } from "../domain/knowledge";

interface Built { cached: boolean; markdown: string; codexPrompt: string; spec: { steps: unknown[]; parameters: { verified: boolean }[]; reportedResults: unknown[]; gaps: { impact: string }[]; equations: unknown[] }; meta: { model: string; builtAt: string; codeSources?: CodeSources }; usage?: { total_tokens?: number } }
type State = { kind: "loading" } | { kind: "none" } | { kind: "building"; model: string } | { kind: "ready"; built: Built } | { kind: "error"; message: string };
const MODELS = [["muse-wonder-1.0", "Wonder 1.0 (recommended)"], ["muse-spark-1.3", "Spark 1.3 (cheaper)"]] as const;

/** Builds, shows and exports a stored paper's reproduction spec. Building reads the whole paper with Muse, so it only starts on a click. */
export function ReplicationPanel({ entry, onSaveNote }: { entry: KnowledgeEntry; onSaveNote(note: { entryId: string; paperTitle: string; label: string; title: string; body: string }): void }) {
  const [state, setState] = useState<State>({ kind: "loading" }), [model, setModel] = useState<string>(MODELS[0][0]), [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const call = async (body: Record<string, unknown>, signal: AbortSignal) => {
    const response = await fetch("/api/knowledge/replication", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ paper: entry.id, ...body }) });
    const data = await response.json(); if (!response.ok) throw Error(data.error ?? "The reproduction spec could not be built."); return data;
  };
  useEffect(() => {
    const controller = new AbortController();
    call({ peek: true }, controller.signal).then(data => { if (!controller.signal.aborted) setState(data.status === "spec" ? { kind: "ready", built: data } : { kind: "none" }); }).catch(e => { if (!controller.signal.aborted) setState({ kind: "error", message: e instanceof Error ? e.message : "Could not check for a spec." }); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);
  const build = async (refresh: boolean) => {
    if (state.kind === "building") return;
    const controller = new AbortController(); pending.current = controller; setState({ kind: "building", model }); setNotice("");
    try { const data = await call({ model, ...(refresh ? { refresh: true } : {}) }, controller.signal); if (data.status !== "spec") throw Error("The paper could not be found in the knowledge base."); setState({ kind: "ready", built: data }); }
    catch (e) { if (!controller.signal.aborted) setState({ kind: "error", message: e instanceof Error ? e.message : "The reproduction spec could not be built." }); }
    finally { if (pending.current === controller) pending.current = null; }
  };
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); setNotice(`${what} copied.`); } catch { setNotice("Clipboard unavailable. Use Save to Notes and copy from there."); } };
  if (state.kind === "loading") return <p className="hint">Checking for a saved spec…</p>;
  if (state.kind === "building") return <div role="status" className="replication-building"><p>Muse ({state.model === "muse-wonder-1.0" ? "Wonder 1.0" : "Spark 1.3"}) is reading the whole paper. This usually takes under a minute.</p><progress aria-label="Building reproduction spec" /><button type="button" className="btn small" onClick={() => { pending.current?.abort(); setState({ kind: "none" }); }}>Cancel</button></div>;
  if (state.kind === "error") return <div><p className="sam-error" role="alert">{state.message}</p><button type="button" className="btn small" onClick={() => setState({ kind: "none" })}>Try again</button></div>;
  if (state.kind === "none") return <div className="replication-panel"><p className="hint">Reads the whole paper and lists its steps, equations, parameters, reported results and what it leaves out. Uses Muse credits (about 20,000 tokens).</p>
    <label className="replication-model">Model<select aria-label="Muse model for the spec" value={model} onChange={e => setModel(e.target.value)}>{MODELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <button type="button" className="btn small primary" onClick={() => { void build(false); }}>Build reproduction spec</button></div>;
  const { built } = state, high = built.spec.gaps.filter(g => g.impact === "high").length, unverified = built.spec.parameters.filter(p => !p.verified).length;
  return <div className="replication-panel"><p className="hint">{built.spec.steps.length} steps · {built.spec.equations.length} equations · {built.spec.parameters.length} parameters{unverified ? ` (${unverified} not verified)` : ""} · {built.spec.reportedResults.length} results to match · {built.spec.gaps.length} gaps ({high} high impact). Built by {built.meta.model} on {built.meta.builtAt.slice(0, 10)}.</p>
    <CodeSourcesNote sources={built.meta.codeSources} />
    <div className="session-action-buttons">
      <button type="button" className="btn small primary" onClick={() => { onSaveNote({ entryId: entry.id, paperTitle: entry.title, label: "Replication", title: `Reproduction spec: ${entry.title}`.slice(0, 120), body: built.markdown }); setNotice("Saved to Notes."); }}>Save to Notes</button>
      <button type="button" className="btn small" onClick={() => { void copy(built.codexPrompt, "Codex prompt"); }}>Copy Codex prompt</button>
      <button type="button" className="btn small" onClick={() => { void build(true); }}>Rebuild</button></div>
    {notice && <p className="hint" role="status">{notice}</p>}</div>;
}
