import type { Connect, Plugin } from "vite";
import { randomBytes } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listDescends } from "./descend.ts";
import { listRuns } from "./paperrunCore.ts";
import { createGraphSyncer, SyncError, type SyncOptions } from "./knowledgeSync.ts";
import { saveToWiki, wikiState, type WikiKind } from "./wiki.ts";
import { listWorkshops } from "./workshop.ts";

/**
 * Keeps the wiki and the knowledge graph in step with the app. A finished item that is missing from either, or that changed after its copy was made, is brought up to date,
 * but only once it has been quiet for a while, so work in progress is never pushed half done. On a day when nothing changed, nothing is pushed at all: old backlog waits until
 * something changes again. The graph also costs Muse calls, so one item is read per check, a daily limit applies, and an item that keeps failing is left alone until it changes.
 * Everything is switched from one settings file.
 */
export interface AutoSettings { wiki: boolean; graph: boolean; quietMinutes: number; graphDailyLimit: number }
export const DEFAULT_SETTINGS: AutoSettings = { wiki: true, graph: true, quietMinutes: 10, graphDailyLimit: 20 };
export interface AutoEvent { at: string; destination: "wiki" | "graph"; kind: WikiKind; id: string; result: "saved" | "refreshed" | "added" | "replaced" | "unchanged" | "failed"; note?: string }
export interface AutoState { day: string; graphAttempts: number; failures: Record<string, { count: number; lastAt: string; message: string }>; events: AutoEvent[]; lastScanAt?: string }
export interface Item { kind: WikiKind; id: string; title: string; changedAt: string }
export interface Waiting { kind: WikiKind; id: string; title: string; destination: "wiki" | "graph"; reason: "not saved yet" | "changed since it was saved"; dueAt?: string; blocked?: "no changes today" | "daily limit reached" | "failed three times, waits for a change" | "failed recently, trying again later" }
export interface AutoContext { dir: string; syncer: ReturnType<typeof createGraphSyncer>; now?: () => Date }

const BACKOFF_MS = 30 * 60_000, MAX_FAILURES = 3, MAX_EVENTS = 40;
const settingsFile = (dir: string) => join(dir, "settings.json"), stateFile = (dir: string) => join(dir, "state.json");
async function atomic(path: string, value: unknown) { await mkdir(resolve(path, ".."), { recursive: true }); const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`; await writeFile(tmp, JSON.stringify(value, null, 1)); await rename(tmp, path); }
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function parseSettings(value: unknown, current: AutoSettings = DEFAULT_SETTINGS): AutoSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Send the settings as an object.");
  const v = value as Record<string, unknown>; if (Object.keys(v).some(k => !["wiki", "graph", "quietMinutes", "graphDailyLimit"].includes(k))) throw Error("Unknown setting.");
  const out = { ...current };
  for (const k of ["wiki", "graph"] as const) if (v[k] !== undefined) { if (typeof v[k] !== "boolean") throw Error(`${k} must be true or false.`); out[k] = v[k] as boolean; }
  if (v.quietMinutes !== undefined) { if (!Number.isInteger(v.quietMinutes) || (v.quietMinutes as number) < 1 || (v.quietMinutes as number) > 240) throw Error("The quiet time must be a whole number of minutes from 1 to 240."); out.quietMinutes = v.quietMinutes as number; }
  if (v.graphDailyLimit !== undefined) { if (!Number.isInteger(v.graphDailyLimit) || (v.graphDailyLimit as number) < 0 || (v.graphDailyLimit as number) > 100) throw Error("The daily limit must be a whole number from 0 to 100."); out.graphDailyLimit = v.graphDailyLimit as number; }
  return out;
}
export async function readSettings(dir: string): Promise<AutoSettings> { try { return parseSettings(JSON.parse(await readFile(settingsFile(dir), "utf8"))); } catch { return { ...DEFAULT_SETTINGS }; } }
export const writeSettings = (dir: string, settings: AutoSettings) => atomic(settingsFile(dir), settings);
export async function readState(dir: string, now: Date): Promise<AutoState> {
  const fresh: AutoState = { day: dayOf(now), graphAttempts: 0, failures: {}, events: [] };
  try { const s = JSON.parse(await readFile(stateFile(dir), "utf8")) as AutoState; return s.day === fresh.day ? { ...fresh, ...s } : { ...fresh, failures: s.failures ?? {}, events: s.events ?? [], ...(s.lastScanAt ? { lastScanAt: s.lastScanAt } : {}) }; } catch { return fresh; }
}

/** Every finished item the app holds. A run still working, a report still being written and a workshop still preparing are not yet items. */
export async function listItems(syncer: ReturnType<typeof createGraphSyncer>): Promise<Item[]> {
  const { runsRoot, descendRoot, workshopRoot } = syncer.deps;
  const runs = (await listRuns(runsRoot).catch(() => [])).filter(r => ["done", "failed", "cancelled"].includes(r.status)).map(r => ({ kind: "replication" as const, id: r.id, title: r.title, changedAt: r.updatedAt }));
  const explorations = (await listDescends(descendRoot)).filter(d => d.status === "done" && !!d.report).map(d => ({ kind: "exploration" as const, id: d.id, title: d.goal, changedAt: d.updatedAt }));
  const workshops = (await listWorkshops(workshopRoot)).filter(w => w.status === "ready").map(w => ({ kind: "workshop" as const, id: w.id, title: w.goal, changedAt: w.updatedAt }));
  return [...runs, ...explorations, ...workshops].sort((a, b) => a.changedAt.localeCompare(b.changedAt));
}

/** Whether anything at all changed today. When nothing did, nothing is pushed. */
export const activeToday = (items: Item[], now: Date) => items.some(i => dayOf(new Date(i.changedAt)) === dayOf(now));

/** What needs doing, and when it may. The graph list is in the order items will be read, oldest change first. */
export async function plan(ctx: AutoContext, settings: AutoSettings, state: AutoState, now: Date) {
  const items = await listItems(ctx.syncer), entries = await ctx.syncer.entries(), waiting: Waiting[] = [], wikiDue: Item[] = [], graphDue: Item[] = [], active = activeToday(items, now);
  const idle = "no changes today" as const, midnight = new Date(now); midnight.setHours(24, 0, 5, 0);
  for (const item of items) {
    const quietAt = new Date(new Date(item.changedAt).getTime() + settings.quietMinutes * 60_000);
    if (settings.wiki) {
      const w = await wikiState(ctx.syncer.deps, item.kind, item.id);
      if (!w.saved || item.changedAt > w.writtenAt!) {
        waiting.push({ kind: item.kind, id: item.id, title: item.title, destination: "wiki", reason: w.saved ? "changed since it was saved" : "not saved yet", ...(active ? { dueAt: quietAt.toISOString() } : { blocked: idle }) });
        if (active && quietAt <= now) wikiDue.push(item);
      }
    }
    if (settings.graph) {
      const at = entries.filter(e => e.origin?.kind === item.kind && e.origin?.id === item.id && e.status === "stored").map(e => e.addedAt).sort().at(-1);
      if (at && item.changedAt <= at) continue;
      const key = `${item.kind}:${item.id}`, fail = state.failures[key], failedSince = fail && fail.lastAt >= item.changedAt;
      const blocked = !active ? idle : failedSince && fail.count >= MAX_FAILURES ? "failed three times, waits for a change" as const : failedSince && now.getTime() - new Date(fail.lastAt).getTime() < BACKOFF_MS ? "failed recently, trying again later" as const : state.graphAttempts >= settings.graphDailyLimit ? "daily limit reached" as const : undefined;
      // When it may next be tried: after the quiet time; after a failure's pause; tomorrow if today's limit is used; never, until something changes, otherwise.
      const dueAt = blocked === idle || blocked === "failed three times, waits for a change" ? undefined : blocked === "failed recently, trying again later" ? new Date(Math.max(quietAt.getTime(), new Date(fail!.lastAt).getTime() + BACKOFF_MS)) : blocked === "daily limit reached" ? midnight : quietAt;
      waiting.push({ kind: item.kind, id: item.id, title: item.title, destination: "graph", reason: at ? "changed since it was saved" : "not saved yet", ...(dueAt ? { dueAt: dueAt.toISOString() } : {}), ...(blocked ? { blocked } : {}) });
      if (!blocked && quietAt <= now) graphDue.push(item);
    }
  }
  return { waiting, wikiDue, graphDue, active };
}

/** One check. Brings the wiki up to date, then reads at most one item into the graph. */
export async function scanOnce(ctx: AutoContext): Promise<{ events: AutoEvent[]; waiting: Waiting[] }> {
  const now = ctx.now?.() ?? new Date(), settings = await readSettings(ctx.dir), state = await readState(ctx.dir, now), events: AutoEvent[] = [], at = () => (ctx.now?.() ?? new Date()).toISOString();
  const { waiting, wikiDue, graphDue } = await plan(ctx, settings, state, now);
  for (const item of wikiDue) {
    try { const r = await saveToWiki(ctx.syncer.deps, item.kind, item.id); events.push({ at: at(), destination: "wiki", kind: item.kind, id: item.id, result: r.action }); }
    catch (error) { events.push({ at: at(), destination: "wiki", kind: item.kind, id: item.id, result: "failed", note: error instanceof Error ? error.message.slice(0, 160) : "failed" }); }
  }
  const item = graphDue[0];
  if (item) {
    const key = `${item.kind}:${item.id}`;
    const attempt = async (model: string) => { state.graphAttempts++; await atomic(stateFile(ctx.dir), state); return ctx.syncer.sync(item.kind, item.id, model); };
    try {
      let result; try { result = await attempt("muse-wonder-1.0"); } catch (error) { if (error instanceof SyncError && /output space/i.test(error.message) && state.graphAttempts < settings.graphDailyLimit) result = await attempt("muse-spark-1.3"); else throw error; }
      delete state.failures[key]; events.push({ at: at(), destination: "graph", kind: item.kind, id: item.id, result: result.duplicate ? "unchanged" : result.replaced ? "replaced" : "added" });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "failed", prior = state.failures[key];
      state.failures[key] = { count: prior && prior.lastAt >= item.changedAt ? prior.count + 1 : 1, lastAt: at(), message }; events.push({ at: at(), destination: "graph", kind: item.kind, id: item.id, result: "failed", note: message });
    }
  }
  state.events = [...state.events, ...events].slice(-MAX_EVENTS); state.lastScanAt = at(); await atomic(stateFile(ctx.dir), state);
  return { events, waiting: waiting.filter(w => !events.some(e => e.kind === w.kind && e.id === w.id && e.destination === w.destination && e.result !== "failed")) };
}

export async function snapshot(ctx: AutoContext) {
  const now = ctx.now?.() ?? new Date(), settings = await readSettings(ctx.dir), state = await readState(ctx.dir, now), { waiting, active } = await plan(ctx, settings, state, now);
  return { settings, activeToday: active, today: { graphAttempts: state.graphAttempts, limit: settings.graphDailyLimit }, ...(state.lastScanAt ? { lastScanAt: state.lastScanAt } : {}), recent: state.events.slice(-10).reverse(), waiting };
}

/** The files whose change means an item changed. Writes go through a temporary file first, so only the final names count. */
export const WATCHED = /(^|\/)(run\.json|descend\.json|workshop\.json|report\.md)$/;
/** How long until something next becomes due, or null when nothing will without a change. */
export function nextWake(waiting: Waiting[], now: Date): number | null {
  const left = waiting.filter(w => w.dueAt).map(w => new Date(w.dueAt!).getTime() - now.getTime());
  return left.length ? Math.max(500, Math.min(...left) + 500) : null;
}

/**
 * Runs checks when something happens, not on a clock. A change to an item's file starts a check a few seconds later, so a burst of writes is one check, and an item that
 * becomes due after its quiet time or its pause gets a check at that moment. The graph reads one item per check, so a check that leaves more due asks for another soon.
 * A slow check remains as a safety net, because file watching can miss events. Writes by other processes, such as an agent using the MCP server, are seen through the files.
 */
export function startAutoSync(ctx: AutoContext, { every = 15 * 60_000, first = 20_000, debounce = 3_000, drain = 5_000, roots = [] }: { every?: number; first?: number; debounce?: number; drain?: number; roots?: string[] } = {}) {
  let busy = false, again = false, stopped = false, due: number | null = null, timer: ReturnType<typeof setTimeout> | undefined; const watchers: FSWatcher[] = [];
  const arm = (afterMs: number) => { if (stopped) return; const at = Date.now() + afterMs; if (due !== null && due <= at) return; due = at; clearTimeout(timer); timer = setTimeout(() => { void fire(); }, afterMs); timer.unref?.(); };
  const fire = async () => {
    due = null; if (busy) { again = true; return; } busy = true;
    try {
      const done = await scanOnce(ctx), now = ctx.now?.() ?? new Date(), stillDue = done.waiting.some(w => !w.blocked && w.dueAt && new Date(w.dueAt) <= now);
      if (stillDue) arm(drain); const wake = nextWake(done.waiting, now); if (wake !== null) arm(wake);
    } catch (error) { console.error("Auto-sync check failed:", error instanceof Error ? error.message : error); }
    finally { busy = false; if (again) { again = false; arm(debounce); } arm(every); }
  };
  for (const root of roots) { void mkdir(root, { recursive: true }).then(() => { if (stopped) return; try { watchers.push(watch(root, { recursive: true }, (_event, name) => { if (!name || WATCHED.test(String(name))) arm(debounce); })); } catch { /* the safety-net check still runs */ } }, () => undefined); }
  arm(first);
  return () => { stopped = true; clearTimeout(timer); for (const w of watchers) w.close(); };
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export const defaultAutoDir = fileURLToPath(new URL("../autosync/", import.meta.url));
export const autoInfo = async (dir = defaultAutoDir) => { const s = await readSettings(dir); return { wiki: s.wiki, graph: s.graph, quietMinutes: s.quietMinutes }; };
export function createAutoHandler(ctx: AutoContext) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method !== "GET" && (req.headers.get("origin") !== url.origin || (req.headers.has("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin"))) return json({ error: "Use auto-sync from this app." }, 403);
    try {
      if (req.method === "GET" && url.pathname === "/api/autosync") return json(await snapshot(ctx));
      if (req.method === "POST" && url.pathname === "/api/autosync/settings") { const next = parseSettings(JSON.parse(await req.text()), await readSettings(ctx.dir)); await writeSettings(ctx.dir, next); return json({ settings: next }); }
      if (req.method === "POST" && url.pathname === "/api/autosync/run") { const r = await scanOnce(ctx); return json({ events: r.events, waiting: r.waiting }); }
      return json({ error: "Unknown auto-sync operation." }, 404);
    } catch (error) { return json({ error: error instanceof Error ? error.message.slice(0, 300) : "Auto-sync failed." }, 400); }
  };
}
export function autoSyncPlugin(options: SyncOptions & { dir?: string }): Plugin {
  const dir = resolve(options.dir ?? defaultAutoDir), ctx: AutoContext = { dir, syncer: createGraphSyncer(options) }, handle = createAutoHandler(ctx);
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/autosync")) return next();
    try {
      const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 10_000) { res.statusCode = 413; res.end(JSON.stringify({ error: "Request too large." })); return; } chunks.push(chunk as Buffer); }
      const headers = new Headers(); for (const name of ["origin", "sec-fetch-site", "content-type"]) { const value = req.headers[name]; if (typeof value === "string") headers.set(name, value); }
      const response = await handle(new Request(new URL(req.url, `http://${req.headers.host ?? "localhost"}`), { method: req.method, headers, ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}) }));
      res.statusCode = response.status; response.headers.forEach((v, k) => res.setHeader(k, v)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.statusCode = 500; res.end(JSON.stringify({ error: "Auto-sync failed." })); }
  };
  return { name: "local-autosync", configureServer(server) { server.middlewares.use(middleware); const stop = startAutoSync(ctx, { roots: [ctx.syncer.deps.runsRoot, ctx.syncer.deps.descendRoot, ctx.syncer.deps.workshopRoot] }); server.httpServer?.once("close", stop); } };
}
