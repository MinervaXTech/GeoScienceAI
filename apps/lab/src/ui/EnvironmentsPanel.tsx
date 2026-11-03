import { useEffect, useState } from "react";
import { materializeRandom, type EnvGenerator } from "../domain/environment";
import { ORIGIN_LABEL, POLICY_CREATE, POLICY_PICK, type EnvPolicy, type EnvSummary } from "./paperRunUi";

/** The two things the user can leave to the agent: choosing from the library, and extending it or making a new environment. */
export function PolicyChoices({ policy, onChange }: { policy: EnvPolicy; onChange(next: EnvPolicy): void }) {
  return <fieldset className="pr-policy"><legend>Leave it to the agent</legend>
    <label className="pr-radio"><input type="checkbox" checked={policy.pick} onChange={e => onChange({ ...policy, pick: e.target.checked })} /> <span><strong>{POLICY_PICK}</strong> <span className="hint">The agent chooses which library maps to use. Ticked maps below are still used.</span></span></label>
    <label className="pr-radio"><input type="checkbox" checked={policy.create} onChange={e => onChange({ ...policy, create: e.target.checked })} /> <span><strong>{POLICY_CREATE}</strong> <span className="hint">The agent may add a new environment when none fits. It starts as a candidate you approve, and results on it are marked as not the paper's own.</span></span></label>
  </fieldset>;
}

const CELL = 8;
/** A small picture of a map: blocked cells in black, the start and goal marked, numbered targets, and any unplanned obstacles in pink. A generator shows its first random map. */
export function EnvPreview({ env, width = 220, seed }: { env: EnvSummary; width?: number; seed?: number }) {
  let ascii = env.ascii, note = "";
  if (!ascii && env.generator) { try { ascii = materializeRandom({ type: "random-obstacles", rows: env.rows, cols: env.cols, ...env.generator } as EnvGenerator, seed ?? env.generator.seedBase); note = `Seed ${seed ?? env.generator.seedBase}, one of ${env.generator.instances} maps`; } catch { note = "Could not draw a sample map"; } }
  if (!ascii) return <p className="hint">{note}</p>;
  const w = env.cols * CELL, h = env.rows * CELL;
  return <figure className="env-preview">
    <svg role="img" aria-label={`Preview of ${env.name}: ${env.rows} by ${env.cols} cells`} viewBox={`0 0 ${w} ${h}`} width={Math.min(w, width)} style={{ aspectRatio: `${w} / ${h}` }}>
      <rect width={w} height={h} fill="#f3f3f3" />
      {ascii.flatMap((row, r) => [...row].map((c, k) => c === "#" ? <rect key={`${r}-${k}`} x={k * CELL} y={r * CELL} width={CELL} height={CELL} fill="#111" /> : null))}
      {env.dynamicObstacles.map(([r, c], i) => <rect key={`d${i}`} x={(c - 0.5 + 0.5) * CELL - CELL / 2} y={(r + 0.5) * CELL - CELL / 2} width={CELL} height={CELL} fill="#ff9bf2" stroke="#b0309f" strokeWidth=".6" />)}
      {env.targets.length ? env.targets.map(([r, c], i) => <g key={`t${i}`}><circle cx={(c + 0.5) * CELL} cy={(r + 0.5) * CELL} r={CELL * 0.75} fill="#fff" stroke="#c9301a" strokeWidth="1" /><text x={(c + 0.5) * CELL} y={(r + 0.5) * CELL + 2.6} fontSize="7" textAnchor="middle" fill="#c9301a" fontWeight="700">{i + 1}</text></g>)
        : <>{env.start && <circle cx={(env.start[1] + 0.5) * CELL} cy={(env.start[0] + 0.5) * CELL} r={CELL * 0.6} fill="#1f77d0" />}{env.goal && <rect x={env.goal[1] * CELL + 1} y={env.goal[0] * CELL + 1} width={CELL - 2} height={CELL - 2} fill="#c9301a" />}</>}
    </svg>
    <figcaption className="hint">{note || `${env.rows}×${env.cols} cells`}{!env.targets.length && env.start ? " · blue start, red goal" : ""}</figcaption>
  </figure>;
}

const tone = (e: EnvSummary) => e.origin === "digitised" ? "digitised" : e.origin === "generated-from-parameters" ? "parameters" : e.origin === "generated-from-description" ? "description" : "other";
/** The shared library of environments: what each is, where it came from, and whether it is approved. Candidates made by Muse or an agent wait here for approval. */
export function EnvironmentsPanel({ environments, onChanged, chosen, onToggle, max = 5, policy, onPolicy }: { environments: EnvSummary[]; onChanged(): void; chosen?: string[]; onToggle?(id: string): void; max?: number; policy?: EnvPolicy; onPolicy?(next: EnvPolicy): void }) {
  const [open, setOpen] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirm, setConfirm] = useState<string | null>(null);
  const act = async (path: string, method: "POST" | "DELETE") => {
    if (busy) return; setBusy(true); setError("");
    try { const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) }); const d = await r.json(); if (!r.ok) throw Error(d.error ?? "That did not work."); setConfirm(null); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); }
  };
  const candidates = environments.filter(e => e.status === "candidate").length;
  return <section className="pr-envs" aria-label="Environment library">
    <h2>Environments <span className="hint">{environments.length} in the library{candidates ? ` · ${candidates} waiting for approval` : ""}</span></h2>
    {policy && onPolicy && <PolicyChoices policy={policy} onChange={onPolicy} />}
    {onToggle && <p className="hint">Tick the ones the next run should use (up to {max}). Leave all unticked unless the paper needs a specific map.</p>}
    <p className="hint">Worlds that runs reuse. A run can only count as the paper's own if the environment is the paper's own; anything made up is marked as assumed.</p>
    {!environments.length && <p className="empty">No environments yet. Agents add candidates here for you to approve.</p>}
    <ul>{environments.map(e => <li key={e.id} className={`pr-env ${e.status}`}>
      {onToggle && e.status === "approved" && <label className="pr-env-use"><input type="checkbox" checked={chosen?.includes(e.id) ?? false} disabled={!chosen?.includes(e.id) && (chosen?.length ?? 0) >= max} onChange={() => onToggle(e.id)} /> Use in the next run</label>}
      <button type="button" className="pr-env-head" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
        <strong>{e.name}</strong>
        <span className="pr-env-tags"><span className={`pr-origin ${tone(e)}`}>{ORIGIN_LABEL[e.origin] ?? e.origin}</span><span className={`pr-chip ${e.status === "approved" ? "ok" : "busy"}`}>{e.status === "approved" ? "Approved" : "Candidate"}</span>{!e.solvable && <span className="pr-chip bad">Failed checks</span>}</span>
      </button>
      {open === e.id && <div className="pr-env-body">
        <EnvPreview env={e} />
        <div className="pr-env-info">
          {e.description && <p>{e.description}</p>}
          <p className="hint"><strong>Source:</strong> {[e.source.paperTitle, e.source.figure].filter(Boolean).join(" · ") || "not a paper"}{e.source.paperTitle || e.source.figure ? ". " : ""}{e.source.note}</p>
          <p className="hint">{e.kind === "fixed" ? `A fixed ${e.rows}×${e.cols} map` : `${e.generator?.instances} random ${e.rows}×${e.cols} maps at ${Math.round((e.generator?.density ?? 0) * 100)}% obstacles`}{e.targets.length ? ` · route through ${e.targets.length} targets` : ""}{e.dynamicObstacles.length ? ` · ${e.dynamicObstacles.length} unplanned obstacles` : ""} · version {e.version}</p>
          {e.scale?.note && <p className="hint"><strong>Scale:</strong> {e.scale.note}</p>}
          {e.assumptions.length > 0 && <><strong className="hint">Assumed</strong><ul className="hint">{e.assumptions.map(a => <li key={a}>{a}</li>)}</ul></>}
          <p className="hint">Checks: {e.checkNotes.join(" ")}</p>
          <div className="session-action-buttons">
            {e.status === "candidate" && <button type="button" className="btn small primary" disabled={busy || !e.solvable} onClick={() => { void act(`/api/environments/${e.id}/approve`, "POST"); }}>Approve</button>}
            {confirm === e.id ? <><button type="button" className="btn small" disabled={busy} onClick={() => { void act(`/api/environments/${e.id}`, "DELETE"); }}>Yes, delete</button><button type="button" className="btn small" onClick={() => setConfirm(null)}>Keep</button></> : <button type="button" className="btn small" disabled={busy} onClick={() => setConfirm(e.id)}>Delete</button>}
          </div>
        </div>
      </div>}
    </li>)}</ul>
    {error && <p className="sam-error" role="alert">{error}</p>}
  </section>;
}

export interface MapChoice { id: string; name: string; basemap: string }
/** One list of every place to work in: real satellite maps first, then the simulated grid environments. Picking either switches the main area. */
export function EnvironmentsSidebar({ maps, currentMapId, viewing, onOpenMap, onView }: { maps: MapChoice[]; currentMapId: string; viewing: string | null; onOpenMap(id: string): void; onView(env: EnvSummary | null): void }) {
  const [list, setList] = useState<EnvSummary[] | null>(null), [error, setError] = useState(""), [kind, setKind] = useState("maps");
  useEffect(() => {
    let alive = true;
    fetch("/api/environments").then(r => r.ok ? r.json() : Promise.reject(Error("The library could not be loaded."))).then(d => { if (alive) setList(d.environments); }, e => { if (alive) setError(e instanceof Error ? e.message : "The library could not be loaded."); });
    return () => { alive = false; };
  }, []);
  const origins = [...new Set((list ?? []).map(e => e.origin))];
  const showMaps = kind === "all" || kind === "maps", shown = (list ?? []).filter(e => kind === "all" || kind === "simulated" || kind === e.origin);
  const showSim = kind !== "maps";
  return <div className="env-side">
    <label className="env-side-filter">Show <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Environment type">
      <option value="all">All environments</option>
      <option value="maps">Real maps (satellite)</option>
      <option value="simulated">All simulated</option>
      {origins.map(o => <option key={o} value={o}>{ORIGIN_LABEL[o] ?? o}</option>)}
    </select></label>
    {showMaps && <><h3 className="env-side-group">Real maps</h3>
    <ul className="env-side-list">{maps.map(m => {
      const active = !viewing && m.id === currentMapId;
      return <li key={m.id}><button type="button" className={`env-side-item${active ? " is-active" : ""}`} aria-pressed={active} onClick={() => { onView(null); onOpenMap(m.id); }}><strong>{m.name}</strong><span className="hint">Satellite · {m.basemap === "google" ? "Google" : "Esri"}</span></button></li>;
    })}</ul></>}
    {showSim && <><h3 className="env-side-group">Simulated environments</h3>
    {error ? <p className="sam-error" role="alert">{error}</p> : !list ? <p className="hint">Loading environments…</p> : !shown.length ? <p className="empty">None of this type yet. Agents and paper runs add them in the PaperRun tab.</p> :
      <ul className="env-side-list">{shown.map(e => <li key={e.id}>
        <button type="button" className={`env-side-item${viewing === e.id ? " is-active" : ""}`} aria-pressed={viewing === e.id} onClick={() => onView(e)}>
          <strong>{e.name}</strong>
          <span className="hint">{e.kind === "fixed" ? `${e.rows}×${e.cols}` : "random maps"} · {ORIGIN_LABEL[e.origin] ?? e.origin}{e.status === "candidate" ? " · candidate" : ""}</span>
        </button>
      </li>)}</ul>}</>}
  </div>;
}

/** A large view of one environment, laid over the map area so the map keeps its place underneath. */
export function EnvironmentViewer({ env, onClose }: { env: EnvSummary; onClose(): void }) {
  const [seed, setSeed] = useState(env.generator?.seedBase ?? 0);
  return <section className="env-viewer" aria-label={`Environment ${env.name}`}>
    <header><div><h2>{env.name}</h2><p className="hint">{ORIGIN_LABEL[env.origin] ?? env.origin} · {env.status === "approved" ? "Approved" : "Candidate"} · version {env.version}</p></div><button type="button" className="btn small" onClick={onClose}>Back to map</button></header>
    <div className="env-viewer-body">
      <EnvPreview env={env} width={640} seed={env.generator ? seed : undefined} />
      <div className="pr-env-info">
        {env.generator && <div className="session-action-buttons"><button type="button" className="btn small" onClick={() => setSeed(seed - 1)} disabled={seed <= env.generator.seedBase}>Previous map</button><button type="button" className="btn small" onClick={() => setSeed(seed + 1)} disabled={seed >= env.generator.seedBase + env.generator.instances - 1}>Next map</button></div>}
        {env.description && <p>{env.description}</p>}
        <p className="hint"><strong>Source:</strong> {[env.source.paperTitle, env.source.figure].filter(Boolean).join(" · ") || "not a paper"}{env.source.paperTitle || env.source.figure ? ". " : ""}{env.source.note}</p>
        {env.scale?.note && <p className="hint"><strong>Scale:</strong> {env.scale.note}</p>}
        {env.assumptions.length > 0 && <><strong className="hint">Assumed</strong><ul className="hint">{env.assumptions.map(a => <li key={a}>{a}</li>)}</ul></>}
        <p className="hint">Checks: {env.checkNotes.join(" ")}</p>
      </div>
    </div>
  </section>;
}
