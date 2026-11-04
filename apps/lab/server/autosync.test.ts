// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeToday, createAutoHandler, nextWake, parseSettings, readSettings, readState, scanOnce, snapshot, startAutoSync, WATCHED, writeSettings, type AutoContext } from "./autosync";
import { createGraphSyncer } from "./knowledgeSync";
import type { KnowledgeEntry } from "../src/domain/knowledge";

// The tests use the real clock. An item counts as "changed today" by the local date, so a test run in the first minute or two after midnight can see yesterday's date and fail. That window is the only flake.
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const RUN = "run-20261104020213-fd1e", DESC = "desc-20261104100000-aaaa", WS = "ws-20261104110000-bbbb", origin = "http://localhost:5173", MIN = 60_000, sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const iso = (t: number) => new Date(t).toISOString();
const run = (updatedAt: string, status = "done") => ({ id: RUN, paperId: "paper-0001", title: "ACO study", mode: "external", status, createdAt: "2026-11-04T02:02:00.000Z", updatedAt, model: "m", rounds: { max: 0, used: 1 }, tokens: { cap: 1, used: 0 }, stages: [], assumptions: [], stepCount: 13, results: [] });
const exploration = (updatedAt: string, status = "done") => ({ id: DESC, runId: RUN, paperId: "paper-0001", title: "ACO study", goal: "Can ACO go to the real world?", model: "m", status, online: true, repos: [], scoutQueries: [], replication: { rating: "Early attempt", verified: 0, total: 17, coveragePercent: 69 }, tokens: { used: 1, cap: 2 }, findings: [], verdict: "feasible_with_changes", report: "# Study\n\nPossible.\n", nextSteps: [], events: [], createdAt: updatedAt, updatedAt });
const workshop = (updatedAt: string, status = "ready") => ({ id: WS, descendId: DESC, paperId: "paper-0001", title: "ACO study", goal: "Can ACO go to the real world?", model: "m", status, createdAt: updatedAt, updatedAt, replication: { rating: "Early attempt", verified: 0, total: 17, coveragePercent: 69 }, summary: "s", report: "r", nextSteps: [], repos: [], hypotheses: [{ id: "H1", statement: "A claim", test: "t", success: "s", status: "untested", evidence: [] }], experiments: [], log: [] });
/** `changed` is how many minutes ago the items last changed, and `quiet` is the quiet time. */
async function setup(opts: { changed?: number; quiet?: number; ingest?: (n: number, body: Record<string, unknown>) => Response | null; unfinished?: boolean; settings?: boolean } = {}) {
  const base = await mkdtemp(join(tmpdir(), "autosync-")); dirs.push(base);
  const clock = { t: Date.now() }, changed = clock.t - (opts.changed ?? 1.5) * MIN;
  const roots = { root: join(base, "wiki"), runsRoot: join(base, "runs"), descendRoot: join(base, "desc"), workshopRoot: join(base, "ws") };
  const put = async (dir: string, file: string, value: unknown) => { await mkdir(dir, { recursive: true }); await writeFile(join(dir, file), JSON.stringify(value)); };
  const fill = (stamp: number) => Promise.all([put(join(roots.runsRoot, RUN), "run.json", run(iso(stamp), opts.unfinished ? "coding" : "done")), put(join(roots.descendRoot, DESC), "descend.json", exploration(iso(stamp), opts.unfinished ? "researching" : "done")), put(join(roots.workshopRoot, WS), "workshop.json", workshop(iso(stamp), opts.unfinished ? "preparing" : "ready"))]);
  await fill(changed);
  const entries: KnowledgeEntry[] = [], calls: { kind: string; id: string; model: string }[] = []; let n = 0;
  const knowledge = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname, body = req.method === "GET" ? undefined : await req.json().catch(() => undefined);
    if (path === "/api/knowledge" && req.method === "GET") return Response.json({ entries });
    if (req.method === "DELETE") { const i = entries.findIndex(e => path.endsWith(e.id)); if (i >= 0 && body?.confirmed === true) { entries.splice(i, 1); return Response.json({ deleted: true }); } return Response.json({ error: "no" }, { status: 400 }); }
    if (path === "/api/knowledge/ingest") {
      calls.push({ kind: body.origin.kind, id: body.origin.id, model: body.model }); n++; const forced = opts.ingest?.(n, body); if (forced) return forced;
      const dup = entries.find(e => e.sha256 === body.text && e.origin?.id === body.origin.id); if (dup) return Response.json({ entry: dup, duplicate: true });
      const entry = { id: `entry-${n}`, title: body.title, source: "t", sha256: body.text, addedAt: iso(clock.t), models: [body.model], status: "stored", origin: body.origin } as KnowledgeEntry; entries.push(entry); return Response.json({ entry });
    }
    return Response.json({ error: "unexpected" }, { status: 404 });
  };
  const ctx: AutoContext = { dir: join(base, "autosync"), syncer: createGraphSyncer({ ...roots, knowledge }), now: () => new Date(clock.t) };
  if (opts.settings !== false) await writeSettings(ctx.dir, { wiki: true, graph: true, quietMinutes: opts.quiet ?? 1, graphDailyLimit: 20 });
  return { ctx, clock, entries, calls, roots, touch: fill, base };
}
const graphOf = (events: { destination: string; result: string }[]) => events.filter(e => e.destination === "graph").map(e => e.result);
const wikiOf = (events: { destination: string; result: string }[]) => events.filter(e => e.destination === "wiki").map(e => e.result);

describe("auto-sync: what it does and when", () => {
  it("waits for the quiet time before touching the wiki or the graph, so work in progress is never pushed", async () => {
    const t = await setup({ changed: 0.2, quiet: 1 }), early = await scanOnce(t.ctx);
    expect(early.events).toEqual([]); expect(t.calls).toEqual([]); expect(early.waiting).toHaveLength(6); expect(early.waiting.every(w => w.dueAt && !w.blocked)).toBe(true); // three items, two places each, all counting down
    t.clock.t += 0.7 * MIN; expect((await scanOnce(t.ctx)).events).toEqual([]);
    t.clock.t += 0.2 * MIN; const due = await scanOnce(t.ctx); expect(wikiOf(due.events)).toEqual(["saved", "saved", "saved"]); expect(graphOf(due.events)).toEqual(["added"]);
  });
  it("brings the wiki up to date, then reads one item into the graph per check", async () => {
    const t = await setup(), a = await scanOnce(t.ctx);
    expect(wikiOf(a.events)).toEqual(["saved", "saved", "saved"]); expect(graphOf(a.events)).toEqual(["added"]); expect(t.calls).toHaveLength(1);
    const b = await scanOnce(t.ctx), c = await scanOnce(t.ctx); expect(graphOf(b.events)).toEqual(["added"]); expect(graphOf(c.events)).toEqual(["added"]); expect(new Set(t.calls.map(x => x.id)).size).toBe(3);
    const d = await scanOnce(t.ctx); expect(d.events).toEqual([]); expect(d.waiting).toEqual([]); expect(t.calls).toHaveLength(3); expect((await readState(t.ctx.dir, new Date(t.clock.t))).graphAttempts).toBe(3);
  });
  it("follows a change: the wiki is rewritten and the graph entry replaced, each after the quiet time", async () => {
    const t = await setup(); for (let i = 0; i < 3; i++) await scanOnce(t.ctx); expect(t.entries).toHaveLength(3);
    t.clock.t += 5 * MIN; await t.touch(t.clock.t); // every item changes now
    const during = await scanOnce(t.ctx); expect(during.events).toEqual([]); expect(during.waiting.every(w => w.reason === "changed since it was saved" && !!w.dueAt)).toBe(true);
    t.clock.t += 1.1 * MIN; const after = await scanOnce(t.ctx); expect(wikiOf(after.events)).toEqual(["refreshed", "refreshed", "refreshed"]); expect(graphOf(after.events)).toEqual(["replaced"]); expect(t.entries).toHaveLength(3);
  });
  it("pushes nothing on a day when nothing changed, and lets the backlog go once something changes", async () => {
    const t = await setup({ changed: 1.5 }); expect(activeToday([{ kind: "workshop", id: "x", title: "", changedAt: iso(t.clock.t - 90_000) }], new Date(t.clock.t))).toBe(true);
    t.clock.t += 24 * 60 * MIN; // the next day, and nothing has changed since
    const idle = await scanOnce(t.ctx); expect(idle.events).toEqual([]); expect(t.calls).toEqual([]); expect(idle.waiting).toHaveLength(6); expect(idle.waiting.every(w => w.blocked === "no changes today" && !w.dueAt)).toBe(true);
    expect((await snapshot(t.ctx)).activeToday).toBe(false);
    t.clock.t += 5 * MIN; await t.touch(t.clock.t - 1.5 * MIN); // one thing changes, and has been quiet since
    const woke = await scanOnce(t.ctx); expect((await snapshot(t.ctx)).activeToday).toBe(true); expect(wikiOf(woke.events)).toHaveLength(3); expect(graphOf(woke.events)).toEqual(["added"]);
  });
  it("stops at the daily limit, and carries on the next day only if something changed that day", async () => {
    const t = await setup(); await writeSettings(t.ctx.dir, { ...(await readSettings(t.ctx.dir)), graphDailyLimit: 2 });
    await scanOnce(t.ctx); await scanOnce(t.ctx); const third = await scanOnce(t.ctx); expect(graphOf(third.events)).toEqual([]); expect(t.calls).toHaveLength(2);
    expect(third.waiting.find(w => w.destination === "graph")).toMatchObject({ blocked: "daily limit reached" }); expect(third.waiting.find(w => w.blocked === "daily limit reached")!.dueAt).toBeTruthy();
    t.clock.t += 24 * 60 * MIN; expect(graphOf((await scanOnce(t.ctx)).events)).toEqual([]); expect(t.calls).toHaveLength(2); // a quiet day: the counter is fresh but nothing is pushed
    t.clock.t += MIN; await t.touch(t.clock.t - 1.5 * MIN); expect(graphOf((await scanOnce(t.ctx)).events)).toHaveLength(1); expect(t.calls).toHaveLength(3);
    await writeSettings(t.ctx.dir, { ...(await readSettings(t.ctx.dir)), graphDailyLimit: 0 }); t.clock.t += 24 * 60 * MIN; await t.touch(t.clock.t - 1.5 * MIN); expect((await snapshot(t.ctx)).waiting.some(w => w.blocked === "daily limit reached")).toBe(true);
  });
  it("backs off an item that keeps failing, and waits for a change after three failures", async () => {
    const t = await setup({ ingest: n => n <= 3 ? Response.json({ error: "Muse extraction failed" }, { status: 502 }) : null });
    const one = await scanOnce(t.ctx), failed = one.events.find(e => e.destination === "graph")!; expect(failed).toMatchObject({ result: "failed", note: "Muse extraction failed" });
    const soon = await scanOnce(t.ctx); expect(soon.events.find(e => e.destination === "graph")!.id).not.toBe(failed.id); // the failed item is skipped, the next one is read
    const blocked = (await snapshot(t.ctx)).waiting.find(w => w.id === failed.id && w.destination === "graph")!; expect(blocked.blocked).toBe("failed recently, trying again later"); expect(new Date(blocked.dueAt!).getTime()).toBeGreaterThan(t.clock.t + 29 * MIN);
    t.clock.t += 31 * MIN; await t.touch(t.clock.t - 1.5 * MIN); await scanOnce(t.ctx); t.clock.t += 31 * MIN; await scanOnce(t.ctx);
    expect(Object.values((await readState(t.ctx.dir, new Date(t.clock.t))).failures).length + t.calls.length).toBeGreaterThan(2);
  });
  it("tries the other model once when Muse runs out of output space, and counts both tries", async () => {
    const t = await setup({ ingest: n => n === 1 ? Response.json({ error: "Muse ran out of output space during reading chunk 2." }, { status: 400 }) : null });
    const a = await scanOnce(t.ctx); expect(t.calls.slice(0, 2).map(c => c.model)).toEqual(["muse-wonder-1.0", "muse-spark-1.3"]); expect(graphOf(a.events)).toEqual(["added"]); expect((await readState(t.ctx.dir, new Date(t.clock.t))).graphAttempts).toBe(2);
  });
  it("obeys the switches, and ignores anything not finished", async () => {
    const t = await setup(); await writeSettings(t.ctx.dir, { wiki: false, graph: false, quietMinutes: 1, graphDailyLimit: 20 }); const off = await scanOnce(t.ctx); expect(off.events).toEqual([]); expect(off.waiting).toEqual([]); expect(t.calls).toEqual([]);
    await writeSettings(t.ctx.dir, { wiki: true, graph: false, quietMinutes: 1, graphDailyLimit: 20 }); expect(graphOf((await scanOnce(t.ctx)).events)).toEqual([]); expect(t.calls).toEqual([]); expect(await readFile(join(t.roots.root, "index.md"), "utf8")).toContain("1 replication");
    const early = await setup({ unfinished: true }); const e = await scanOnce(early.ctx); expect(e.events).toEqual([]); expect(early.calls).toEqual([]);
  });
  it("checks and limits the settings", () => {
    expect(parseSettings({ graph: false, quietMinutes: 30 })).toEqual({ wiki: true, graph: false, quietMinutes: 30, graphDailyLimit: 20 });
    for (const bad of [null, [], { x: 1 }, { wiki: "yes" }, { quietMinutes: 0 }, { quietMinutes: 241 }, { quietMinutes: 1.5 }, { graphDailyLimit: -1 }, { graphDailyLimit: 101 }]) expect(() => parseSettings(bad)).toThrow();
  });
  it("serves the status and the settings, refuses other origins, and runs a check on request", async () => {
    const t = await setup({ settings: false }), handle = createAutoHandler(t.ctx);
    const call = (path: string, body?: unknown, from = origin) => handle(new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: from, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    const snap = await (await call("/api/autosync")).json(); expect(snap).toMatchObject({ settings: { wiki: true, graph: true, quietMinutes: 10, graphDailyLimit: 20 }, activeToday: true, today: { graphAttempts: 0, limit: 20 } }); expect(snap.waiting).toHaveLength(6);
    expect((await call("/api/autosync/settings", { graph: false }, "http://evil.example")).status).toBe(403); expect((await call("/api/autosync/settings", { quietMinutes: 0 })).status).toBe(400);
    expect((await (await call("/api/autosync/settings", { quietMinutes: 1 })).json()).settings.quietMinutes).toBe(1);
    const ran = await (await call("/api/autosync/run", {})).json(); expect(ran.events.length).toBeGreaterThan(0); expect((await (await call("/api/autosync")).json()).recent.length).toBeGreaterThan(0); expect((await call("/api/autosync/nope")).status).toBe(404);
  });
});

describe("auto-sync: it reacts to changes instead of running on a clock", () => {
  it("only counts a change to an item's own files, ignoring temporary and log files", () => {
    for (const yes of ["run-20261104020213-fd1e/run.json", "desc-1/descend.json", "ws-1/workshop.json", "run-1/report.md", "run.json"]) expect(WATCHED.test(yes), yes).toBe(true);
    for (const no of ["run-1/events.jsonl", "run-1/run.json.1a2b.tmp", "run-1/code/impl.py", "ws-1/code/run.json.bak", "_memory/p.json"]) expect(WATCHED.test(no), no).toBe(false);
  });
  it("works out when the next thing becomes due, and when nothing will", () => {
    const now = new Date("2026-11-04T10:00:00.000Z"), w = (dueAt?: string, destination: "wiki" | "graph" = "graph") => ({ kind: "workshop" as const, id: "x", title: "", destination, reason: "not saved yet" as const, ...(dueAt ? { dueAt } : {}) });
    expect(nextWake([w("2026-11-04T10:10:00.000Z"), w("2026-11-04T10:03:00.000Z", "wiki")], now)).toBe(3 * MIN + 500); expect(nextWake([w()], now)).toBeNull(); expect(nextWake([], now)).toBeNull(); expect(nextWake([w("2026-11-04T09:00:00.000Z")], now)).toBe(500);
  });
  it("does nothing until a file changes, then updates the wiki after the pause, with no timer polling", async () => {
    const t = await setup({ changed: 1.5 }); await sleep(1500); // the system replays file events from just before a watch starts, so let those pass first
    const stop = startAutoSync(t.ctx, { every: 600_000, first: 600_000, debounce: 40, roots: [t.roots.runsRoot, t.roots.descendRoot, t.roots.workshopRoot] });
    await sleep(400); expect(await readFile(join(t.ctx.dir, "state.json"), "utf8").catch(() => "")).toBe(""); // no change, so no check at all
    await writeFile(join(t.roots.workshopRoot, WS, "workshop.json"), JSON.stringify(workshop(iso(t.clock.t - 90_000)))); // a change to one file
    for (let i = 0; i < 100 && !(await readFile(join(t.roots.root, "workshops", `${WS}.md`), "utf8").catch(() => "")); i++) await sleep(50);
    stop(); expect(await readFile(join(t.roots.root, "workshops", `${WS}.md`), "utf8")).toContain("Workshop:"); expect((await readState(t.ctx.dir, new Date(t.clock.t))).lastScanAt).toBeTruthy();
  });
  it("wakes up by itself at the moment an item becomes due", async () => {
    const t = await setup({ changed: 0.98, quiet: 1 }); t.ctx.now = () => new Date(); // a real clock, so the moment really arrives
    const stop = startAutoSync(t.ctx, { every: 600_000, first: 30, debounce: 30 }); // due in about 1.2 seconds
    await sleep(300); expect(t.calls).toEqual([]); // the first check found it still counting down
    for (let i = 0; i < 100 && t.calls.length < 1; i++) await sleep(50);
    stop(); expect(t.calls.length).toBe(1); expect(t.entries).toHaveLength(1); // read once the time came, with nothing else asking for a check
  }, 15000);
  it("keeps reading while more items are due, one per check, and stops asking when none are left", async () => {
    const t = await setup(), stop = startAutoSync(t.ctx, { every: 600_000, first: 20, debounce: 20, drain: 40 });
    for (let i = 0; i < 160 && t.calls.length < 3; i++) await sleep(50);
    await sleep(300); stop(); expect(new Set(t.calls.map(c => c.id)).size).toBe(3); expect(t.calls).toHaveLength(3);
  });
  it("stops watching and checking when told to", async () => {
    const t = await setup({ changed: 1.5 }); await sleep(1500); const stop = startAutoSync(t.ctx, { every: 600_000, first: 600_000, debounce: 30, roots: [t.roots.workshopRoot] }); await sleep(200); stop();
    await writeFile(join(t.roots.workshopRoot, WS, "workshop.json"), JSON.stringify(workshop(iso(t.clock.t - 90_000)))); await sleep(400);
    expect(await readFile(join(t.ctx.dir, "state.json"), "utf8").catch(() => "")).toBe(""); expect(t.calls).toEqual([]);
  });
});
