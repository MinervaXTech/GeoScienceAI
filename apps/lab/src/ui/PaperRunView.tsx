import { CodeSourcesNote } from "./CodeSourcesNote";
import type { CodeSources } from "../domain/codeSources";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { KnowledgeEntry } from "../domain/knowledge";
import { assessReplication, RATING_RULES, ratingTone, replicationScore, type GapInfo } from "../domain/replicationScore";
import { ChatMarkdown } from "./ChatMarkdown";
import { SaveToKnowledge } from "./SaveToWiki";
import { EnvironmentsPanel, PolicyChoices } from "./EnvironmentsPanel";
import { formatDateTime } from "./format";
import { clock, filterRuns, filtersActive, mcpSnippets, NO_FILTERS, policyText, POLICY_CREATE, POLICY_PICK, repairsDone, RESULT_TEXT, RUN_ACTIVE, RUN_FINISHED, STALL_SECONDS, statusTone, STATUS_TEXT, TOKEN_CAPS, tokenShare, type EnvPolicy, type EnvSummary, type McpConfig, type RunFilters, type RunSummary, type WorkingRun } from "./paperRunUi";

interface Status { working?: WorkingRun[]; root: string; ready: boolean; problem: string | null; configured: boolean; mcp: McpConfig; running: string[] }
interface Detail { coverageStale?: boolean; codeSources?: CodeSources; gaps?: GapInfo[]; run: RunSummary; events: { at: string; kind: string; message: string }[]; files: { path: string; bytes: number }[]; report: string | null; active: boolean; directory: string }
const api = async (path: string, body?: unknown, signal?: AbortSignal) => { const response = await fetch(path, { ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), ...(signal ? { signal } : {}) }); const data = await response.json(); if (!response.ok) throw Error(data.error ?? "PaperRun request failed."); return data; };
/** Shows that a run is alive: the current step, how long it has been in it, and the latest log line, with a moving bar. Muse calls can be silent for a minute. */
function Activity({ run, events }: { run: RunSummary; events: { at: string; message: string }[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const stage = run.stages.find(s => s.status === "running"), last = events.at(-1), age = (iso?: string) => iso && Date.parse(iso) ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null;
  const inStep = age(stage?.startedAt ?? run.updatedAt), sinceEvent = age(last?.at);
  return <div className="pr-activity">
    <div className="pr-activity-bar" aria-hidden="true" />
    <p className="pr-activity-line"><strong role="status">{STATUS_TEXT[run.status] ?? run.status}{stage ? `: ${stage.name}` : ""}</strong>{inStep !== null && <span className="hint"> · {clock(inStep)} in this step</span>}<span className="hint"> · {clock(Math.max(0, Math.round((now - Date.parse(run.createdAt)) / 1000)))} since the run started</span></p>
    {last && <p className="hint">Latest: {last.message}{sinceEvent !== null ? ` (${clock(sinceEvent)} ago)` : ""}. A Muse reply can take a minute or more with nothing new to show.</p>}
    {sinceEvent !== null && sinceEvent > STALL_SECONDS && <p className="sam-error" role="alert">Nothing new for {Math.round(sinceEvent / 60)} minutes. It may be stuck, so consider cancelling it and trying again.</p>}
  </div>;
}
const SEGMENTS = [["match", "Match"], ["within_tolerance", "Within tolerance"], ["mismatch", "Mismatch"], ["not_comparable", "Not comparable"], ["not_run", "Not run"]] as const;
/** What ran and how far the paper was reproduced: two numbers (results near the paper's, method steps implemented), the split of statuses, and the main concerns. */
const originNote = (origin: string) => origin === "digitised" ? "the paper's own" : origin === "satellite" ? "satellite" : "assumed";
/** The environments a run uses, shown under its title, with a way to change them. Changes apply to the run's files and brief; the agent or the next test run picks them up. */
function RunEnvironments({ run, library, locked, busy, onApply }: { run: RunSummary; library: EnvSummary[]; locked: boolean; busy: boolean; onApply(ids: string[], policy: EnvPolicy): void }) {
  const used = run.environments ?? [], [editing, setEditing] = useState(false), [picked, setPicked] = useState<string[]>([]), [policy, setPolicy] = useState<EnvPolicy>({ pick: false, create: false });
  const options = [...library.filter(e => e.status === "approved").map(e => ({ id: e.id, name: e.name, note: `${e.kind === "fixed" ? `${e.rows}×${e.cols}` : "random maps"} · ${originNote(e.origin)}` })), ...used.filter(u => !library.some(e => e.id === u.id && e.status === "approved")).map(u => ({ id: u.id, name: u.name, note: `version ${u.version} · ${originNote(u.origin)}` }))];
  const open = () => { setPicked(used.map(e => e.id)); setPolicy(run.envPolicy ?? { pick: false, create: false }); setEditing(true); };
  const brief = [used.length ? `${used.length} attached` : "none attached", run.envPolicy?.pick ? "agent picks" : "", run.envPolicy?.create ? "may create" : ""].filter(Boolean).join(" · ");
  return <details className="pr-envs-used" aria-label="Run environments" open={editing || undefined}>
    <summary><strong>Environments</strong> <span className="hint">{brief}</span></summary>
    <div className="pr-envs-used-head">{!editing && <button type="button" className="btn small" disabled={locked || busy} title={locked ? "Change environments once the run has finished or the agent is idle." : undefined} onClick={open}>{used.length ? "Change" : "Add"}</button>}</div>
    {!editing && <div className="pr-env-cols"><div>
      <h4 className="pr-env-sub">Maps attached</h4>
      <ul className="pr-env-points">{used.length ? used.map(e => <li key={e.id}>{e.name} <span className="hint">· version {e.version} · {originNote(e.origin)}</span> {e.status === "candidate" && <span className="pr-chip busy" title="Not yet approved in the library">Candidate</span>}</li>) : <li className="hint">None</li>}</ul>
      </div><div>
      <h4 className="pr-env-sub">Left to the agent</h4>
      <ul className="pr-env-points">{run.envPolicy?.pick || run.envPolicy?.create ? <>{run.envPolicy.pick && <li>{POLICY_PICK}</li>}{run.envPolicy.create && <li>{POLICY_CREATE}</li>}</> : <li className="hint">Nothing</li>}</ul>
    </div></div>}
    {editing && <>
      <PolicyChoices policy={policy} onChange={setPolicy} />
      <p className="hint">Tick the ones this run should use (up to 5).</p>
      {options.length ? <ul className="pr-env-edit">{options.map(o => <li key={o.id}><label className="pr-radio"><input type="checkbox" checked={picked.includes(o.id)} disabled={!picked.includes(o.id) && picked.length >= 5} onChange={ev => setPicked(ev.target.checked ? [...picked, o.id] : picked.filter(x => x !== o.id))} /> <span>{o.name} <span className="hint">· {o.note}</span></span></label></li>)}</ul> : <p className="hint">No approved environments in the library yet.</p>}
      <div className="session-action-buttons"><button type="button" className="btn small primary" disabled={busy} onClick={() => { onApply(picked, policy); setEditing(false); }}>Apply</button><button type="button" className="btn small" onClick={() => setEditing(false)}>Cancel</button></div>
      <p className="hint">Removing one deletes its file from the run's code folder. Results already recorded stay as they are until the tests run again.</p>
    </>}
  </details>;
}

function SummaryCard({ coverageStale, connect, run, files, gaps, canAssess, canContinue, busy, onAssess, onContinue, onHandOver, onCopyNext }: { coverageStale?: boolean; connect?: ReactNode; run: RunSummary; files: number; gaps: GapInfo[]; canAssess: boolean; canContinue: boolean; busy: boolean; onAssess(): void; onContinue(rounds: number): void; onHandOver(): void; onCopyNext(text: string): void }) {
  const [rounds, setRounds] = useState(2);
  const results = run.results ?? [], total = results.length;
  const stepTotal = run.stepCount ?? (run.stepCoverage?.length ? Math.max(...run.stepCoverage.map(c => c.n)) : 0);
  const score = replicationScore(results, stepTotal, run.stepCoverage as never);
  const concerns = (run.review ?? "").split("\n").filter(Boolean), high = concerns.filter(l => l.startsWith("[high]"));
  const assessment = assessReplication({ results, stepCount: stepTotal, ...(run.stepCoverage ? { coverage: run.stepCoverage as never } : {}), gaps, concerns, ...(run.environments?.length ? { mapsAttached: run.environments.length } : {}) });
  const agentPrompt = `Work PaperRun ${run.id} using the paperrun tools. Start with paperrun_get_brief, then paperrun_list_files and paperrun_read_file to see the code that is already there. This paper has one code folder shared by all its external runs, so improve those files in place; do not create another run or a second implementation. Work the next steps below in order, run the tests with paperrun_run_tests after each change, and call paperrun_finish when done.\n\n${assessment.actions.map((a, i) => `${i + 1}. [${a.priority}] ${a.text}`).join("\n")}`;
  const nextText = `Next steps for PaperRun ${run.id} (${run.title}), rated "${assessment.label}":\n${assessment.actions.map((a, i) => `${i + 1}. [${a.priority}] ${a.text}`).join("\n")}`;
  return <section className="pr-summary" aria-label="Replication summary">
    <h3>Replication summary</h3>
    <p className="pr-ran">{run.mode === "muse" ? "Muse" : "An external agent"} wrote {files} file{files === 1 ? "" : "s"} and ran the tests {run.rounds.used} time{run.rounds.used === 1 ? "" : "s"}{run.mode === "muse" ? ` (${repairsDone(run)} repair round${repairsDone(run) === 1 ? "" : "s"})` : ""}{run.status === "done" ? "." : ` and is ${(STATUS_TEXT[run.status] ?? run.status).toLowerCase()}.`}</p>
    {!total ? <>
      <p className="hint">No results have been compared yet.</p>
      {run.mode === "external" && !RUN_FINISHED.has(run.status) && <><div className="session-action-buttons"><button type="button" className="btn small primary" onClick={() => onCopyNext(agentPrompt)}>Copy prompt for my agent</button></div><p className="hint">Paste it into your coding agent. It needs the paperrun MCP server registered once, see Connect your coding agent below. The brief it reads already holds the memory and next steps from the earlier runs.</p></>}
    </> : <>
      <div className="pr-verdict"><span className={`pr-chip ${ratingTone(assessment.rating)}`}>{assessment.label}</span> <details className="pr-rules"><summary>How this is rated</summary><ul>{RATING_RULES.map(r => <li key={r}>{r}</li>)}</ul></details></div>
      <div className="pr-scores">
        <div className="pr-score"><strong>{score.withinPercent}%</strong><span>of reported results within 10% of the paper ({score.counts.match + score.counts.within_tolerance} of {total})</span></div>
        <div className="pr-score"><strong>{score.steps.percent === null ? "?" : `${score.steps.percent}%`}</strong><span>{score.steps.percent === null ? "of the method implemented, not assessed yet" : `of the method implemented (${score.steps.implemented} of ${stepTotal} steps${score.steps.partial ? `, ${score.steps.partial} partly` : ""})`}</span></div>
      </div>
      <div className="pr-bar" role="img" aria-label={SEGMENTS.map(([key, label]) => `${score.counts[key]} ${label.toLowerCase()}`).join(", ")}>{SEGMENTS.map(([key]) => score.counts[key] ? <span key={key} className={`pr-seg ${key}`} style={{ flexGrow: score.counts[key] }} /> : null)}</div>
      <ul className="pr-legend">{SEGMENTS.map(([key, label]) => <li key={key}><span className={`pr-swatch ${key}`} aria-hidden="true" />{label} {score.counts[key]}</li>)}</ul>
      {coverageStale && <p className="hint">The code has changed since the method was last assessed, so the old coverage is not counted. Assess it again.</p>}
      <h4>Why</h4><ul className="pr-facts">{assessment.reasons.map(s => <li key={s}>{s}</li>)}</ul>
      {assessment.actions.length > 0 && <><h4>What to do next</h4><ol className="pr-actions">{assessment.actions.map((a, i) => <li key={i}><span className={`pr-prio ${a.priority}`}>{a.priority}</span> {a.text}</li>)}</ol></>}
      <div className="session-action-buttons">
        {canAssess && score.steps.percent === null && <button type="button" className="btn small" disabled={busy} onClick={onAssess}>Assess method coverage with Muse</button>}
        {canContinue && <><label className="pr-rounds">More repair rounds <select aria-label="More repair rounds" value={rounds} onChange={e => setRounds(Number(e.target.value))}>{[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}</select></label><button type="button" className="btn small primary" disabled={busy} onClick={() => onContinue(rounds)}>Continue repair with Muse</button></>}
        {canContinue && <button type="button" className="btn small" disabled={busy} onClick={onHandOver}>Continue in an external agent</button>}
        {run.mode === "external" && RUN_FINISHED.has(run.status) && <button type="button" className="btn small primary" disabled={busy} onClick={onHandOver}>Continue on the same code</button>}
        {run.mode === "external" && !RUN_FINISHED.has(run.status) && <button type="button" className="btn small primary" onClick={() => onCopyNext(agentPrompt)}>Copy prompt for my agent</button>}
        <button type="button" className="btn small" onClick={() => onCopyNext(nextText)}>Copy next steps</button>
      </div>
      {run.mode === "external" && RUN_FINISHED.has(run.status) && <p className="hint">This run is finished, so an agent cannot add to it. Continue on the same code starts a new run in the history with empty results, and it uses the same code folder: this paper has one code folder for all its external runs. Then copy the prompt for the new run. The agent needs the paperrun MCP server registered once; the setup is below.</p>}
      {run.mode === "external" && RUN_FINISHED.has(run.status) && connect}
      {canContinue && <p className="hint">Or hand it to Codex, Claude Code or Cursor: that makes a new run with Muse's code, results, review and these next steps copied in, so the agent carries on from here and can read the paper's figures. This run stays as it is.</p>}
      {canContinue && <p className="hint">Muse works on the weak steps and review concerns above, then reviews again. Adds {rounds} round{rounds === 1 ? "" : "s"} and 150,000 tokens to the cap (about 60,000 to 150,000 used).</p>}
      {canAssess && score.steps.percent === null && <p className="hint">Assessing reads the code against each spec step. About 20,000 tokens.</p>}
    </>}
    {high.length > 0 && <div className="pr-concerns"><strong>Main concerns from the review</strong><ul>{high.slice(0, 3).map(c => <li key={c}>{c.replace(/^\[high\]\s*/, "")}</li>)}</ul>{high.length > 3 && <p className="hint">{high.length - 3} more in the report.</p>}</div>}
    {run.stepCoverage?.length ? <details><summary>Step by step ({run.stepCoverage.filter(c => c.status === "implemented").length} implemented)</summary><ul className="pr-steps">{run.stepCoverage.map(c => <li key={c.n}><span className={`pr-chip ${c.status === "implemented" ? "ok" : c.status === "partial" ? "busy" : "bad"}`}>{c.status}</span> Step {c.n}{c.note ? `: ${c.note}` : ""}</li>)}</ul></details> : null}
  </section>;
}
/** Says plainly who is doing a run: Muse inside the app, or an outside coding agent over MCP. */
const ModeBadge = ({ mode }: { mode: "muse" | "external" }) => mode === "muse"
  ? <span className="pr-mode muse" title="Muse writes, runs and repairs this inside the app"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" fill="currentColor" /></svg>Muse</span>
  : <span className="pr-mode external" title="An outside coding agent works this run through the MCP server"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2 3h12v10H2zM4.5 6.5l2 1.5-2 1.5M8 10h3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>External agent</span>;
const Chip = ({ status, text }: { status: string; text: string }) => <span className={`pr-chip ${statusTone(status)}`}>{text}</span>;

/** The PaperRun workspace: start a reproduction run, watch it live, and read its report. Everything lives on disk under paperruns/. */
export function PaperRunView() {
  const [status, setStatus] = useState<Status | null>(null), [runs, setRuns] = useState<RunSummary[]>([]), [folders, setFolders] = useState<Record<string, { muse: number; external: number }>>({}), [memories, setMemories] = useState<Record<string, string>>({}), [papers, setPapers] = useState<KnowledgeEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<Detail | null>(null), [error, setError] = useState("");
  const [form, setForm] = useState({ paper: "", mode: "muse" as "muse" | "external", rounds: 4, tokenCap: 400000, model: "muse-wonder-1.0" }), [starting, setStarting] = useState(false);
  const [environments, setEnvironments] = useState<EnvSummary[]>([]), [showEnvs, setShowEnvs] = useState(false), [envPolicy, setEnvPolicy] = useState<EnvPolicy>({ pick: false, create: false }), [chosenEnvs, setChosenEnvs] = useState<string[]>([]), [filters, setFilters] = useState<RunFilters>(NO_FILTERS), [viewer, setViewer] = useState<{ path: string; content: string } | null>(null), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const looked = useRef(false), alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    try { const [s, r] = await Promise.all([api("/api/paperrun/status"), api("/api/paperrun")]); if (!alive.current) return; setStatus(s); setRuns(r.runs); if (!looked.current) { looked.current = true; const live = (s.working ?? [])[0]; if (live) setSelected(cur => cur ?? live.id); } setFolders(r.folders ?? {}); setMemories(r.memory ?? {}); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "PaperRun is unavailable."); }
  }, []);
  const loadEnvironments = useCallback(async () => { try { const d = await api("/api/environments"); if (alive.current) setEnvironments(d.environments); } catch { /* the library simply shows as empty */ } }, []);
  useEffect(() => { void loadEnvironments(); }, [loadEnvironments]);
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh(); }, 3000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { void fetch("/api/knowledge").then(r => r.json()).then(d => { if (alive.current && Array.isArray(d.entries)) { const stored = (d.entries as KnowledgeEntry[]).filter(e => e.status === "stored" && !e.origin); setPapers(stored); setForm(f => f.paper || !stored[0] ? f : { ...f, paper: stored[0].id }); } }).catch(() => {}); }, []);
  const loadDetail = useCallback(async (id: string) => { try { const d = await api(`/api/paperrun/${id}`); if (alive.current) { setDetail(d); setRuns(list => list.map(r => r.id === d.run.id ? d.run : r)); } } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Could not load the run."); } }, []);
  useEffect(() => { if (!selected) { setDetail(null); return; } setViewer(null); void loadDetail(selected); const timer = setInterval(() => { void loadDetail(selected); }, 2000); return () => clearInterval(timer); }, [selected, loadDetail]);

  const start = async () => {
    if (starting || !form.paper) return; setStarting(true); setError(""); setNotice("");
    try { const data = await api("/api/paperrun/start", { paper: form.paper, mode: form.mode, rounds: form.rounds, tokenCap: form.tokenCap, model: form.model, envPolicy, ...(chosenEnvs.length ? { environments: chosenEnvs } : {}) }); setSelected(data.run.id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "The run could not be started."); } finally { setStarting(false); }
  };
  const act = async (path: string, body: unknown = {}) => { if (busy) return; setBusy(true); setError(""); try { await api(path, body); if (selected) await loadDetail(selected); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); } };
  const open = async (path: string) => { if (!selected) return; try { const d = await api(`/api/paperrun/${selected}/file?path=${encodeURIComponent(path)}`); setViewer({ path, content: d.content }); } catch (e) { setError(e instanceof Error ? e.message : "Could not open the file."); } };
  const applyEnvironments = async (id: string, ids: string[], policy: EnvPolicy) => { if (busy) return; setBusy(true); setError(""); try { await api(`/api/paperrun/${id}/environments`, { environments: ids, policy }); await refresh(); setNotice("Environments updated."); } catch (e) { setError(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); } };
  const handOver = async (id: string) => { if (busy) return; setBusy(true); setError(""); try { const data = await api(`/api/paperrun/${id}/handover`, {}); await refresh(); setSelected(data.run.id); setNotice("Handed over. Register the MCP server below if you have not, then ask your agent to work this run."); } catch (e) { setError(e instanceof Error ? e.message : "The hand-over did not work."); } finally { setBusy(false); } };
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); setNotice(`${what} copied.`); } catch { setNotice("Clipboard unavailable."); } };
  const copyBrief = async () => { if (!selected) return; try { const d = await api(`/api/paperrun/${selected}/file?path=brief.md`); await copy(d.content, "Brief"); } catch (e) { setError(e instanceof Error ? e.message : "Could not read the brief."); } };

  const run = detail?.run, working = !!run && RUN_ACTIVE.has(run.status);
  const connectGuide = run && status ? (
          <details className="pr-external" open={!RUN_FINISHED.has(run.status) && run.status === "waiting_external" && !detail?.files.length}><summary>Connect your coding agent</summary>
          <p>Register the MCP server once, then tell your agent: <em>Work PaperRun {run.id} using the paperrun tools. Start with paperrun_get_brief.</em> Its files, test runs and notes appear here live.</p>
          {mcpSnippets(status.mcp).map(s => <div key={s.name} className="pr-snippet"><div className="pr-snippet-head"><strong>{s.name}</strong><button type="button" className="btn small" onClick={() => { void copy(s.text, `${s.name} command`); }}>Copy</button></div><pre>{s.text}</pre></div>)}
          <div className="session-action-buttons"><button type="button" className="btn small" onClick={() => { void copyBrief(); }}>Copy brief</button><span className="hint">Folder: {detail?.directory}</span></div>
          <p className="hint">The commands above follow each agent's usual syntax. If a flag differs in your version, use the JSON form or check its docs.</p></details>
  ) : null;
  const live = new Map((status?.working ?? []).map(w => [w.id, w.kind]));
  const label = (r: RunSummary) => live.get(r.id) === "agent" && r.status === "waiting_external" ? { status: "running", text: "Agent working" } : { status: r.status, text: STATUS_TEXT[r.status] ?? r.status };
  const shown = filterRuns(runs, filters);
  const threads = shown.reduce<{ paperId: string; title: string; runs: RunSummary[] }[]>((all, r) => { const found = all.find(t => t.paperId === r.paperId); if (found) found.runs.push(r); else all.push({ paperId: r.paperId, title: r.title, runs: [r] }); return all; }, []);
  return <div className="paperrun-frame"><section className="paperrun" aria-label="PaperRun">
    <div className="pr-side">
      <form className="pr-new" onSubmit={e => { e.preventDefault(); void start(); }}>
        <h2>New PaperRun</h2>
        {status && !status.ready && <p className="sam-error" role="alert">{status.problem}</p>}
        {status && !status.configured && <p className="hint">MODEL_API_KEY is not set, so only runs for an external agent can be prepared.</p>}
        {!papers.length ? <p className="empty">Store a paper in the Papers tab first.</p> : <>
          <label>Paper<select aria-label="Paper" value={form.paper} onChange={e => setForm({ ...form, paper: e.target.value })}>{papers.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
          <fieldset><legend>Who does the work</legend>
            <label className="pr-radio"><input type="radio" name="mode" checked={form.mode === "muse"} onChange={() => setForm({ ...form, mode: "muse" })} /> <span><strong>Muse, here</strong> writes the code, runs it in a sandbox on this Mac, and repairs it.</span></label>
            <label className="pr-radio"><input type="radio" name="mode" checked={form.mode === "external"} onChange={() => setForm({ ...form, mode: "external" })} /> <span><strong>An external agent</strong> (Codex, Claude Code, Cursor) works through this app's MCP server. Uses no Muse credits for the code.</span></label>
          </fieldset>
          {form.mode === "muse" && <>
            <label>Repair rounds<select aria-label="Repair rounds" value={form.rounds} onChange={e => setForm({ ...form, rounds: Number(e.target.value) })}>{[0, 1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}{n === 4 ? " (default)" : ""}</option>)}</select></label>
            <label>Token cap<select aria-label="Token cap" value={form.tokenCap} onChange={e => setForm({ ...form, tokenCap: Number(e.target.value) })}>{TOKEN_CAPS.map(n => <option key={n} value={n}>{n.toLocaleString("en")}{n === 400000 ? " (default)" : ""}</option>)}</select></label>
          </>}
          {environments.length > 0 && <button type="button" className="btn pr-env-button" aria-pressed={showEnvs} onClick={() => setShowEnvs(!showEnvs)}>Environments <span className="hint">{policyText(envPolicy, chosenEnvs.length)}</span></button>}
          <label>Muse model{form.mode === "external" ? " (for the spec)" : ""}<select aria-label="Muse model" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}><option value="muse-wonder-1.0">Wonder 1.0 (recommended)</option><option value="muse-spark-1.3">Spark 1.3 (cheaper)</option></select></label>
          <button type="submit" className="btn primary" disabled={starting || !form.paper || (form.mode === "muse" && !!status && (!status.ready || !status.configured))}>{starting ? "Starting…" : form.mode === "muse" ? "Start PaperRun" : "Prepare run for an agent"}</button>
          {starting && <p className="hint" role="status">Building the reproduction spec first if it is not saved yet. This can take a minute.</p>}
        </>}
        {error && <p className="sam-error" role="alert">{error}</p>}
      </form>
      <div className="pr-runs"><h2>Runs</h2>
        {runs.length > 0 && <div className="pr-filters" role="search" aria-label="Filter runs">
          <input type="search" aria-label="Search runs" placeholder="Search by name or id" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} />
          <div className="pr-filter-row">
            <select aria-label="Run type" value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value as RunFilters["type"] })}><option value="all">All runs</option><option value="muse">Muse only</option><option value="external">External agent only</option></select>
            <select aria-label="Run date" value={filters.range} disabled={!!filters.day} onChange={e => setFilters({ ...filters, range: e.target.value as RunFilters["range"] })}><option value="all">Any date</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select>
          </div>
          <label className="pr-day">On this day<input type="date" aria-label="Run on date" value={filters.day} onChange={e => setFilters({ ...filters, day: e.target.value })} /></label>
          <p className="hint" role="status">Showing {shown.length} of {runs.length}{filtersActive(filters) && <> · <button type="button" className="linklike" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button></>}</p>
        </div>}
        {!runs.length && <p className="empty">No runs yet.</p>}
        {runs.length > 0 && !shown.length && <p className="empty">No runs match these filters.</p>}
        {threads.map(t => <section key={t.paperId} className="pr-thread" aria-label={`Replication of ${t.title}`}>
          <header><strong>{t.title}</strong><span className="pr-thread-folders"><span className="pr-chip" title="One code folder for every Muse run of this paper">Muse code · {folders[t.paperId]?.muse ?? 0} files</span><span className="pr-chip" title="One code folder for every external agent run of this paper">External agent code · {folders[t.paperId]?.external ?? 0} files</span></span><span className="hint">{t.runs.length} run{t.runs.length === 1 ? "" : "s"}</span>{memories[t.paperId] && <details className="pr-memory"><summary>Memory for the next run <span className="hint">· {memories[t.paperId]!.length.toLocaleString("en")} characters, kept short</span></summary><pre>{memories[t.paperId]}</pre></details>}</header>
          <ul>{t.runs.map(r => <li key={r.id}><button type="button" className={`pr-run ${r.mode}${selected === r.id ? " selected" : ""}`} aria-pressed={selected === r.id} aria-label={`${r.title}, ${r.mode === "muse" ? "Muse" : "External agent"} run started ${formatDateTime(r.createdAt)}`} onClick={() => { setSelected(r.id); setShowEnvs(false); }}><span className="pr-run-top"><ModeBadge mode={r.mode} /><Chip status={label(r).status} text={label(r).text} /></span><strong>{formatDateTime(r.createdAt)}</strong>{r.parentId && <span className="hint">continues an earlier run</span>}{r.summary && <span className="hint">{r.summary}</span>}</button></li>)}</ul>
        </section>)}
      </div>
    </div>
    <div className="pr-main">
      {showEnvs ? <>
        <button type="button" className="btn small" onClick={() => setShowEnvs(false)}>Back to runs</button>
        <EnvironmentsPanel environments={environments} onChanged={() => { void loadEnvironments(); }} policy={envPolicy} onPolicy={setEnvPolicy} chosen={chosenEnvs} onToggle={id => setChosenEnvs(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id])} />
      </> : !run ? <p className="empty">Select a run, or start a new one.</p> : <>
        <header className="pr-head"><div><h2>{run.title}</h2><p className="hint"><ModeBadge mode={run.mode} /> {run.mode === "muse" ? `(${run.model})` : ""} · started {formatDateTime(run.createdAt)}{run.parentId && <> · continues <button type="button" className="linklike" onClick={() => setSelected(run.parentId ?? null)}>an earlier run</button></>}</p></div><Chip status={label(run).status} text={label(run).text} /></header>
        {run.error && <p className="sam-error" role="alert">{run.error}</p>}
        <CodeSourcesNote sources={detail?.codeSources} />
        <RunEnvironments run={run} library={environments} locked={!!working || !!detail?.active || (run.mode === "muse" && !RUN_FINISHED.has(run.status))} busy={busy} onApply={(ids, policy) => { void applyEnvironments(run.id, ids, policy); }} />
        {(working || detail?.active) && <Activity run={run} events={detail?.events ?? []} />}
        {run.mode === "muse" && <div className="pr-meter"><span>Repair rounds {repairsDone(run)} of {run.rounds.max}</span><span>Tokens {run.tokens.used.toLocaleString("en")} of {run.tokens.cap.toLocaleString("en")}</span><progress max={100} value={tokenShare(run.tokens)} aria-label="Token use" /></div>}
        <div className="session-action-buttons">
          {(working || detail?.active) && <button type="button" className="btn small" disabled={busy} onClick={() => { void act(`/api/paperrun/${run.id}/cancel`); }}>Cancel run</button>}
          {run.mode === "external" && !RUN_FINISHED.has(run.status) && <><button type="button" className="btn small" disabled={busy || working} onClick={() => { void act(`/api/paperrun/${run.id}/run-tests`); }}>Run tests now</button><button type="button" className="btn small" disabled={busy || working} onClick={() => { void act(`/api/paperrun/${run.id}/finish`, { summary: "Finished from the app." }); }}>Finish run</button></>}
          {detail?.report && <button type="button" className="btn small primary" onClick={() => { window.dispatchEvent(new CustomEvent("lab-save-note", { detail: { entryId: run.paperId, paperTitle: run.title, label: "PaperRun", title: `PaperRun report: ${run.title}`.slice(0, 120), body: detail.report } })); setNotice("Report saved to Notes."); }}>Save report to Notes</button>}
          {detail?.report && RUN_FINISHED.has(run.status) && <SaveToKnowledge kind="replication" id={run.id} />}
        </div>
        {notice && <p className="hint" role="status">{notice}</p>}
        {run.mode === "external" && status && !RUN_FINISHED.has(run.status) && connectGuide}
        <SummaryCard connect={run.mode === "external" && RUN_FINISHED.has(run.status) ? connectGuide : null} run={detail?.coverageStale ? { ...run, stepCoverage: undefined } : run} coverageStale={!!detail?.coverageStale} files={detail?.files.length ?? 0} gaps={detail?.gaps ?? []} canAssess={!!status?.configured && !working && !!detail?.files.length} canContinue={run.mode === "muse" && RUN_FINISHED.has(run.status) && !!status?.configured && !!status?.ready && !!detail?.files.length} busy={busy} onAssess={() => { void act(`/api/paperrun/${run.id}/assess`); }} onContinue={rounds => { void act(`/api/paperrun/${run.id}/continue`, { rounds }); }} onHandOver={() => { void handOver(run.id); }} onCopyNext={text => { void copy(text, "Next steps"); }} />
        <h3>Stages</h3>
        <ol className="pr-stages">{run.stages.map(s => <li key={s.name} className={`pr-stage ${s.status}`}><span className="pr-dot" aria-hidden="true" /><span><strong>{s.name}</strong> <span className="hint">{s.status}{s.note ? ` · ${s.note}` : ""}</span></span></li>)}</ol>
        {run.results && <><h3>Results against the paper</h3><div className="pr-table"><table><thead><tr><th>ID</th><th>What</th><th>Reported</th><th>Reproduced</th><th>Error</th><th>Status</th></tr></thead>{run.results.map(r => <tbody key={r.id}><tr><td>{r.id}</td><td>{r.description}</td><td>{r.reported}</td><td>{r.reproduced || "none"}</td><td>{r.relError === undefined ? "" : `${(r.relError * 100).toFixed(1)}%`}</td><td><Chip status={r.status} text={RESULT_TEXT[r.status] ?? r.status} /></td></tr>{r.note && <tr className="pr-note"><td /><td colSpan={5}>{r.note}</td></tr>}</tbody>)}</table></div><p className="hint">Statuses are computed by the app from the number the code produced and the number the paper reports.</p></>}
        {detail?.report && <><h3>Report</h3><ChatMarkdown text={detail.report} /></>}
        <h3>Files</h3>
        {run.mode === "external" && <p className="hint">One code folder for this paper, shared by all its external runs. Each run keeps its own results, rounds and report.</p>}
        {detail && !detail.files.length ? <p className="empty">No code yet.</p> : <ul className="pr-files">{detail?.files.map(f => <li key={f.path}><button type="button" className="linklike" onClick={() => { void open(`code/${f.path}`); }}>{f.path}</button> <span className="hint">{f.bytes} bytes</span></li>)}{detail && detail.run.rounds.used > 0 && Array.from({ length: detail.run.rounds.used }, (_, i) => <li key={i}><span className="hint">Round {i + 1} output:</span> <button type="button" className="linklike" onClick={() => { void open(`rounds/${i + 1}/stdout.txt`); }}>stdout</button> <button type="button" className="linklike" onClick={() => { void open(`rounds/${i + 1}/stderr.txt`); }}>stderr</button></li>)}</ul>}
        {viewer && <div className="pr-viewer"><div className="pr-snippet-head"><strong>{viewer.path}</strong><button type="button" className="btn small" onClick={() => setViewer(null)}>Close</button></div><pre>{viewer.content || "(empty)"}</pre></div>}
        <h3>Log</h3>
        <ol className="pr-log" aria-label="Run log">{[...(detail?.events ?? [])].reverse().map((e, i) => <li key={i}><span className="hint">{e.at ? new Date(e.at).toLocaleTimeString() : ""}</span> <span className={`pr-kind ${e.kind}`}>{e.kind}</span> {e.message}</li>)}</ol>
      </>}
    </div>
  </section></div>;
}
