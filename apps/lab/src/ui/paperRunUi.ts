export interface McpConfig { command: string; args: string[]; env: Record<string, string> }
export interface RunResultRow { id: string; description: string; reported: string; reproduced: string; relError?: number; tolerance: number; status: string; note: string }
export interface RunStage { name: string; status: string; note?: string; startedAt?: string }
export interface EnvPolicy { pick: boolean; create: boolean }
export const POLICY_PICK = "Allow agent choose suitable map", POLICY_CREATE = "Extend or create environment options";
export const policyText = (p: EnvPolicy | undefined, chosen: number) => [chosen ? `${chosen} chosen` : "", p?.pick ? "agent picks" : "", p?.create ? "may create" : ""].filter(Boolean).join(" · ") || "none chosen";
export interface RunSummary { envPolicy?: EnvPolicy; environments?: { id: string; name: string; version: number; status: string; origin: string; source: string }[]; parentId?: string; stepCount?: number; stepCoverage?: { n: number; status: string; note: string }[]; review?: string; id: string; paperId: string; title: string; mode: "muse" | "external"; status: string; createdAt: string; updatedAt: string; model: string; rounds: { max: number; used: number; repairs?: number }; tokens: { cap: number; used: number }; stages: RunStage[]; results?: RunResultRow[]; summary?: string; error?: string }
export const RUN_ACTIVE = new Set(["queued", "specifying", "coding", "running", "repairing", "reviewing", "reporting"]);
export const RUN_FINISHED = new Set(["done", "failed", "cancelled"]);
export const STATUS_TEXT: Record<string, string> = { queued: "Queued", specifying: "Preparing", coding: "Writing code", running: "Running tests", repairing: "Repairing", reviewing: "Reviewing", reporting: "Reporting", done: "Done", failed: "Failed", cancelled: "Cancelled", waiting_external: "Waiting for your agent" };
export const RESULT_TEXT: Record<string, string> = { match: "Match", within_tolerance: "Within tolerance", mismatch: "Mismatch", not_comparable: "Not comparable", not_run: "Not run" };
export const TOKEN_CAPS = [150000, 400000, 800000, 1500000] as const;
/** The tone of a status chip: finished well, in progress, trouble, or neutral. */
export const statusTone = (status: string): "ok" | "busy" | "bad" | "idle" => status === "done" || status === "match" || status === "within_tolerance" ? "ok" : RUN_ACTIVE.has(status) ? "busy" : status === "failed" || status === "mismatch" || status === "cancelled" ? "bad" : "idle";
export const tokenShare = (tokens: { cap: number; used: number }) => Math.min(100, Math.round((tokens.used / Math.max(1, tokens.cap)) * 100));
/** Commands that register the MCP server with common coding agents, plus the generic JSON form. */
export function mcpSnippets(config: McpConfig): { name: string; text: string }[] {
  const quote = (value: string) => /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
  const env = Object.entries(config.env), program = [config.command, ...config.args].map(quote).join(" ");
  return [
    { name: "Claude Code", text: `claude mcp add paperrun ${env.map(([k, v]) => `-e ${k}=${quote(v)}`).join(" ")} -- ${program}` },
    { name: "Codex", text: `codex mcp add paperrun ${env.map(([k, v]) => `--env ${k}=${quote(v)}`).join(" ")} -- ${program}` },
    { name: "Cursor or other (JSON)", text: JSON.stringify({ mcpServers: { paperrun: { command: config.command, args: config.args, env: config.env } } }, null, 2) },
  ];
}
/** Repair rounds Muse has actually done. Older runs did not record this, so it is estimated from the test rounds. */
export const repairsDone = (run: Pick<RunSummary, "rounds">) => run.rounds.repairs ?? Math.max(0, Math.min(run.rounds.used - 1, run.rounds.max));
export const clock = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;
/** After this long with no new event on a working run, the screen suggests it may be stuck. A Muse call allows 5 minutes and a test run 10. */
export const STALL_SECONDS = 12 * 60;

export interface RunFilters { q: string; type: "all" | "muse" | "external"; range: "all" | "today" | "7d" | "30d"; day: string }
export const NO_FILTERS: RunFilters = { q: "", type: "all", range: "all", day: "" };
export const filtersActive = (f: RunFilters) => !!f.q.trim() || f.type !== "all" || f.range !== "all" || !!f.day;
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** Runs matching a name or id search, a type (Muse or external agent), and a date: a preset range or one exact local day. Newest first as given. */
export function filterRuns<T extends Pick<RunSummary, "title" | "id" | "summary" | "mode" | "createdAt">>(runs: T[], f: RunFilters, now = Date.now()): T[] {
  const q = f.q.trim().toLowerCase(), startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const since = f.range === "today" ? startOfToday.getTime() : f.range === "7d" ? now - 7 * 86400000 : f.range === "30d" ? now - 30 * 86400000 : 0;
  return runs.filter(r => (!q || `${r.title} ${r.id} ${r.summary ?? ""}`.toLowerCase().includes(q)) && (f.type === "all" || r.mode === f.type) && (f.day ? localDay(r.createdAt) === f.day : Date.parse(r.createdAt) >= since));
}
export interface WorkingRun { id: string; title: string; kind: "muse" | "agent"; status: string }

export interface EnvSummary {
  id: string; name: string; description: string; origin: string; status: "candidate" | "approved"; version: number; hash: string;
  source: { paperTitle?: string; figure?: string; note: string }; kind: "fixed" | "generator"; rows: number; cols: number;
  generator?: { density: number; seedBase: number; instances: number; start: [number, number]; goal: [number, number] };
  start?: [number, number]; goal?: [number, number]; targets: [number, number][]; dynamicObstacles: [number, number][]; assumptions: string[];
  scale?: { cellMeters?: number; note: string }; solvable: boolean; checkNotes: string[]; createdBy: string; createdAt: string; ascii?: string[];
}
export const ORIGIN_LABEL: Record<string, string> = { digitised: "Digitised from paper", "generated-from-parameters": "Generated from stated parameters", "generated-from-description": "Generated from a loose description", satellite: "From satellite imagery", manual: "Made by hand" };
