import { useCallback, useEffect, useRef, useState } from "react";
import { formatDateTime } from "./format";
import { SaveToKnowledge } from "./SaveToWiki";
import { mcpSnippets, type McpConfig } from "./paperRunUi";

interface Hypothesis { id: string; statement: string; test: string; success: string; status: string; evidence: string[] }
interface Experiment { id: string; hypothesisId: string; summary: string; metric?: string; value?: string; by: string; at: string }
interface Workshop { id: string; title: string; goal: string; status: string; createdAt: string; replication: { rating: string; verified: number; total: number; coveragePercent: number | null }; hypotheses: Hypothesis[]; experiments: Experiment[]; log?: { at: string; by: string; message: string }[]; nextSteps: string[]; repos: { title: string; url: string; meta?: string }[]; error?: string; summary?: string }
const STATUS: Record<string, string> = { untested: "Untested", testing: "Testing", supported: "Supported", refuted: "Refuted", inconclusive: "Inconclusive" };
const TONE: Record<string, string> = { untested: "idle", testing: "busy", supported: "ok", refuted: "bad", inconclusive: "idle" };
const MAX = 6;
/** What the user pastes into an agent, or what a launch command starts it with. */
export const workshopPrompt = (id: string) => `Work workshop ${id} using the workshop tools. Start with workshop_get_brief. Write all code in the workshop's code folder with your own editor. Log what you do with workshop_log, and record each experiment with workshop_record_experiment, including the metric and the value you measured. Never report a value you did not measure.`;
const quote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
/** A link that asks the desktop editor to open the folder. The browser may ask once before it hands the link over. */
export const ideLink = (scheme: "vscode" | "cursor", folder: string) => `${scheme}://file/${encodeURI(folder.replace(/^\/+/, ""))}`;
/** A shell command that starts a terminal agent inside the folder with the prompt already given. */
export const agentCommand = (tool: "codex" | "claude", folder: string, id: string) => `cd ${quote(folder)} && ${tool} ${quote(workshopPrompt(id))}`;
const short = (n: number) => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
const api = async (path: string, body?: unknown) => { const response = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw Error(data.error ?? "Workshop request failed."); return data; };

export function WorkshopView({ openId }: { openId?: string | null } = {}) {
  const [list, setList] = useState<Workshop[]>([]), [selected, setSelected] = useState<string | null>(openId ?? null), [detail, setDetail] = useState<Workshop | null>(null), [folder, setFolder] = useState(""), [files, setFiles] = useState<{ path: string; bytes: number; modified: string }[]>([]), [mcp, setMcp] = useState<McpConfig | null>(null);
  const [draft, setDraft] = useState<Hypothesis[] | null>(null), [initBusy, setInitBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (openId) setSelected(openId); }, [openId]);

  const refresh = useCallback(async () => { try { const d = await api("/api/workshop"); if (alive.current) setList(d.workshops); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "The Workshop is unavailable."); } }, []);
  useEffect(() => { void api("/api/workshop/status").then(d => { if (alive.current) setMcp(d.mcp); }).catch(() => undefined); }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh(); }, 4000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    const load = async () => { try { const d = await api(`/api/workshop/${selected}`); if (alive.current) { setDetail(d.workshop); setFolder(d.codeDirectory); setFiles(d.files ?? []); } } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Could not load the workshop."); } };
    void load(); const timer = setInterval(() => { void load(); }, 2000); return () => clearInterval(timer);
  }, [selected]);

  const save = async () => {
    if (!detail || !draft || busy) return; setBusy(true); setError("");
    try { const d = await api(`/api/workshop/${detail.id}/hypotheses`, { hypotheses: draft.map(h => ({ id: h.id.startsWith("new") ? undefined : h.id, statement: h.statement, test: h.test, success: h.success })) }); setDetail(d.workshop); setDraft(null); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  };
  const initialise = async () => {
    if (!detail || initBusy) return; setInitBusy(true); setError("");
    try { const d = await api(`/api/workshop/${detail.id}/init`, {}); const r = d.result as { created: string[]; baseline: { files: number } | null }; setNotice(r.created.length ? `Code folder set up: ${r.created.length} file${r.created.length === 1 ? "" : "s"}${r.baseline ? `, including a baseline copy of ${r.baseline.files} replication file${r.baseline.files === 1 ? "" : "s"}` : ", and no replication code was found to copy"}.` : "Nothing to add: the code folder already has everything."); setDetail(d.workshop); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not set up the code folder."); } finally { setInitBusy(false); }
  };
  const copyText = async (value: string, label: string) => { try { await navigator.clipboard.writeText(value); setNotice(`${label} copied.`); } catch { setNotice("Could not copy. Select the text and copy it."); } };
  const set = (i: number, change: Partial<Hypothesis>) => setDraft(d => d && d.map((h, j) => j === i ? { ...h, ...change } : h));

  return <div className="paperrun-frame"><section className="paperrun" aria-label="Workshop">
    <div className="pr-side">
      <div className="pr-runs"><h3>Workshops</h3>
        {!list.length ? <p className="empty">None yet. Finish a Descendance report and choose Start a workshop at its end.</p> : <ul>{list.map(w => <li key={w.id}><button type="button" className={`pr-run${selected === w.id ? " selected" : ""}`} aria-pressed={selected === w.id} aria-label={`Workshop on ${w.title}: ${w.goal.slice(0, 60)}`} onClick={() => { setSelected(w.id); setDraft(null); }}>
          <span className={`pr-chip ${w.status === "ready" ? "ok" : w.status === "failed" ? "bad" : "busy"}`}>{w.status === "ready" ? `${w.hypotheses.length} hypotheses` : w.status === "failed" ? "Failed" : "Preparing"}</span>
          <span className="pr-run-goal">{w.goal.length > 90 ? `${w.goal.slice(0, 89)}…` : w.goal}</span>
          <span className="hint">{w.title} · {formatDateTime(w.createdAt)}</span>
        </button></li>)}</ul>}
      </div>
      {error && <p className="sam-error" role="alert">{error}</p>}
    </div>
    <div className="pr-main">
      {!detail ? <p className="empty">Pick a workshop. A workshop is where the ideas from a Descendance report are tested, in code you write in your own IDE or agent.</p> : <>
        <header className="pr-head"><div><h2>{detail.goal}</h2><p className="hint">{detail.title} · started {formatDateTime(detail.createdAt)}</p></div><span className={`pr-chip ${detail.status === "ready" ? "ok" : detail.status === "failed" ? "bad" : "busy"}`}>{detail.status === "ready" ? "Ready" : detail.status === "failed" ? "Failed" : "Preparing"}</span></header>
        <p className={`hint descend-status${detail.replication.verified === 0 ? " unverified" : ""}`}>Baseline: a replication rated <strong>{detail.replication.rating}</strong>, {detail.replication.verified} of {detail.replication.total} results verified against the paper.{detail.replication.verified === 0 && " A result here is only as good as that baseline, so treat the method as unverified."}</p>
        {detail.error && <p className="sam-error" role="alert">{detail.error}</p>}
        {detail.status === "ready" && <SaveToKnowledge kind="workshop" id={detail.id} />}
        <div className="workshop-open" role="group" aria-label="Open the code folder">
          <div className="workshop-init"><button type="button" className="btn small primary" disabled={initBusy || detail.status !== "ready" || files.some(f => f.path === "README.md")} onClick={() => { void initialise(); }}>{files.some(f => f.path === "README.md") ? "Code initialised" : "Initialize code"}</button>
            <span className="hint">{files.some(f => f.path === "README.md") ? "A README, the experiment stubs and a baseline copy are in the code folder." : "Sets up the code folder with a README, one experiment stub per hypothesis and a copy of the replication code as a baseline. Nothing is overwritten and nothing is run."}</span></div>
          <strong className="hint">Open the code folder in</strong>
          <div className="session-action-buttons">
            <a className="btn small primary" href={ideLink("vscode", folder)}>VS Code</a>
            <a className="btn small primary" href={ideLink("cursor", folder)}>Cursor</a>
            <button type="button" className="btn small" onClick={() => { void copyText(agentCommand("codex", folder, detail.id), "Codex command"); }}>Copy for Codex</button>
            <button type="button" className="btn small" onClick={() => { void copyText(agentCommand("claude", folder, detail.id), "Claude Code command"); }}>Copy for Claude Code</button>
            <button type="button" className="btn small" onClick={() => { void copyText(workshopPrompt(detail.id), "Prompt"); }}>Copy prompt</button>
            <button type="button" className="btn small" onClick={() => { void copyText(folder, "Folder path"); }}>Copy code folder path</button>
          </div>
          <span className="hint">{folder}</span>
          <span className="hint">VS Code and Cursor open from a link, and the browser may ask once before it hands it over. Codex and Claude Code run in a terminal, so those buttons copy a command that starts them in this folder with the prompt. For any other editor, open the folder path. The workshop MCP server below must be registered in whichever agent you use.</span>
        </div>
        {notice && <p className="hint" role="status">{notice}</p>}
        <p className="hint">There is no editor here. The one code folder is where the code lives; progress from your IDE or agent comes back to this page.</p>
        <details className="pr-external" open={!!detail && detail.status === "ready" && !files.length && !detail.experiments.length}><summary>Connect your coding agent</summary>
          <p>Register the workshop MCP server once, then tell your agent: <em>Work workshop {detail.id} using the workshop tools. Start with workshop_get_brief.</em> Its log entries and experiments appear here live, and the file list below follows the code folder itself.</p>
          {mcp ? mcpSnippets(mcp, "workshop").map(x => <div key={x.name} className="pr-snippet"><div className="pr-snippet-head"><strong>{x.name}</strong><button type="button" className="btn small" onClick={() => { void navigator.clipboard.writeText(x.text).then(() => setNotice(`${x.name} command copied.`), () => setNotice("Could not copy.")); }}>Copy</button></div><pre>{x.text}</pre></div>) : <p className="hint">Loading the MCP settings.</p>}
          <p className="hint">The commands follow each agent's usual syntax. If a flag differs in your version, use the JSON form or check its docs. Reconnect the agent after the server code changes.</p></details>
        <h3>Hypotheses</h3>
        {detail.status === "preparing" && <p className="empty">Muse is writing the hypotheses from the report.</p>}
        {draft ? <div className="workshop-edit">
          {draft.map((h, i) => <fieldset key={h.id} className="workshop-card"><legend>{h.id.startsWith("new") ? "New" : h.id}</legend>
            <label>Claim<textarea rows={2} maxLength={300} value={h.statement} onChange={e => set(i, { statement: e.target.value })} /></label>
            <label>How to test it<textarea rows={2} maxLength={400} value={h.test} onChange={e => set(i, { test: e.target.value })} /></label>
            <label>What would support or refute it<textarea rows={2} maxLength={400} value={h.success} onChange={e => set(i, { success: e.target.value })} /></label>
            <button type="button" className="btn small" onClick={() => setDraft(d => d && d.filter((_, j) => j !== i))}>Remove</button>
          </fieldset>)}
          <div className="session-action-buttons">
            {draft.length < MAX && <button type="button" className="btn small" onClick={() => setDraft(d => d && [...d, { id: `new${Date.now()}`, statement: "", test: "", success: "", status: "untested", evidence: [] }])}>Add a hypothesis</button>}
            <button type="button" className="btn small primary" disabled={busy || !draft.some(h => h.statement.trim())} onClick={() => { void save(); }}>Save hypotheses</button>
            <button type="button" className="btn small" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div> : <>
          <ul className="workshop-board">{detail.hypotheses.map(h => <li key={h.id} className="workshop-card"><strong>{h.id}</strong> <span className={`pr-chip ${TONE[h.status] ?? "idle"}`}>{STATUS[h.status] ?? h.status}</span>
            <p>{h.statement}</p>
            {h.test && <p className="hint"><b>Test:</b> {h.test}</p>}{h.success && <p className="hint"><b>Support or refute:</b> {h.success}</p>}
            {h.evidence.length > 0 && <p className="hint">Evidence: {h.evidence.join(", ")}</p>}
          </li>)}</ul>
          {detail.status === "ready" && <div className="session-action-buttons"><button type="button" className="btn small" onClick={() => setDraft(detail.hypotheses.map(h => ({ ...h })))}>Edit hypotheses</button></div>}
        </>}
        <h3>Experiments</h3>
        {!detail.experiments.length ? <p className="empty">No experiment recorded yet. A hypothesis can only be marked supported or refuted once an experiment is recorded for it.</p> : <table className="workshop-table"><thead><tr><th>Experiment</th><th>Hypothesis</th><th>What was done</th><th>Result</th><th>By</th></tr></thead><tbody>{detail.experiments.map(x => <tr key={x.id}><td>{x.id}</td><td>{x.hypothesisId}</td><td>{x.summary}</td><td>{x.metric ? `${x.metric}: ${x.value ?? ""}` : x.value ?? ""}</td><td>{x.by === "agent" ? "Agent (reported)" : "You"}</td></tr>)}</tbody></table>}
        {detail.repos.length > 0 && <><h3>Code to start from</h3><ul className="workshop-leads">{detail.repos.map(r => <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer noopener">{r.title}</a> <span className="hint">({r.meta}) a lead from the report: not run, not licence-checked</span></li>)}</ul></>}
        <h3>Code folder</h3>
        {!files.length ? <p className="empty">Empty. Files written in your IDE or agent appear here as soon as they are saved.</p> : <ul className="workshop-files">{files.map(f => <li key={f.path}><code>{f.path}</code> <span className="hint">{short(f.bytes)} · {formatDateTime(f.modified)}</span></li>)}</ul>}
        <h3>Progress</h3>
        {!detail.log?.length ? <p className="empty">Nothing yet.</p> : <ol className="workshop-log">{[...detail.log].reverse().map((l, i) => <li key={i}><span className="hint">{formatDateTime(l.at)} · {l.by}</span> {l.message}</li>)}</ol>}
      </>}
    </div>
  </section></div>;
}
