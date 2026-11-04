import { createHash, randomBytes } from "node:crypto";
import { appendFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, relative } from "node:path";
import { codexPrompt, replicationMarkdown, type ReplicationSpec, type SpecMeta } from "./knowledgeReplication.ts";
import { runSandboxed } from "./paperrunSandbox.ts";
import type { StepCoverage } from "../src/domain/replicationScore.ts";
import { materializeEnvironment, ORIGIN_TEXT } from "../src/domain/environment.ts";
import { getEnvironment } from "./environments.ts";

export type RunMode = "muse" | "external";
export type RunStatus = "queued" | "specifying" | "coding" | "running" | "repairing" | "reviewing" | "reporting" | "done" | "failed" | "cancelled" | "waiting_external";
export type ResultStatus = "match" | "within_tolerance" | "mismatch" | "not_comparable" | "not_run";
export interface ResultRow { id: string; description: string; reported: string; reproduced: string; relError?: number; tolerance: number; status: ResultStatus; note: string }
export interface RunStage { name: string; status: "pending" | "running" | "done" | "failed" | "skipped"; startedAt?: string; endedAt?: string; note?: string }
export interface RunRecord {
  id: string; paperId: string; title: string; mode: RunMode; status: RunStatus; createdAt: string; updatedAt: string; model: string;
  rounds: { max: number; used: number; repairs?: number }; tokens: { cap: number; used: number };
  stages: RunStage[]; assumptions: { gapId: string; decision: "accepted" | "changed"; proposal: string }[];
  results?: ResultRow[]; summary?: string; error?: string; review?: string; stepCoverage?: StepCoverage[]; stepCount?: number; parentId?: string; environments?: AttachedEnvironment[]; envPolicy?: EnvPolicy; createdEnvironments?: string[]; finishNote?: string;
  /** Method coverage is a judgement about the code, so it records which code it judged: a fingerprint of the Python files, and the run that judged it. */
  coverageCode?: string; coverageFrom?: string;
}
/** What the user allows the agent to do about environments: pick from the library by its own judgement, and extend the library or create a new one (as a candidate that needs approval). */
export interface EnvPolicy { pick: boolean; create: boolean }
export const parsePolicy = (v: unknown): EnvPolicy | null => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every(k => k === "pick" || k === "create") && typeof (v as EnvPolicy).pick === "boolean" && typeof (v as EnvPolicy).create === "boolean" ? { pick: (v as EnvPolicy).pick, create: (v as EnvPolicy).create } : null;
export interface AttachedEnvironment { id: string; name: string; version: number; hash: string; status: "candidate" | "approved"; origin: string; kind: "fixed" | "instances"; rows: number; cols: number; instances?: number; source: string; file: string }
export interface RunEvent { at: string; kind: string; message: string }

export const RUN_ID = /^run-[0-9]{14}-[a-f0-9]{4}$/;
export const RESULTS_FILE = "results.json";
export const TEST_ENTRY = "run_tests.py";
export const MAX_FILE_BYTES = 200_000;
export const MAX_FILES = 40;
const CODE_EXTENSIONS = new Set([".py", ".txt", ".md", ".json", ".csv"]);
const STAGES = ["Spec and assumptions", "Write code", "Run tests", "Repair", "Review", "Report"];

const BUSY: RunStatus[] = ["queued", "specifying", "coding", "running", "repairing", "reviewing", "reporting"];
export interface Working { id: string; title: string; kind: "muse" | "agent"; status: RunStatus }
/** How recently an external agent must have touched a run for it to count as working. Agents act in bursts, with pauses while they think. */
export const AGENT_FRESH_MS = 3 * 60_000;
/** A run is working when Muse is driving it, or when an external agent has written, logged or tested within the last few minutes. */
export async function workingRuns(root: string, now = Date.now(), freshMs = AGENT_FRESH_MS): Promise<Working[]> {
  const out: Working[] = [];
  for (const run of await listRuns(root)) {
    if (run.mode === "muse") { if (BUSY.includes(run.status)) out.push({ id: run.id, title: run.title, kind: "muse", status: run.status }); continue; }
    if (["done", "failed", "cancelled"].includes(run.status)) continue;
    const touched = Math.max(Date.parse(run.updatedAt) || 0, (await stat(join(runDirectory(root, run.id), "events.jsonl")).catch(() => null))?.mtimeMs ?? 0);
    if (run.status === "running" || now - touched < freshMs) out.push({ id: run.id, title: run.title, kind: "agent", status: run.status });
  }
  return out;
}

export const validRunId = (id: unknown): id is string => typeof id === "string" && RUN_ID.test(id);
export const runDirectory = (root: string, id: string) => { if (!validRunId(id)) throw Error("Invalid run id."); return join(root, id); };
const stamp = (now: Date) => now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);

async function atomic(path: string, value: unknown) { const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`; await writeFile(tmp, typeof value === "string" ? value : JSON.stringify(value, null, 2)); await rename(tmp, path); }

/** The contract every implementation follows, for Muse and for external agents alike. */
export const contractText = `RESULTS CONTRACT
- Put the implementation in .py files inside the code folder, and a script named ${TEST_ENTRY} that runs it.
- ${TEST_ENTRY} must write ${RESULTS_FILE} in the code folder: {"results": [{"id": "R1", "reproduced": 23, "unit": "iterations", "comparable": true, "note": "how it was measured"}]} with one entry per reported result id (R1, R2, ...) it can measure. "reproduced" is the number your code actually computed.
- Set "comparable": false whenever the measurement used data, maps, layouts, hardware, settings or a metric definition that differs from the paper's (the gaps in the spec list these). The app then reports that result as not comparable instead of judging the number. Say plainly in the note what differed.
- The app decides match (within 2% of the paper's number) or within tolerance (within 10%) itself. You may add a stricter "tolerance" (0 to 0.1), but a looser one is capped at 0.1, so do not try to widen it.
- Never write a reported value in as a reproduced one. Do not hardcode results. The app compares your number with the paper's and decides match, within tolerance, or mismatch itself.
- Only Python standard library, numpy, scipy, matplotlib and pandas are available. There is no network. The script must finish within 10 minutes and write files only inside the code folder.
- Use fixed random seeds and say which in the note.`;

/**
 * One replication of a paper has at most two code folders: one for Muse and one for external agents. Every run of that kind sees its folder as its own `code`,
 * while its results, rounds, events and report stay in its own run folder.
 */
export function sharedCodeDir(root: string, paperId: string, mode: RunMode = "external"): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(paperId)) throw Error("Invalid paper id.");
  return join(root, mode === "muse" ? "_code-muse" : "_code", paperId);
}
export async function linkSharedCode(root: string, runId: string, paperId: string, mode: RunMode = "external"): Promise<void> {
  const shared = sharedCodeDir(root, paperId, mode), link = join(runDirectory(root, runId), "code");
  await mkdir(shared, { recursive: true });
  await symlink(relative(dirname(link), shared), link, "dir");
}
/**
 * Brings runs made before the shared folder existed into line. The newest external run of a paper donates its code folder as the shared one;
 * an older run's own folder is renamed to code-before-shared, not deleted, and the run then points at the shared folder.
 */
export async function migrateSharedCode(root: string): Promise<void> {
  for (const run of await listRuns(root)) {
    const link = join(runDirectory(root, run.id), "code"), info = await lstat(link).catch(() => null);
    if (!info || info.isSymbolicLink() || !info.isDirectory()) continue;
    const shared = sharedCodeDir(root, run.paperId, run.mode), existing = await readdir(shared).catch(() => [] as string[]);
    if (!existing.length) { await mkdir(dirname(shared), { recursive: true }); await rm(shared, { recursive: true, force: true }); await rename(link, shared); }
    else await rename(link, join(runDirectory(root, run.id), "code-before-shared"));
    await linkSharedCode(root, run.id, run.paperId, run.mode);
    await appendEvent(root, run.id, "shared-code", existing.length ? "This run now uses the replication's one shared code folder. Its own earlier code was kept in code-before-shared." : "This run's code became the replication's one shared code folder.");
  }
}
/** Whether another external run of the same paper still lists this environment, so its file must stay in the shared folder. */
async function environmentUsedElsewhere(root: string, run: RunRecord, envId: string): Promise<boolean> {
  return (await listRuns(root)).some(r => r.id !== run.id && r.mode === run.mode && r.paperId === run.paperId && (r.environments ?? []).some(e => e.id === envId));
}

export interface CreateRunInput { paperId: string; title: string; mode: RunMode; model: string; maxRounds: number; tokenCap: number; spec: ReplicationSpec; meta: SpecMeta; python?: string }
/** Creates a run folder holding the spec, the brief for an external agent, and an empty code folder. Nothing is ever overwritten. */
export async function createRun(root: string, input: CreateRunInput, now = new Date()): Promise<RunRecord> {
  const id = `run-${stamp(now)}-${randomBytes(2).toString("hex")}`, dir = runDirectory(root, id);
  await mkdir(dir, { recursive: true }); await mkdir(join(dir, "rounds"), { recursive: true });
  await linkSharedCode(root, id, input.paperId, input.mode);
  const at = now.toISOString();
  const record: RunRecord = {
    id, paperId: input.paperId, title: input.title, mode: input.mode, status: input.mode === "external" ? "waiting_external" : "queued", createdAt: at, updatedAt: at, model: input.model,
    rounds: { max: Math.max(0, Math.min(6, Math.round(input.maxRounds))), used: 0, repairs: 0 }, tokens: { cap: Math.max(50_000, Math.min(2_000_000, Math.round(input.tokenCap))), used: 0 },
    stepCount: input.spec.steps.length, stages: STAGES.map(name => ({ name, status: "pending" as const })),
    assumptions: input.spec.gaps.map(g => ({ gapId: g.id, decision: "accepted" as const, proposal: g.assumption.proposal })),
  };
  await atomic(join(dir, "spec.json"), { spec: input.spec, meta: input.meta });
  await atomic(join(dir, "spec.md"), replicationMarkdown(input.spec, input.meta));
  await atomic(join(dir, "brief.md"), `${codexPrompt(input.spec, input.meta, "run code folder")}\n\n${contractText}\n`);
  await atomic(join(dir, "run.json"), record); await writeFile(join(dir, "events.jsonl"), "");
  await appendEvent(root, id, "created", `${input.mode === "external" ? "Prepared for an external agent" : "Started with Muse"} (${record.rounds.max} repair rounds, ${record.tokens.cap} token cap).`, now);
  return record;
}
export async function readRun(root: string, id: string): Promise<RunRecord> { return JSON.parse(await readFile(join(runDirectory(root, id), "run.json"), "utf8")); }
export async function readSpec(root: string, id: string): Promise<{ spec: ReplicationSpec; meta: SpecMeta }> { return JSON.parse(await readFile(join(runDirectory(root, id), "spec.json"), "utf8")); }
export async function listRuns(root: string): Promise<RunRecord[]> {
  const names = await readdir(root).catch(() => [] as string[]), out: RunRecord[] = [];
  for (const name of names) if (validRunId(name)) { try { out.push(await readRun(root, name)); } catch { /* an incomplete folder is skipped */ } }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
const writing = new Map<string, Promise<unknown>>();
/** Serialises updates per run so the pipeline, the UI and an external agent never overwrite each other. */
export async function updateRun(root: string, id: string, change: (run: RunRecord) => void, now = new Date()): Promise<RunRecord> {
  const previous = writing.get(id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => { const run = await readRun(root, id); change(run); run.updatedAt = now.toISOString(); await atomic(join(runDirectory(root, id), "run.json"), run); return run; });
  writing.set(id, next); try { return await next; } finally { if (writing.get(id) === next) writing.delete(id); }
}
export async function appendEvent(root: string, id: string, kind: string, message: string, now = new Date()) { await appendFile(join(runDirectory(root, id), "events.jsonl"), `${JSON.stringify({ at: now.toISOString(), kind, message: message.slice(0, 2000) })}\n`); }
export async function readEvents(root: string, id: string, limit = 200): Promise<RunEvent[]> {
  const raw = await readFile(join(runDirectory(root, id), "events.jsonl"), "utf8").catch(() => "");
  return raw.split("\n").filter(Boolean).slice(-limit).map(line => { try { return JSON.parse(line) as RunEvent; } catch { return { at: "", kind: "invalid", message: line.slice(0, 200) }; } });
}
export async function setStage(root: string, id: string, name: string, status: RunStage["status"], note?: string) {
  await updateRun(root, id, run => { const stage = run.stages.find(s => s.name === name); if (!stage) return; const now = new Date().toISOString(); if (status === "running") stage.startedAt = now; if (status === "done" || status === "failed" || status === "skipped") stage.endedAt = now; stage.status = status; if (note !== undefined) stage.note = note.slice(0, 300); });
}

/** A path inside a run's code folder, or an error. Absolute paths, parent hops, hidden files and odd extensions are refused. */
export function codePath(root: string, id: string, relative: string): string {
  if (typeof relative !== "string" || !relative || relative.length > 120 || relative.includes("\\") || relative.includes("\0") || relative.startsWith("/")) throw Error("Use a relative file path inside the code folder.");
  const clean = normalize(relative);
  if (clean.startsWith("..") || clean.split("/").some(part => part === ".." || part.startsWith("."))) throw Error("Paths may not leave the code folder or be hidden.");
  const extension = clean.slice(clean.lastIndexOf(".")).toLowerCase();
  if (!CODE_EXTENSIONS.has(extension) || !clean.includes(".")) throw Error("Only .py, .txt, .md, .json and .csv files can be written.");
  return join(runDirectory(root, id), "code", clean);
}
export async function listCodeFiles(root: string, id: string): Promise<{ path: string; bytes: number }[]> {
  const base = join(runDirectory(root, id), "code"), out: { path: string; bytes: number }[] = [];
  const walk = async (dir: string, prefix: string) => { for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) { if (entry.name.startsWith(".") || entry.name === "__pycache__") continue; const rel = prefix ? `${prefix}/${entry.name}` : entry.name; if (entry.isDirectory()) await walk(join(dir, entry.name), rel); else if (entry.isFile()) out.push({ path: rel, bytes: (await stat(join(dir, entry.name))).size }); } };
  await walk(base, ""); return out.sort((a, b) => a.path.localeCompare(b.path));
}
/** A short fingerprint of the method code (the Python files). Notes, audits and data files do not change what the method is. */
export async function codeFingerprint(root: string, id: string): Promise<string> {
  const hash = createHash("sha256");
  for (const f of (await listCodeFiles(root, id)).filter(x => x.path.endsWith(".py") && x.path !== RESULTS_FILE)) hash.update(`${f.path}\0${await readCodeFile(root, id, f.path).catch(() => "")}\0`);
  return hash.digest("hex").slice(0, 16);
}
/** The run's method coverage while it still describes the code, or undefined once the code has changed since it was assessed. A coverage with no recorded code is trusted, as runs made before this check existed. */
export async function currentCoverage(root: string, run: RunRecord): Promise<StepCoverage[] | undefined> {
  if (!run.stepCoverage?.length) return undefined;
  if (run.coverageCode && run.coverageCode !== await codeFingerprint(root, run.id)) return undefined;
  return run.stepCoverage;
}
export async function writeCodeFile(root: string, id: string, relative: string, content: string) {
  if (typeof content !== "string" || Buffer.byteLength(content) > MAX_FILE_BYTES) throw Error(`A file may be at most ${MAX_FILE_BYTES} bytes.`);
  const path = codePath(root, id, relative);
  if (relative === RESULTS_FILE) throw Error(`${RESULTS_FILE} is written by ${TEST_ENTRY}, not by hand.`);
  const existing = await listCodeFiles(root, id); if (existing.length >= MAX_FILES && !existing.some(f => f.path === normalize(relative))) throw Error(`A run may hold at most ${MAX_FILES} files.`);
  await mkdir(dirname(path), { recursive: true }); await atomic(path, content);
}
export async function readCodeFile(root: string, id: string, relative: string): Promise<string> {
  const path = relative === RESULTS_FILE ? join(runDirectory(root, id), "code", RESULTS_FILE) : codePath(root, id, relative);
  return (await readFile(path, "utf8")).slice(0, MAX_FILE_BYTES);
}

const NUMBER = /[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/;
/** The first number in a printed value such as "23rd iteration" or "94.64%". */
export function numberIn(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = NUMBER.exec(value.replace(/,(?=\d{3}\b)/g, "")); const n = match ? Number(match[0]) : NaN; return Number.isFinite(n) ? n : undefined;
}
export const MATCH_TOLERANCE = 0.02;
/** The loosest relative error the app ever accepts; code may ask for stricter but never looser. */
export const TOLERANCE_CAP = 0.1;
/** The app, not the model, decides each status from the reported number and the number the code produced. */
export function compareResults(reported: { description: string; value: string }[], raw: unknown): ResultRow[] {
  const entries = new Map<string, Record<string, unknown>>();
  const list = raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results) ? (raw as { results: unknown[] }).results : [];
  for (const entry of list) if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") entries.set((entry as { id: string }).id.trim().toUpperCase(), entry as Record<string, unknown>);
  return reported.map((r, index) => {
    const id = `R${index + 1}`, entry = entries.get(id), base = { id, description: r.description, reported: r.value };
    if (!entry) return { ...base, reproduced: "", tolerance: 0, status: "not_run" as const, note: "No result was written for this item." };
    const declared = typeof entry.tolerance === "number" && Number.isFinite(entry.tolerance) ? entry.tolerance : TOLERANCE_CAP, tolerance = Math.min(TOLERANCE_CAP, Math.max(0, declared));
    const reproducedText = `${typeof entry.reproduced === "number" || typeof entry.reproduced === "string" ? String(entry.reproduced) : ""}${typeof entry.unit === "string" && entry.unit ? ` ${entry.unit}` : ""}`.trim().slice(0, 120);
    const note = `${typeof entry.note === "string" ? entry.note.slice(0, 380) : ""}${declared > TOLERANCE_CAP ? ` [declared tolerance ${declared} capped to ${TOLERANCE_CAP}]` : ""}`.trim();
    const a = numberIn(r.value), b = numberIn(entry.reproduced);
    if (a === undefined || b === undefined) return { ...base, reproduced: reproducedText, tolerance, status: "not_comparable" as const, note };
    const relError = a === 0 ? Math.abs(b) : Math.abs(b - a) / Math.abs(a), shown = Math.round(relError * 10000) / 10000;
    if (entry.comparable === false) return { ...base, reproduced: reproducedText, relError: shown, tolerance, status: "not_comparable" as const, note: `Measured on different data or settings than the paper's. ${note}`.trim() };
    return { ...base, reproduced: reproducedText, relError: shown, tolerance, status: relError <= MATCH_TOLERANCE ? "match" as const : relError <= tolerance ? "within_tolerance" as const : "mismatch" as const, note };
  });
}
export function summarise(rows: ResultRow[]): Record<ResultStatus, number> { const out: Record<ResultStatus, number> = { match: 0, within_tolerance: 0, mismatch: 0, not_comparable: 0, not_run: 0 }; for (const r of rows) out[r.status]++; return out; }

export interface RoundOutcome { round: number; code: number | null; timedOut: boolean; stdout: string; stderr: string; rows: ResultRow[]; ranTests: boolean; error?: string }
/** Runs the test script in the sandbox, stores the round's logs and results, and returns the compared results. */
export async function runTests(root: string, id: string, round: number, python: string, signal?: AbortSignal, timeoutMs = 600_000): Promise<RoundOutcome> {
  const dir = runDirectory(root, id), { spec } = await readSpec(root, id), roundDir = join(dir, "rounds", String(round));
  await mkdir(roundDir, { recursive: true }); await rm(join(dir, "code", RESULTS_FILE), { force: true });
  const files = await listCodeFiles(root, id);
  if (!files.some(f => f.path === TEST_ENTRY)) { const rows = compareResults(spec.reportedResults, null); return { round, code: null, timedOut: false, stdout: "", stderr: "", rows, ranTests: false, error: `${TEST_ENTRY} was not written.` }; }
  const run = await readRun(root, id), shared = [await realpath(sharedCodeDir(root, run.paperId, run.mode)).catch(() => sharedCodeDir(root, run.paperId, run.mode))];
  const result = await runSandboxed({ python, runDir: dir, cwd: "code", script: TEST_ENTRY, timeoutMs, ...(shared.length ? { extraDirs: shared } : {}), ...(signal ? { signal } : {}) });
  await writeFile(join(roundDir, "stdout.txt"), result.stdout); await writeFile(join(roundDir, "stderr.txt"), result.stderr);
  let parsed: unknown = null, error: string | undefined;
  try { parsed = JSON.parse(await readFile(join(dir, "code", RESULTS_FILE), "utf8")); await writeFile(join(roundDir, RESULTS_FILE), JSON.stringify(parsed, null, 2)); } catch { error = result.timedOut ? "The tests hit the time limit before writing results." : result.code ? `The tests exited with code ${result.code} without writing ${RESULTS_FILE}.` : `${RESULTS_FILE} was not written or is not valid JSON.`; }
  const rows = compareResults(spec.reportedResults, parsed);
  await atomic(join(roundDir, "compared.json"), rows);
  await updateRun(root, id, run => { run.rounds.used = Math.max(run.rounds.used, round); run.results = rows; if (run.summary) run.summary = `${Object.entries(summarise(rows)).filter(([, n]) => n).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ")}. Re-tested in round ${round}.`; });
  const reportPath = join(dir, "report.md"), report = await readFile(reportPath, "utf8").catch(() => null);
  if (report !== null) { const banner = `> ⚠ The tests were run again in round ${round} after this report was written. The results table above the report shows the current statuses.`; const body = report.replace(/^> ⚠ The tests were run again in round \d+ after this report was written\.[^\n]*\n\n?/m, ""); const [title, ...rest] = body.split("\n"); await writeFile(reportPath, `${title}\n\n${banner}\n${rest.join("\n")}`); }
  await appendEvent(root, id, "tests", `Round ${round}: ${Object.entries(summarise(rows)).filter(([, n]) => n).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ")}${error ? `. ${error}` : ""}`);
  return { round, code: result.code, timedOut: result.timedOut, stdout: result.stdout, stderr: result.stderr, rows, ranTests: true, ...(error ? { error } : {}) };
}
export const fileName = (path: string) => basename(path);

const ENV_BLOCK = /\n*<!-- environments -->[\s\S]*?<!-- \/environments -->\n*/;
/** The brief's section on attached environments: where the files are, what they hold, and the rule for comparability. */
export function environmentsBlock(envs: AttachedEnvironment[], policy?: EnvPolicy): string {
  const permissions = policy && (policy.pick || policy.create) ? `ENVIRONMENT PERMISSIONS FROM THE USER\n${policy.pick ? "- You may pick environments from the library yourself: call paperrun_list_environments, then paperrun_use_environment with this run id for the ones that fit what the paper needs.\n" : ""}${policy.create ? "- You may extend the library or create a new environment when none fits: call paperrun_save_environment (it becomes a candidate the user approves; say how you built it and what you assumed), then paperrun_use_environment with this run id.\n" : ""}` : "";
  if (!envs.length && !permissions) return "";
  const attachedText = envs.length ? `ENVIRONMENTS ATTACHED (use these worlds; they are files in the code folder, loaded with json.load)\n${envs.map(e => `- ${e.name} (${e.id}, version ${e.version}, ${e.status}): ${e.file}\n  ${ORIGIN_TEXT[e.origin as keyof typeof ORIGIN_TEXT] ?? e.origin}. ${e.kind === "fixed" ? `A fixed ${e.rows}x${e.cols} map.` : `${e.instances} pre-generated ${e.rows}x${e.cols} random maps, each with its seed.`} Source: ${e.source}`).join("\n")}\nFile format: "ascii" is a list of rows where "#" is blocked and "." is free; "start", "goal" and "targets" are [row, col]; "instances" lists {"seed", "ascii"}. Do not invent your own maps when one of these fits. Say in each result note which environment, version and seeds were used. A result measured on a world that is not the paper's own (see Source) must be marked "comparable": false.\n` : "";
  const candidates = envs.some(e => e.status === "candidate");
  const how = envs.length || policy?.pick || policy?.create ? `HOW TO CHOOSE A MAP, IN THIS ORDER\n1. Use the attached maps whose Source names the same figure as the result you are measuring (for example the Fig. 9 maps for the four static environments).\n2. If none of them fits and picking is allowed, pick another from the library.\n3. Create or extend a map only when no library map fits, and only if creating is allowed. Say how you built it and what you assumed.\nResults on a map the paper does not show (for example a grid described only by its size) have no digitised map: they are not on the paper's own world, so mark them "comparable": false.\n${candidates ? "Maps marked candidate are not approved by the user yet. Results measured on a candidate map must be marked \"comparable\": false until the user approves it. Do not mark your own digitisation as comparable.\n" : ""}` : "";
  return `\n\n<!-- environments -->\n${attachedText}${how}${permissions}<!-- /environments -->\n`;
}
/** Takes an environment back out of a run: its file leaves the code folder, and the record and the brief no longer list it. */
export async function detachEnvironment(root: string, runId: string, envId: string): Promise<void> {
  const run = await readRun(root, runId), entry = (run.environments ?? []).find(e => e.id === envId); if (!entry) return;
  if (!(await environmentUsedElsewhere(root, run, envId))) await rm(join(runDirectory(root, runId), "code", "environments", `${envId}.json`), { force: true });
  const next = await updateRun(root, runId, r => { r.environments = (r.environments ?? []).filter(e => e.id !== envId); if (!r.environments.length) delete r.environments; });
  const briefPath = join(runDirectory(root, runId), "brief.md"), brief = await readFile(briefPath, "utf8").catch(() => "");
  if (brief) await atomic(briefPath, `${brief.replace(ENV_BLOCK, "").trimEnd()}${environmentsBlock(next.environments ?? [], next.envPolicy)}`);
  await appendEvent(root, runId, "environment", `Removed environment "${entry.name}" (${envId}).`);
}
/** Copies an environment into a run's code folder, records which version was used, and updates the brief. */
export async function attachEnvironment(root: string, runId: string, envRoot: string, envId: string): Promise<AttachedEnvironment> {
  const env = await getEnvironment(envRoot, envId).catch(() => { throw Error("Unknown environment."); });
  const m = materializeEnvironment(env), file = `environments/${env.id}.json`;
  await mkdir(join(runDirectory(root, runId), "code", "environments"), { recursive: true });
  await atomic(join(runDirectory(root, runId), "code", file), m);
  const entry: AttachedEnvironment = { id: env.id, name: env.name, version: env.version, hash: env.hash, status: env.status, origin: env.origin, kind: m.kind, rows: m.rows, cols: m.cols, ...(m.instances ? { instances: m.instances.length } : {}), source: [env.source.paperTitle, env.source.figure, env.source.note].filter(Boolean).join(" · ").slice(0, 300), file };
  const run = await updateRun(root, runId, r => { r.environments = [...(r.environments ?? []).filter(e => e.id !== env.id), entry]; });
  const briefPath = join(runDirectory(root, runId), "brief.md"), brief = await readFile(briefPath, "utf8").catch(() => "");
  if (brief) await atomic(briefPath, `${brief.replace(ENV_BLOCK, "").trimEnd()}${environmentsBlock(run.environments ?? [], run.envPolicy)}`);
  await appendEvent(root, runId, "environment", `Attached environment "${env.name}" (${env.id}, version ${env.version}, ${env.status}).`);
  return entry;
}

/** Records what the user allows the agent to do about environments, and says so in the brief. */
export async function setEnvPolicy(root: string, runId: string, policy: EnvPolicy): Promise<void> {
  const run = await updateRun(root, runId, r => { r.envPolicy = policy; });
  const briefPath = join(runDirectory(root, runId), "brief.md"), brief = await readFile(briefPath, "utf8").catch(() => "");
  if (brief) await atomic(briefPath, `${brief.replace(ENV_BLOCK, "").trimEnd()}${environmentsBlock(run.environments ?? [], policy)}`);
  await appendEvent(root, runId, "environment", `Environment permissions: ${policy.pick ? "the agent may pick" : "no picking"}, ${policy.create ? "may extend or create" : "no creating"}.`);
}

/** How many files each of a paper's two code folders holds. */
export async function codeFolderSizes(root: string, paperId: string): Promise<{ muse: number; external: number }> {
  const count = async (dir: string): Promise<number> => { let n = 0; for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) { if (entry.name.startsWith(".") || entry.name === "__pycache__") continue; n += entry.isDirectory() ? await count(join(dir, entry.name)) : 1; } return n; };
  return { muse: await count(sharedCodeDir(root, paperId, "muse")), external: await count(sharedCodeDir(root, paperId, "external")) };
}
