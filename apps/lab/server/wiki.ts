import type { Connect, Plugin } from "vite";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cutText, DESCEND_ID, readDescend, replicationLine, replicationStatus, type DescendRecord, type ReplicationStatus } from "./descend.ts";
import { readRun, RUN_ID, runDirectory, summarise, type RunRecord } from "./paperrunCore.ts";
import { readWorkshop, WORKSHOP_ID, type WorkshopRecord } from "./workshop.ts";

/**
 * The wiki is a folder of markdown pages written from what the app has stored: one page per paper, replication, exploration and workshop, with links between them.
 * Plain code writes the pages, no model. A page is only written once the user saves that item, and nothing in the folder is ever deleted. Every page says how far its
 * baseline replication can be trusted, and what an agent reported is labelled as reported.
 */
export type WikiKind = "replication" | "exploration" | "workshop";
export interface Saved { kind: WikiKind; id: string; savedAt: string }
export interface WikiDeps { root: string; runsRoot: string; descendRoot: string; workshopRoot: string; now?: () => Date }

const KINDS: Record<WikiKind, { dir: string; id: RegExp }> = { replication: { dir: "replications", id: RUN_ID }, exploration: { dir: "explorations", id: DESCEND_ID }, workshop: { dir: "workshops", id: WORKSHOP_ID } };
export const isKind = (v: unknown): v is WikiKind => typeof v === "string" && v in KINDS;
export const pagePath = (kind: WikiKind, id: string) => { if (!KINDS[kind].id.test(id)) throw Error("Invalid id."); return `${KINDS[kind].dir}/${id}.md`; };
const paperPath = (paperId: string) => { if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(paperId)) throw Error("Invalid paper id."); return `papers/${paperId}.md`; };
const label = (t: string) => cutText(t.replace(/[[\]\n\r]/g, " ").replace(/\s+/g, " ").trim(), 140);
const cell = (t: unknown) => cutText(String(t ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim(), 240);
const front = (fields: Record<string, string | number>) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n`;
const rel = (from: string, to: string) => { const depth = from.split("/").length - 1; return `${"../".repeat(depth)}${to}`; };
const day = (iso: string) => iso.slice(0, 16).replace("T", " ");

export function replicationPage(run: RunRecord, report: string, status: ReplicationStatus, saved: Saved): string {
  const path = pagePath("replication", run.id), counts = summarise(run.results ?? []);
  return front({ type: "replication", id: run.id, paper: run.paperId, mode: run.mode, status: run.status, saved: saved.savedAt, baseline: status.rating, verified: `${status.verified} of ${status.total}` }) + [
    `# Replication (${run.mode === "muse" ? "Muse" : "agent"} run ${day(run.createdAt)}): ${label(run.title)}`, "", `Paper: [${label(run.title)}](${rel(path, paperPath(run.paperId))}). Run \`${run.id}\`, ${run.mode === "muse" ? "written by Muse" : "written by an external agent"}, started ${day(run.createdAt)}, status ${run.status}.`, "",
    `**${replicationLine(status)}**`, "",
    `Results: ${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ") || "none"}.`, "",
    ...((run.results ?? []).length ? ["| Id | What | Paper | Reproduced | Status |", "|---|---|---|---|---|", ...(run.results ?? []).map(r => `| ${cell(r.id)} | ${cell(r.description)} | ${cell(r.reported)} | ${cell(r.reproduced)} | ${cell(r.status.replace(/_/g, " "))} |`), ""] : []),
    ...((run.environments ?? []).length ? ["Maps used:", ...(run.environments ?? []).map(e => `- ${label(e.name)} (${e.status})`), ""] : []),
    ...(run.review ? ["Review concerns:", ...run.review.split("\n").filter(Boolean).map(c => `- ${cell(c)}`), ""] : []),
    ...(report ? ["## Report", "", report.replace(/^# /m, "### ")] : []),
  ].join("\n");
}
export function explorationPage(d: DescendRecord, saved: Saved): string {
  const path = pagePath("exploration", d.id);
  return front({ type: "exploration", id: d.id, paper: d.paperId, status: d.status, verdict: d.verdict ?? "unclear", saved: saved.savedAt, baseline: d.replication.rating, verified: `${d.replication.verified} of ${d.replication.total}` }) + [
    `# Exploration: ${label(d.goal)}`, "", `Paper: [${label(d.title)}](${rel(path, paperPath(d.paperId))}). Built on [replication ${d.runId}](${rel(path, pagePath("replication", d.runId))}).`, "", `**${replicationLine(d.replication)}**`, "", "Everything below is the model's reasoning plus leads found online. None of it was run here.", "",
    ...(d.report ? [d.report.replace(/^# /m, "## ")] : ["No report."]),
  ].join("\n");
}
export function workshopPage(w: WorkshopRecord, saved: Saved): string {
  const path = pagePath("workshop", w.id);
  return front({ type: "workshop", id: w.id, paper: w.paperId, status: w.status, saved: saved.savedAt, baseline: w.replication.rating, verified: `${w.replication.verified} of ${w.replication.total}` }) + [
    `# Workshop: ${label(w.goal)}`, "", `Paper: [${label(w.title)}](${rel(path, paperPath(w.paperId))}). From [exploration ${w.descendId}](${rel(path, pagePath("exploration", w.descendId))}).`, "", `**${replicationLine(w.replication)}**`, "",
    "## Hypotheses", "", ...w.hypotheses.flatMap(h => [`### ${h.id} (${h.status}): ${label(h.statement)}`, "", ...(h.test ? [`Test: ${cell(h.test)}`, ""] : []), ...(h.success ? [`Support or refute: ${cell(h.success)}`, ""] : []), h.evidence.length ? `Evidence: ${h.evidence.join(", ")}` : "No experiment recorded, so this is not a finding.", ""]),
    "## Experiments", "", ...(w.experiments.length ? ["Values below were reported by the agent that ran them and have not been checked here.", "", "| Id | Hypothesis | What was done | Result | By |", "|---|---|---|---|---|", ...w.experiments.map(x => `| ${x.id} | ${x.hypothesisId} | ${cell(x.summary)} | ${cell(x.metric ? `${x.metric}: ${x.value ?? ""}` : x.value)} | ${x.by === "agent" ? "agent (reported)" : "user"} |`), ""] : ["None recorded.", ""]),
    "## Progress", "", ...(w.log.length ? w.log.map(l => `- ${day(l.at)} ${l.by}: ${cell(l.message)}`) : ["Nothing logged."]), "",
  ].join("\n");
}
export function paperPage(paperId: string, title: string, saved: Saved[], titles: Map<string, string>): string {
  const path = paperPath(paperId), mine = (kind: WikiKind) => saved.filter(s => s.kind === kind);
  const list = (kind: WikiKind, name: string) => mine(kind).length ? [`## ${name}`, "", ...mine(kind).map(s => `- [${label(titles.get(`${kind}:${s.id}`) ?? s.id)}](${rel(path, pagePath(s.kind, s.id))}) (saved ${day(s.savedAt)})`), ""] : [];
  return front({ type: "paper", id: paperId, title }) + [`# ${label(title)}`, "", ...list("replication", "Replications"), ...list("exploration", "Explorations"), ...list("workshop", "Workshops")].join("\n");
}
export function indexPage(papers: { id: string; title: string; counts: Record<WikiKind, number> }[]): string {
  return front({ type: "index" }) + ["# Wiki", "", "Pages saved from the app, one folder per kind. Only what you chose to save is here.", "", ...(papers.length ? papers.map(p => `- [${label(p.title)}](${paperPath(p.id)}): ${p.counts.replication} replication(s), ${p.counts.exploration} exploration(s), ${p.counts.workshop} workshop(s)`) : ["Nothing saved yet."]), "", "See [log](log.md) for what was saved and when.", ""].join("\n");
}

async function atomic(path: string, content: string) { await mkdir(dirname(path), { recursive: true }); const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`; await writeFile(tmp, content); await rename(tmp, path); }
const savedFile = (root: string) => join(root, ".saved.json");
export async function readSaved(root: string): Promise<Saved[]> { try { const v = JSON.parse(await readFile(savedFile(root), "utf8")); return Array.isArray(v) ? v.filter(s => s && isKind(s.kind) && typeof s.id === "string" && KINDS[s.kind as WikiKind].id.test(s.id)) : []; } catch { return []; } }

async function loadItem(deps: WikiDeps, s: Saved) {
  if (s.kind === "replication") { const run = await readRun(deps.runsRoot, s.id); if (!["done", "failed", "cancelled"].includes(run.status)) throw Error("Finish the run before saving it to the wiki."); return { kind: "replication" as const, s, run, report: await readFile(join(runDirectory(deps.runsRoot, s.id), "report.md"), "utf8").catch(() => ""), status: await replicationStatus(deps.runsRoot, run) }; }
  if (s.kind === "exploration") { const d = await readDescend(deps.descendRoot, s.id); if (d.status !== "done") throw Error("The exploration has no finished report yet."); return { kind: "exploration" as const, s, d }; }
  const w = await readWorkshop(deps.workshopRoot, s.id); if (w.status !== "ready") throw Error("The workshop is not ready yet."); return { kind: "workshop" as const, s, w };
  }

const plain = (page: string) => page.replace(/^---\n[\s\S]*?\n---\n\n/, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
/**
 * One item as the plain text the knowledge graph reads. It opens with a plain statement of what the text is, so a claim an agent reported is stored
 * as reported and the entry is never mistaken for a paper.
 */
export async function itemDocument(deps: WikiDeps, kind: WikiKind, id: string): Promise<{ title: string; paperId: string; text: string }> {
  pagePath(kind, id);
  const s: Saved = { kind, id, savedAt: (deps.now?.() ?? new Date()).toISOString() }, item = await loadItem(deps, s);
  const [page, title, paperId, line, changed] = item.kind === "replication" ? [replicationPage(item.run, item.report, item.status, s), `Replication: ${item.run.title} (${item.run.mode === "muse" ? "Muse" : "agent"} run ${day(item.run.createdAt)})`, item.run.paperId, replicationLine(item.status), item.run.updatedAt]
    : item.kind === "exploration" ? [explorationPage(item.d, s), `Exploration: ${item.d.goal}`, item.d.paperId, replicationLine(item.d.replication), item.d.updatedAt] : [workshopPage(item.w, s), `Workshop: ${item.w.goal}`, item.w.paperId, replicationLine(item.w.replication), item.w.updatedAt];
  // The header carries the item's own last change, never the time of saving, so saving an unchanged item gives identical text and the graph recognises it.
  const header = `APP-MADE ENTRY, NOT A PAPER. This is a ${kind} from the GeoScienceAI Lab app, last changed ${day(changed)}. ${line} Model reasoning and values reported by agents are recorded here as reported: none of it is verified unless it says so.\n\n`;
  return { title: label(title).slice(0, 160), paperId, text: header + plain(page) };
}

/** When the item last changed, read from its own record. */
export async function itemChangedAt(deps: WikiDeps, kind: WikiKind, id: string): Promise<string> {
  pagePath(kind, id);
  const file = kind === "replication" ? join(runDirectory(deps.runsRoot, id), "run.json") : kind === "exploration" ? join(deps.descendRoot, id, "descend.json") : join(deps.workshopRoot, id, "workshop.json");
  const at = (JSON.parse(await readFile(file, "utf8")) as { updatedAt?: unknown }).updatedAt; if (typeof at !== "string") throw Error("This item has no change time.");
  return at;
}
/** Whether the item has a wiki page, and when that page was last written. */
export async function wikiState(deps: WikiDeps, kind: WikiKind, id: string): Promise<{ saved: boolean; writtenAt?: string }> {
  if (!(await readSaved(deps.root)).some(s => s.kind === kind && s.id === id)) return { saved: false };
  const page = await stat(join(deps.root, pagePath(kind, id))).catch(() => null); return page ? { saved: true, writtenAt: page.mtime.toISOString() } : { saved: false };
}

/** Saves one item: records the choice, then writes every saved page again so links and counts stay consistent. Nothing is deleted. Returns the paths written. */
export async function saveToWiki(deps: WikiDeps, kind: WikiKind, id: string): Promise<{ folder: string; pages: string[]; action: "saved" | "refreshed" }> {
  pagePath(kind, id); // validates the id before anything is read
  const now = (deps.now?.() ?? new Date()).toISOString(), before = await readSaved(deps.root), existing = before.find(s => s.kind === kind && s.id === id);
  const target: Saved = existing ?? { kind, id, savedAt: now };
  const load = (s: Saved) => loadItem(deps, s);
  await load(target); // a failing target must not leave a half-saved registry
  const all = existing ? before : [...before, target], pages: Record<string, string> = {}, titles = new Map<string, string>(), byPaper = new Map<string, { title: string; saved: Saved[] }>();
  const note = (paperId: string, title: string, s: Saved) => { const e = byPaper.get(paperId) ?? { title, saved: [] }; e.saved.push(s); byPaper.set(paperId, e); };
  for (const s of all) {
    const item = await load(s).catch(() => null); if (!item) continue;
    if (item.kind === "replication") { pages[pagePath("replication", s.id)] = replicationPage(item.run, item.report, item.status, s); titles.set(`replication:${s.id}`, `${item.run.mode === "muse" ? "Muse" : "Agent"} run ${day(item.run.createdAt)}`); note(item.run.paperId, item.run.title, s); }
    else if (item.kind === "exploration") { pages[pagePath("exploration", s.id)] = explorationPage(item.d, s); titles.set(`exploration:${s.id}`, item.d.goal); note(item.d.paperId, item.d.title, s); }
    else { pages[pagePath("workshop", s.id)] = workshopPage(item.w, s); titles.set(`workshop:${s.id}`, item.w.goal); note(item.w.paperId, item.w.title, s); }
  }
  for (const [paperId, e] of byPaper) pages[paperPath(paperId)] = paperPage(paperId, e.title, e.saved, titles);
  pages["index.md"] = indexPage([...byPaper].map(([id, e]) => ({ id, title: e.title, counts: { replication: e.saved.filter(s => s.kind === "replication").length, exploration: e.saved.filter(s => s.kind === "exploration").length, workshop: e.saved.filter(s => s.kind === "workshop").length } })));
  await mkdir(deps.root, { recursive: true });
  for (const [path, content] of Object.entries(pages)) await atomic(join(deps.root, path), content);
  await atomic(savedFile(deps.root), JSON.stringify(all, null, 1));
  const logPath = join(deps.root, "log.md"), log = await readFile(logPath, "utf8").catch(() => "") || "# Log\n\nWhat was saved to this wiki, oldest first. Lines are only ever added.\n\n";
  await atomic(logPath, `${log}- ${day(now)} ${existing ? "refreshed" : "saved"} ${kind} ${id}\n`);
  return { folder: deps.root, pages: Object.keys(pages).sort(), action: existing ? "refreshed" : "saved" };
}

/** The pages a reader may open: the two overview pages and one folder per kind. Nothing else in the folder can be read through the app. */
export const PAGE_PATH = /^(?:(?:index|log)\.md|(?:papers|replications|explorations|workshops)\/[A-Za-z0-9_-]+\.md)$/;
export interface WikiPageInfo { path: string; title: string; group: "overview" | "papers" | "replications" | "explorations" | "workshops"; modified: string }
export async function listWikiPages(root: string): Promise<WikiPageInfo[]> {
  const out: WikiPageInfo[] = [], add = async (path: string, group: WikiPageInfo["group"]) => {
    if (!PAGE_PATH.test(path)) return; const file = join(root, path), info = await stat(file).catch(() => null); if (!info?.isFile()) return;
    const head = (await readFile(file, "utf8")).replace(/^---\n[\s\S]*?\n---\n/, ""), title = /^#\s+(.+)$/m.exec(head)?.[1]?.trim() ?? path;
    out.push({ path, title: cutText(title, 140), group, modified: info.mtime.toISOString() });
  };
  await add("index.md", "overview"); await add("log.md", "overview");
  for (const group of ["papers", "replications", "explorations", "workshops"] as const) for (const name of (await readdir(join(root, group)).catch(() => [])).sort()) await add(`${group}/${name}`, group);
  return out;
}
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const ROOT = fileURLToPath(new URL("../wiki/", import.meta.url)), RUNS = fileURLToPath(new URL("../paperruns/", import.meta.url)), DESCEND = fileURLToPath(new URL("../descendances/", import.meta.url)), WORKSHOPS = fileURLToPath(new URL("../workshops/", import.meta.url));
export interface WikiOptions { root?: string; runsRoot?: string; descendRoot?: string; workshopRoot?: string; now?: () => Date }
export const wikiDeps = (options: WikiOptions = {}): WikiDeps => ({ root: resolve(options.root ?? ROOT), runsRoot: resolve(options.runsRoot ?? RUNS), descendRoot: resolve(options.descendRoot ?? DESCEND), workshopRoot: resolve(options.workshopRoot ?? WORKSHOPS), ...(options.now ? { now: options.now } : {}) });
export function createWikiHandler(options: WikiOptions = {}) {
  const deps = wikiDeps(options);
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method !== "GET" && (req.headers.get("origin") !== url.origin || (req.headers.has("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin"))) return json({ error: "Use the wiki from this app." }, 403);
    try {
      if (req.method === "GET" && url.pathname === "/api/wiki") return json({ folder: deps.root, saved: await readSaved(deps.root) });
      if (req.method === "GET" && url.pathname === "/api/wiki/pages") return json({ folder: deps.root, pages: await listWikiPages(deps.root) });
      if (req.method === "GET" && url.pathname === "/api/wiki/page") {
        const path = url.searchParams.get("path") ?? ""; if (!PAGE_PATH.test(path)) return json({ error: "That page cannot be read here." }, 400);
        const content = await readFile(join(deps.root, path), "utf8").catch(() => null); return content === null ? json({ error: "No such page." }, 404) : json({ path, content });
      }
      if (req.method === "POST" && url.pathname === "/api/wiki/save") {
        const body = JSON.parse(await req.text()) as Record<string, unknown>;
        if (!isKind(body.kind) || typeof body.id !== "string") return json({ error: "Choose what to save." }, 400);
        return json(await saveToWiki(deps, body.kind, body.id));
      }
      return json({ error: "Unknown wiki operation." }, 404);
    } catch (error) { return json({ error: error instanceof Error ? error.message.slice(0, 400) : "The wiki failed." }, 400); }
  };
}
export function wikiPlugin(): Plugin {
  const handle = createWikiHandler();
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/wiki")) return next();
    try {
      const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 20_000) { res.statusCode = 413; res.end(JSON.stringify({ error: "Request too large." })); return; } chunks.push(chunk as Buffer); }
      const headers = new Headers(); for (const name of ["origin", "sec-fetch-site", "content-type"]) { const value = req.headers[name]; if (typeof value === "string") headers.set(name, value); }
      const response = await handle(new Request(new URL(req.url, `http://${req.headers.host ?? "localhost"}`), { method: req.method, headers, ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}) }));
      res.statusCode = response.status; response.headers.forEach((v, k) => res.setHeader(k, v)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.statusCode = 500; res.end(JSON.stringify({ error: "The wiki failed." })); }
  };
  return { name: "local-wiki", configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
