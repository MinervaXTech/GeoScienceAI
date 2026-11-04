import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { assessReplication } from "../src/domain/replicationScore.ts";
import { currentCoverage, listRuns, readRun, readSpec, summarise, type RunMode } from "./paperrunCore.ts";

/**
 * The memory of one replication: what a new run needs to know, in a bounded space, however many runs came before it.
 * Each run adds one ledger line and replaces the "open problems" with its own. Old ledger lines fold into one summary line.
 */
export interface MemoryEntry { runId: string; mode: RunMode; at: string; counts: Record<string, number>; rating: string; summary: string; environments: string[] }
export interface Memory { paperId: string; title: string; entries: MemoryEntry[]; decisions: string[]; open: { runId: string; concerns: string[]; weakSteps: string[]; next: string[] } | null }
export const MEMORY_MAX_CHARS = 3600, LEDGER_KEPT = 6;

const memoryDir = (root: string) => join(root, "_memory");
const memoryFile = (root: string, paperId: string) => { if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(paperId)) throw Error("Invalid paper id."); return join(memoryDir(root), `${paperId}.json`); };
const clip = (text: string, max: number) => { const t = text.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const countsText = (c: Record<string, number>) => Object.entries(c).filter(([, n]) => n).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ") || "no results";

export async function readMemory(root: string, paperId: string): Promise<Memory | null> {
  try { return JSON.parse(await readFile(memoryFile(root, paperId), "utf8")); } catch { return null; }
}

/** Adds or replaces this run's line in its paper's memory. Only finished runs are recorded. */
export async function recordRunMemory(root: string, runId: string): Promise<Memory | null> {
  const run = await readRun(root, runId);
  if (!["done", "failed", "cancelled"].includes(run.status)) return null;
  const { spec } = await readSpec(root, runId), coverage = await currentCoverage(root, run), rows = run.results ?? [], concerns = (run.review ?? "").split("\n").filter(Boolean);
  const assessment = assessReplication({ results: rows, stepCount: run.stepCount ?? spec.steps.length, ...(coverage ? { coverage } : {}), gaps: spec.gaps.map(g => ({ id: g.id, kind: g.kind, impact: g.impact, description: g.description })), concerns, ...(run.environments?.length ? { mapsAttached: run.environments.length } : {}) });
  const previous = await readMemory(root, run.paperId);
  const entry: MemoryEntry = { runId, mode: run.mode, at: run.updatedAt, counts: summarise(rows), rating: assessment.label, summary: clip(run.finishNote ?? "", 260), environments: (run.environments ?? []).map(e => e.name).slice(0, 4) };
  const entries = [...(previous?.entries ?? []).filter(e => e.runId !== runId), entry].sort((a, b) => a.at.localeCompare(b.at));
  const severity = (c: string) => c.startsWith("[high]") ? 0 : c.startsWith("[medium]") ? 1 : 2;
  const memory: Memory = {
    paperId: run.paperId, title: run.title, entries,
    decisions: run.assumptions.slice(0, 8).map(a => clip(`${a.gapId}: ${a.proposal}`, 140)),
    open: { runId, concerns: [...concerns].sort((a, b) => severity(a) - severity(b)).slice(0, 4).map(c => clip(c, 200)), weakSteps: (coverage ?? []).filter(c => c.status !== "implemented").slice(0, 4).map(c => clip(`Step ${c.n} (${c.status}): ${c.note}`, 160)), next: assessment.actions.slice(0, 4).map(a => clip(`[${a.priority}] ${a.text}`, 200)) },
  };
  await mkdir(memoryDir(root), { recursive: true });
  const path = memoryFile(root, run.paperId), tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`; await writeFile(tmp, JSON.stringify(memory, null, 1)); await rename(tmp, path);
  return memory;
}

/** The memory as text for a brief or a prompt. It stays under MEMORY_MAX_CHARS whatever the number of runs. */
export function memoryText(memory: Memory | null, options: { next?: boolean } = {}): string {
  if (!memory || !memory.entries.length) return "";
  const kept = memory.entries.slice(-LEDGER_KEPT), older = memory.entries.slice(0, -LEDGER_KEPT);
  const lines = [`REPLICATION MEMORY (${memory.entries.length} earlier run${memory.entries.length === 1 ? "" : "s"} of this paper, condensed)`];
  if (older.length) lines.push(`- Earlier: ${older.length} run${older.length === 1 ? "" : "s"} (${older.filter(e => e.mode === "muse").length} Muse, ${older.filter(e => e.mode === "external").length} external agent), not listed one by one.`);
  for (const e of kept) lines.push(`- ${e.at.slice(0, 16).replace("T", " ")} ${e.mode === "muse" ? "Muse" : "agent"} ${e.runId}: ${countsText(e.counts)}; rated "${e.rating}"${e.environments.length ? `; maps: ${e.environments.join(", ")}` : ""}${e.summary ? `. ${e.summary}` : ""}`);
  if (memory.decisions.length) lines.push("Standing assumptions:", ...memory.decisions.map(d => `- ${d}`));
  if (memory.open) {
    const { concerns, weakSteps, next } = memory.open;
    const showNext = options.next !== false && next.length > 0, problems = [...concerns, ...weakSteps];
    if (problems.length || showNext) lines.push(`Open problems after the latest run (${memory.open.runId}):`, ...problems.map(c => `- ${c}`), ...(showNext ? ["Next steps:", ...next.map((n, i) => `${i + 1}. ${n}`)] : []));
  }
  const text = lines.join("\n");
  return text.length > MEMORY_MAX_CHARS ? `${text.slice(0, MEMORY_MAX_CHARS - 1)}…` : text;
}

/** Builds the memory for papers whose runs were made before memories existed, oldest run first. Papers that already have one are left alone. */
export async function backfillMemory(root: string): Promise<void> {
  const runs = (await listRuns(root)).reverse(), seen = new Set<string>();
  for (const run of runs) {
    if (seen.has(run.paperId)) continue; seen.add(run.paperId);
    if (await readMemory(root, run.paperId)) continue;
    for (const r of runs.filter(x => x.paperId === run.paperId)) await recordRunMemory(root, r.id).catch(() => null);
  }
}
