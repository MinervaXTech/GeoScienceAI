import { useCallback, useEffect, useRef, useState } from "react";
import { ChatMarkdown } from "./ChatMarkdown";
import { formatDateTime } from "./format";
import { SaveToKnowledge } from "./SaveToWiki";
import type { RunSummary } from "./paperRunUi";

interface Source { kind?: "paper" | "repo" | "qa" | "hn"; meta?: string; title: string; year: number | null; url: string; cites: number }
const KIND: Record<string, string> = { paper: "Paper", repo: "Repository", qa: "Question", hn: "Hacker News" };
interface Finding { sources: Source[]; id: string; role: string; question: string; status: "pending" | "running" | "done" | "failed"; finding: string; evidence: string[]; assumptions: string[]; risks: string[]; confidence: string; error?: string }
interface Exploration { online: boolean; replication: { rating: string; verified: number; total: number; coveragePercent: number | null }; id: string; runId: string; title: string; goal: string; model: string; status: string; createdAt: string; tokens: { used: number; cap: number }; findings: Finding[]; verdict?: string; report?: string; nextSteps: string[]; error?: string; events?: { at: string; message: string }[] }
/** One entry per paper: its newest run. A replication only improves, so the newest run is the one an exploration builds on. */
interface Latest { paperId: string; title: string; run: RunSummary; ready: boolean }
export const latestPerPaper = (runs: RunSummary[]): Latest[] => { const best = new Map<string, RunSummary>(); for (const r of runs) { const cur = best.get(r.paperId); if (!cur || r.createdAt > cur.createdAt) best.set(r.paperId, r); } return [...best.values()].map(run => ({ paperId: run.paperId, title: run.title, run, ready: run.status === "done" })); };
const STATUS: Record<string, string> = { planning: "Planning", researching: "Subagents working", scouting: "Looking for code", synthesizing: "Merging findings", done: "Report ready", failed: "Failed", cancelled: "Cancelled" };
const VERDICT: Record<string, string> = { feasible: "Feasible", feasible_with_changes: "Feasible with changes", not_feasible: "Not feasible", unclear: "Unclear" };
const WORKING = new Set(["planning", "researching", "scouting", "synthesizing"]);
const FINDING: Record<string, string> = { pending: "Waiting", running: "Working", done: "Done", failed: "Failed" };
const api = async (path: string, body?: unknown) => { const response = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw Error(data.error ?? "Descendance request failed."); return data; };

/** What the chat session opens with: the report, so the user can question it. */
export const discussText = (e: { goal: string; report?: string; replication: { rating: string; verified: number; total: number } }) => `I want to discuss this Descendance report. It builds on a replication rated "${e.replication.rating}" (${e.replication.verified} of ${e.replication.total} results verified against the paper), so treat the method as ${e.replication.verified ? "partly" : "un"}verified.\n\nGoal: ${e.goal}\n\n${(e.report ?? "").slice(0, 6000)}\n\nWhich two claims in this report should I challenge first, and why?`;

export function DescendView({ onDiscuss, onOpenWorkshop }: { onDiscuss?: (text: string) => void; onOpenWorkshop?: (id: string) => void } = {}) {
  const [papers, setPapers] = useState<Latest[]>([]), [list, setList] = useState<Exploration[]>([]), [configured, setConfigured] = useState(true);
  const [paperId, setPaperId] = useState(""), [goal, setGoal] = useState(""), [model, setModel] = useState("muse-wonder-1.0"), [online, setOnline] = useState(true);
  const [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<Exploration | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    try { const [r, d] = await Promise.all([api("/api/paperrun"), api("/api/descend")]); if (!alive.current) return; const latest = latestPerPaper(r.runs as RunSummary[]); setPapers(latest); setPaperId(cur => cur || ((latest.find(p => p.ready) ?? latest[0])?.paperId ?? "")); setList(d.explorations); setConfigured(d.configured); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Descendance is unavailable."); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh(); }, 3000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    const load = async () => { try { const d = await api(`/api/descend/${selected}`); if (alive.current) setDetail(d.exploration); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Could not load the exploration."); } };
    void load(); const timer = setInterval(() => { void load(); }, 2000); return () => clearInterval(timer);
  }, [selected]);

  const start = async () => {
    if (busy) return; setBusy(true); setError("");
    try { const d = await api("/api/descend/start", { paperId, goal, model, online }); setSelected(d.exploration.id); setGoal(""); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not start."); } finally { setBusy(false); }
  };
  const startWorkshop = async (descendId: string) => { if (busy) return; setBusy(true); setError(""); try { const d = await api("/api/workshop/start", { descendId, model }); onOpenWorkshop?.(d.workshop.id); } catch (e) { setError(e instanceof Error ? e.message : "Could not start the workshop."); } finally { setBusy(false); } };
  const cancel = async (id: string) => { try { await api(`/api/descend/${id}/cancel`, {}); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Could not cancel."); } };
  const chosen = papers.find(p => p.paperId === paperId), working = !!detail && WORKING.has(detail.status);

  return <div className="paperrun-frame"><section className="paperrun" aria-label="Descendance">
    <div className="pr-side">
      <form className="pr-new" onSubmit={e => { e.preventDefault(); void start(); }}>
        <h2>New exploration</h2>
        {!configured && <p className="hint">MODEL_API_KEY is not set, so explorations cannot start.</p>}
        {!papers.length ? <p className="empty">Run a replication in the PaperRun tab first. An exploration builds on its latest run.</p> : <>
          <label>Paper<select value={paperId} onChange={e => setPaperId(e.target.value)}>{papers.map(p => <option key={p.paperId} value={p.paperId}>{p.title}</option>)}</select></label>
          {chosen && <p className="hint">{chosen.ready ? `Builds on the latest run (${chosen.run.mode === "muse" ? "Muse" : "agent"}, ${formatDateTime(chosen.run.createdAt)}) and what earlier runs and explorations learned.` : "The latest run of this paper is still going. Finish it first."}</p>}
          <label>What do you want to explore?<textarea rows={4} maxLength={1000} value={goal} placeholder="Can we take ACO from simulation to the real world? Do a feasibility study." onChange={e => setGoal(e.target.value)} /></label>
          <label className="pr-radio"><input type="checkbox" checked={online} onChange={e => setOnline(e.target.checked)} /> <span><strong>Search online</strong> <span className="hint">Each subagent looks up papers (OpenAlex), questions (Stack Overflow) and discussion (Hacker News). At the end the coordinator searches GitHub once, with queries written from what was found, for code to start from. Only short search queries leave this app.</span></span></label>
          <label>Model<select value={model} onChange={e => setModel(e.target.value)}><option value="muse-wonder-1.0">Muse Wonder 1.0</option><option value="muse-spark-1.3">Muse Spark 1.3</option></select></label>
          <button type="submit" className="btn" disabled={busy || !configured || goal.trim().length < 10 || !chosen?.ready}>Start exploration</button>
        </>}
        {error && <p className="sam-error" role="alert">{error}</p>}
      </form>
      <div className="pr-runs"><h3>Explorations</h3>
        {!list.length ? <p className="empty">None yet.</p> : <ul>{list.map(x => <li key={x.id}><button type="button" className={`pr-run${selected === x.id ? " selected" : ""}`} aria-pressed={selected === x.id} aria-label={`Exploration of ${x.title}: ${x.goal.slice(0, 60)}`} onClick={() => setSelected(x.id)}>
          <span className={`pr-chip ${x.status === "done" ? "ok" : WORKING.has(x.status) ? "busy" : "bad"}`}>{STATUS[x.status] ?? x.status}</span>
          <span className="pr-run-goal">{x.goal.length > 90 ? `${x.goal.slice(0, 89)}…` : x.goal}</span>
          <span className="hint">{x.title} · {formatDateTime(x.createdAt)}</span>
        </button></li>)}</ul>}
      </div>
    </div>
    <div className="pr-main">
      {!detail ? <p className="empty">Start an exploration, or pick one from the list.</p> : <>
        <header className="pr-head"><div><h2>{detail.goal}</h2><p className="hint">{detail.title} · {detail.model} · {detail.tokens.used.toLocaleString()} of {detail.tokens.cap.toLocaleString()} tokens</p></div>
          <span className={`pr-chip ${detail.status === "done" ? "ok" : working ? "busy" : "bad"}`}>{STATUS[detail.status] ?? detail.status}</span></header>
        <p className={`hint descend-status${detail.replication.verified === 0 ? " unverified" : ""}`}>Built on a replication rated <strong>{detail.replication.rating}</strong>: {detail.replication.verified} of {detail.replication.total} results verified against the paper, method coverage {detail.replication.coveragePercent === null ? "not assessed" : `${detail.replication.coveragePercent}%`}.{detail.replication.verified === 0 && " Treat the method as unverified."}</p>
        {detail.error && <p className="sam-error" role="alert">{detail.error}</p>}
        {working && <button type="button" className="btn small" onClick={() => { void cancel(detail.id); }}>Cancel</button>}
        <h3>Subagents</h3>
        {!detail.findings.length ? <p className="empty">The coordinator is splitting the goal into sub-questions.</p> : <ul className="descend-agents">{detail.findings.map(f => <li key={f.id} className={`descend-agent ${f.status}`}>
          <strong>{f.role}</strong> <span className="pr-chip idle">{FINDING[f.status]}</span>
          <p>{f.question}</p>
          {f.status === "done" && <details><summary>Finding ({f.confidence} confidence)</summary><p>{f.finding}</p>{f.evidence.length > 0 && <><b>Evidence</b><ul>{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></>}{f.assumptions.length > 0 && <><b>Assumptions</b><ul>{f.assumptions.map((e, i) => <li key={i}>{e}</li>)}</ul></>}{f.risks.length > 0 && <><b>Risks</b><ul>{f.risks.map((e, i) => <li key={i}>{e}</li>)}</ul></>}</details>}
          {f.sources?.length > 0 && <details><summary>{f.sources.length} source{f.sources.length === 1 ? "" : "s"} found online</summary><ol>{f.sources.map((x, i) => <li key={i}><span className="hint">{KIND[x.kind ?? "paper"]}</span> <a href={x.url} target="_blank" rel="noreferrer noopener">{x.title}</a> ({x.kind && x.kind !== "paper" ? x.meta : x.year ?? "n.d."})</li>)}</ol><p className="hint">Leads only: not read in full, run or licence-checked.</p></details>}
          {f.status === "failed" && <p className="sam-error">{f.error}</p>}
        </li>)}</ul>}
        {detail.verdict && <p><span className="pr-chip ok">{VERDICT[detail.verdict] ?? detail.verdict}</span></p>}
        {detail.report && onDiscuss && <p><button type="button" className="btn small primary" onClick={() => onDiscuss(discussText(detail))}>Discuss in chat</button> <span className="hint">Opens a new Muse chat session with this report.</span></p>}
        {detail.report && <><h3>Report</h3><div className="descend-report"><ChatMarkdown text={detail.report} /></div></>}
        {detail.report && detail.status === "done" && <SaveToKnowledge kind="exploration" id={detail.id} />}
        {detail.report && detail.status === "done" && onOpenWorkshop && <div className="descend-end"><p className="hint">Ready to test these ideas? A workshop turns the next steps into hypotheses and gives them one code folder to work in, from your own IDE or coding agent.</p><button type="button" className="btn primary" disabled={busy} onClick={() => { void startWorkshop(detail.id); }}>Start a workshop</button></div>}
      </>}
    </div>
  </section></div>;
}
