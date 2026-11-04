// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPaperRunHandler } from "./paperrun";
import { saveEnvironment } from "./environments";
import { readEvents, readRun, updateRun, writeCodeFile } from "./paperrunCore";
import { validateReplicationSpec } from "./knowledgeReplication";
const python = resolve(__dirname, "../paperruns/.venv/bin/python");
const sandboxed = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && existsSync(python);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const paper = "We set the colony size to 50 ants. In a 20*20 grid map the improved strategy converged in the 23rd iteration.";
const spec = validateReplicationSpec({ goal: "g", steps: [{ name: "s", description: "d", quote: "colony size to 50 ants" }], parameters: [], reportedResults: [{ description: "iterations", value: "23rd iteration", condition: "", quote: "converged in the 23rd iteration" }], gaps: [] }, paper);
const meta = { title: "ACO study", model: "muse-wonder-1.0", builtAt: "2026-11-03T10:00:00.000Z" };
const origin = "http://localhost:5173";
const call = (handle: (r: Request) => Promise<Response>, path: string, body?: unknown, method = body === undefined ? "GET" : "POST", from = origin) => handle(new Request(`${origin}${path}`, { method, headers: { origin: from, "sec-fetch-site": "same-origin", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
async function setup(extra: { key?: string; python?: string; pipeline?: never; continuation?: never; send?: typeof fetch; knowledge?: (req: Request) => Promise<Response>; sandboxAvailable?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "paperrun-http-")); dirs.push(root);
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const knowledge = extra.knowledge ?? (async (req: Request) => { requests.push({ path: new URL(req.url).pathname, body: await req.json() }); return Response.json({ status: "spec", paper: { id: "paper-0001", title: "ACO study" }, spec, meta }); });
  const pipeline = vi.fn<(deps: unknown, id: string, signal: AbortSignal) => Promise<void>>().mockImplementation(async (_deps, _id, signal) => { await new Promise(resolveWait => { if (signal.aborted) return resolveWait(null); signal.addEventListener("abort", () => resolveWait(null), { once: true }); }); });
  const continuation = vi.fn<(deps: unknown, id: string, input: { rounds: number; addTokens: number; guidance: string }, signal: AbortSignal) => Promise<void>>().mockResolvedValue(undefined);
  const environmentsRoot = join(root, "..", `envs-${Math.random().toString(16).slice(2, 8)}`); dirs.push(environmentsRoot);
  const handle = createPaperRunHandler(extra.key ?? "fixture-secret", { root, environmentsRoot, python: extra.python ?? python, knowledge, pipeline: pipeline as never, continuation: continuation as never, ...(extra.send ? { send: extra.send } : {}), ...(extra.sandboxAvailable !== undefined ? { sandboxAvailable: extra.sandboxAvailable } : {}) });
  return { root, handle, requests, pipeline, continuation, environmentsRoot };
}
describe("PaperRun routes", () => {
  it("reports whether the sandbox and Python environment are ready, with the MCP configuration", async () => {
    const t = await setup({ python: join(tmpdir(), "no-such-python") });
    const status = await (await call(t.handle, "/api/paperrun/status")).json();
    expect(status).toMatchObject({ ready: false, configured: true }); expect(status.problem === null || /paperrun:setup|macOS/.test(status.problem)).toBe(true);
    expect(status.mcp).toMatchObject({ command: "node", args: ["--experimental-strip-types", expect.stringContaining("paperrunMcp.ts")], env: { PAPERRUN_ROOT: t.root } });
    expect((await (await call((await setup({ sandboxAvailable: false })).handle, "/api/paperrun/status")).json()).problem).toContain("macOS");
  });
  it("validates start requests and refuses other origins", async () => {
    const t = await setup();
    for (const bad of [{}, { paper: "p" }, { paper: "p", mode: "fast" }, { paper: "p", mode: "muse", rounds: 7 }, { paper: "p", mode: "muse", rounds: 1.5 }, { paper: "p", mode: "muse", tokenCap: 100 }, { paper: "p", mode: "muse", model: "gpt" }, { paper: "p", mode: "muse", extra: 1 }]) expect((await call(t.handle, "/api/paperrun/start", bad)).status).toBe(400);
    expect((await call(t.handle, "/api/paperrun/start", { paper: "p", mode: "external" }, "POST", "https://other.site")).status).toBe(403);
    expect(t.requests).toEqual([]);
  });
  it("prepares a run for an external agent without needing a key, and hands back the folder and MCP config", async () => {
    const t = await setup({ key: "" });
    const started = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external", rounds: 2 })).json();
    expect(started.run).toMatchObject({ status: "waiting_external", mode: "external", paperId: "paper-0001", rounds: { max: 2 } }); expect(started.directory).toContain(started.run.id); expect(started.mcp.env.PAPERRUN_ROOT).toBe(t.root);
    expect(t.requests[0]).toMatchObject({ path: "/api/knowledge/replication", body: { paper: "ACO", model: "muse-wonder-1.0" } }); expect(t.pipeline).not.toHaveBeenCalled();
    expect((await (await call(t.handle, "/api/paperrun")).json()).runs.map((r: { id: string }) => r.id)).toEqual([started.run.id]);
  });
  it.runIf(sandboxed)("starts a Muse run in the background, allows one at a time, and cancels on request", async () => {
    const t = await setup();
    const first = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "muse", model: "muse-spark-1.3", tokenCap: 100000 })).json();
    expect(first.run).toMatchObject({ status: "queued", model: "muse-spark-1.3", tokens: { cap: 100000 }, rounds: { max: 4 } }); expect(first.mcp).toBeUndefined();
    expect(t.pipeline).toHaveBeenCalledTimes(1); expect(t.pipeline.mock.calls[0]![0]).toMatchObject({ root: t.root, key: "fixture-secret" }); expect(t.pipeline.mock.calls[0]![1]).toBe(first.run.id);
    expect((await (await call(t.handle, `/api/paperrun/${first.run.id}`)).json()).active).toBe(true); expect((await (await call(t.handle, "/api/paperrun/status")).json()).running).toEqual([first.run.id]);
    const second = await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "muse" }); expect(second.status).toBe(409); expect((await second.json()).error).toContain("Another PaperRun");
    expect((await call(t.handle, `/api/paperrun/${first.run.id}/cancel`, {})).status).toBe(200);
    expect((t.pipeline.mock.calls[0]![2] as AbortSignal).aborted).toBe(true); await new Promise(r => setTimeout(r, 30));
    expect((await (await call(t.handle, `/api/paperrun/${first.run.id}`)).json()).active).toBe(false);
  });
  it("refuses a Muse run without a key, and forwards spec problems", async () => {
    expect((await call((await setup({ key: "" })).handle, "/api/paperrun/start", { paper: "ACO", mode: "muse" })).status).toBe(503);
    const none = await setup({ knowledge: async () => Response.json({ status: "not_found", papers: [{ id: "x", title: "Other" }] }) });
    const missing = await call(none.handle, "/api/paperrun/start", { paper: "ACO", mode: "external" }); expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ error: "That paper is not in the knowledge base.", papers: [{ title: "Other" }] });
    const ambiguous = await setup({ knowledge: async () => Response.json({ status: "ambiguous", papers: [] }) }); expect((await (await call(ambiguous.handle, "/api/paperrun/start", { paper: "ACO", mode: "external" })).json()).error).toContain("More than one");
    const failed = await setup({ knowledge: async () => Response.json({ error: "Muse ran out of output space" }, { status: 400 }) }); const bad = await call(failed.handle, "/api/paperrun/start", { paper: "ACO", mode: "external" }); expect(bad.status).toBe(400); expect((await bad.json()).error).toContain("ran out of output space");
  });
  it("serves run details and only allow-listed files", async () => {
    const t = await setup(); const { run } = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external" })).json();
    await writeCodeFile(t.root, run.id, "impl.py", "x = 1\n");
    const detail = await (await call(t.handle, `/api/paperrun/${run.id}`)).json(); expect(detail).toMatchObject({ run: { id: run.id }, files: [{ path: "impl.py", bytes: 6 }], report: null, active: false }); expect(detail.events[0].kind).toBe("created");
    const file = async (path: string) => call(t.handle, `/api/paperrun/${run.id}/file?path=${encodeURIComponent(path)}`);
    expect((await (await file("code/impl.py")).json()).content).toBe("x = 1\n"); expect((await (await file("brief.md")).json()).content).toContain("RESULTS CONTRACT"); expect((await (await file("spec.md")).json()).content).toContain("Reproduction spec");
    for (const bad of ["run.json", "../run.json", "code/../run.json", "code/.hidden.py", "code//etc/passwd", "events.jsonl", "rounds/1/../../run.json", "/etc/passwd"]) expect((await file(bad)).status).toBe(400);
    expect((await call(t.handle, "/api/paperrun/run-20260101000000-abcd")).status).toBe(404); expect((await call(t.handle, "/api/paperrun/not-a-run")).status).toBe(404);
  });
  it.runIf(sandboxed)("runs the tests of an external agent's files in the sandbox, and finishes the run with a report", async () => {
    const t = await setup(); const { run } = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external" })).json();
    await writeCodeFile(t.root, run.id, "run_tests.py", "import json\njson.dump({'results': [{'id': 'R1', 'reproduced': 24, 'tolerance': 0.1, 'note': 'seed 0'}]}, open('results.json', 'w'))\n");
    const tests = await (await call(t.handle, `/api/paperrun/${run.id}/run-tests`, {})).json(); expect(tests.rows[0]).toMatchObject({ id: "R1", status: "within_tolerance", reproduced: "24" });
    expect(await readRun(t.root, run.id)).toMatchObject({ status: "waiting_external", rounds: { used: 1 } });
    const finished = await (await call(t.handle, `/api/paperrun/${run.id}/finish`, { summary: "Implemented with seed 0." })).json(); expect(finished.report).toContain("1 within tolerance"); expect(finished.report).toContain("Implemented with seed 0."); expect(finished.report).toContain("an external coding agent");
    expect(await readRun(t.root, run.id)).toMatchObject({ status: "done" }); expect((await readEvents(t.root, run.id)).at(-1)!.message).toContain("Finished by an external agent");
    expect((await (await call(t.handle, `/api/paperrun/${run.id}`)).json()).report).toContain("# PaperRun report");
  });
  it("lets Muse assess method coverage of a run after the fact, and refuses without code or a key", async () => {
    const review = { verdict: "concerns", concerns: [{ severity: "high", description: "Step 1 is skipped." }], stepCoverage: [{ n: 1, status: "missing", note: "Not in the code." }] };
    const send = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ model: "muse-wonder-1.0", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(review) } }], usage: { total_tokens: 18000 } }));
    const t = await setup({ send }); const { run } = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external" })).json();
    const empty = await call(t.handle, `/api/paperrun/${run.id}/assess`, {}); expect(empty.status).toBe(400); expect((await empty.json()).error).toContain("no code to assess"); expect(send).not.toHaveBeenCalled();
    await writeCodeFile(t.root, run.id, "impl.py", "x = 1\n");
    const done = await (await call(t.handle, `/api/paperrun/${run.id}/assess`, {})).json();
    expect(done.stepCoverage).toEqual([{ n: 1, status: "missing", note: "Not in the code." }]); expect(done.concerns).toEqual(["[high] Step 1 is skipped."]); expect(done.run).toMatchObject({ stepCoverage: [{ n: 1 }], review: "[high] Step 1 is skipped.", tokens: { used: 18000 } });
    expect((await readEvents(t.root, run.id)).at(-1)!.message).toBe("Method review: 0 of 1 steps implemented, 1 concern(s).");
    expect((await call((await setup({ key: "" })).handle, "/api/paperrun/run-20260101000000-abcd/assess", {})).status).toBe(404);
    const keyless = await setup({ key: "" }); const prepared = await (await call(keyless.handle, "/api/paperrun/start", { paper: "ACO", mode: "external" })).json(); expect((await call(keyless.handle, `/api/paperrun/${prepared.run.id}/assess`, {})).status).toBe(503);
  });
  it("returns the spec's gaps with a run's details", async () => {
    const t = await setup(); const { run } = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external" })).json();
    expect((await (await call(t.handle, `/api/paperrun/${run.id}`)).json()).gaps).toEqual([]);
  });
  it.runIf(sandboxed)("continues a finished Muse run with guidance from its review, and applies the rules", async () => {
    const t = await setup(); const { run } = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "muse" })).json();
    expect((await call(t.handle, `/api/paperrun/${run.id}/continue`, {})).status).toBe(409);
    await call(t.handle, `/api/paperrun/${run.id}/cancel`, {}); await new Promise(r => setTimeout(r, 30));
    await updateRun(t.root, run.id, r => { r.status = "done"; r.review = "[high] Seeds repeat."; r.stepCoverage = [{ n: 1, status: "partial", note: "Simplified." }]; });
    for (const bad of [{ rounds: 0 }, { rounds: 4 }, { rounds: 1.5 }, { addTokens: -1 }, { addTokens: 700000 }, { extra: 1 }]) expect((await call(t.handle, `/api/paperrun/${run.id}/continue`, bad)).status).toBe(400);
    expect(t.continuation).not.toHaveBeenCalled();
    expect((await call(t.handle, `/api/paperrun/${run.id}/continue`, { rounds: 3, addTokens: 50000 })).status).toBe(200);
    expect(t.continuation).toHaveBeenCalledTimes(1); const [deps, id, input] = t.continuation.mock.calls[0]!; expect(deps).toMatchObject({ root: t.root, key: "fixture-secret" }); expect(id).toBe(run.id);
    expect(input).toMatchObject({ rounds: 3, addTokens: 50000 }); expect(input.guidance).toContain("Resolve this review concern: Seeds repeat."); expect(input.guidance).toContain("Step 1 (partial): Simplified.");
    await new Promise(r => setTimeout(r, 30)); expect((await call(t.handle, `/api/paperrun/${run.id}/continue`, {})).status).toBe(200); expect(t.continuation.mock.calls[1]![2]).toMatchObject({ rounds: 2, addTokens: 150000 });
  });
  it("refuses to continue runs handled by an external agent, and runs without a key", async () => {
    const t = await setup(); const ext = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external" })).json();
    const external = await call(t.handle, `/api/paperrun/${ext.run.id}/continue`, {}); expect(external.status).toBe(400); expect((await external.json()).error).toContain("external agent continues in its own session");
    const keyless = await setup({ key: "" }); const made = await (await call(keyless.handle, "/api/paperrun/start", { paper: "ACO", mode: "external" })).json();
    await updateRun(keyless.root, made.run.id, r => { r.mode = "muse"; r.status = "done"; }); expect((await call(keyless.handle, `/api/paperrun/${made.run.id}/continue`, {})).status).toBe(503);
  });
  it("hands a finished Muse run to an external agent as a new run, and refuses otherwise", async () => {
    const t = await setup(); const { run } = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "muse" })).json().catch(() => ({ run: null })) as { run: { id: string } | null };
    if (!run) return;
    expect((await call(t.handle, `/api/paperrun/${run.id}/handover`, {})).status).toBe(409);
    await call(t.handle, `/api/paperrun/${run.id}/cancel`, {}); await new Promise(r => setTimeout(r, 30)); await updateRun(t.root, run.id, r => { r.status = "cancelled"; });
    const empty = await call(t.handle, `/api/paperrun/${run.id}/handover`, {}); expect(empty.status).toBe(400); expect((await empty.json()).error).toContain("no code to continue from");
    await writeCodeFile(t.root, run.id, "impl.py", "x = 1\n");
    const ok = await (await call(t.handle, `/api/paperrun/${run.id}/handover`, {})).json();
    expect(ok.run).toMatchObject({ mode: "external", status: "waiting_external", parentId: run.id }); expect(ok.run.id).not.toBe(run.id); expect(ok.directory).toContain(ok.run.id); expect(ok.mcp.env.PAPERRUN_ROOT).toBe(t.root);
    const next = await call(t.handle, `/api/paperrun/${ok.run.id}/handover`, {}); expect(next.status).toBe(400); expect((await next.json()).error).toContain("Wait for the run to finish");
    expect((await call(t.handle, "/api/paperrun/run-20260101000000-abcd/handover", {})).status).toBe(404);
  });
  it("records what is left to the agent when a run starts and when it is changed, and rejects anything else", async () => {
    const t = await setup();
    for (const bad of [{ envPolicy: { pick: true } }, { envPolicy: { pick: true, create: "yes" } }, { envPolicy: { pick: true, create: false, extra: 1 } }, { envPolicy: "all" }]) expect((await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external", ...bad })).status).toBe(400);
    const started = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external", envPolicy: { pick: true, create: false } })).json(), id = started.run.id as string;
    expect(started.run.envPolicy).toEqual({ pick: true, create: false }); expect(await readFile(join(t.root, id, "brief.md"), "utf8")).toContain("pick environments from the library yourself");
    const changed = await call(t.handle, `/api/paperrun/${id}/environments`, { policy: { pick: false, create: true } }); expect(changed.status).toBe(200);
    expect((await changed.json()).run.envPolicy).toEqual({ pick: false, create: true }); const brief = await readFile(join(t.root, id, "brief.md"), "utf8"); expect(brief).toContain("extend the library or create a new environment"); expect(brief).not.toContain("pick environments from the library yourself");
    expect((await call(t.handle, `/api/paperrun/${id}/environments`, { policy: { pick: 1, create: 0 } })).status).toBe(400);
  });
  it("lists runs with the size of each replication's two code folders and its condensed memory", async () => {
    const t = await setup(), ext = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external" })).json(); await writeCodeFile(t.root, ext.run.id, "impl.py", "x = 1\n");
    const listed = await (await call(t.handle, "/api/paperrun")).json(); const paperId = ext.run.paperId as string;
    expect(listed.folders[paperId]).toEqual({ muse: 0, external: 1 }); expect(listed.memory[paperId]).toBe(""); expect(listed.runs.map((r: { id: string }) => r.id)).toContain(ext.run.id);
  });
  it("lets the environments of a run be changed afterwards: added, removed, refused when unknown, unapproved or too many", async () => {
    const t = await setup(), make = (name: string, createdBy: "app" | "agent") => saveEnvironment(t.environmentsRoot, { name, description: "", origin: "digitised", source: { note: "Fig. 9a" }, grid: { rows: 4, cols: 4, ascii: ["....", ".##.", "....", "...."] }, start: [0, 0], goal: [3, 3] }, { createdBy });
    const a = await make("Alpha", "app"), b = await make("Beta", "app"), pending = await make("Pending", "agent");
    const started = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external", environments: [a.id] })).json(), id = started.run.id as string, path = `/api/paperrun/${id}/environments`;
    const swapped = await call(t.handle, path, { environments: [b.id] }); expect(swapped.status).toBe(200);
    expect((await swapped.json()).run.environments.map((e: { id: string }) => e.id)).toEqual([b.id]);
    const files = (await (await call(t.handle, `/api/paperrun/${id}`)).json()).files.map((f: { path: string }) => f.path); expect(files).toContain(`environments/${b.id}.json`); expect(files).not.toContain(`environments/${a.id}.json`);
    const brief = await readFile(join(t.root, id, "brief.md"), "utf8"); expect(brief).toContain("Beta"); expect(brief).not.toContain("Alpha");
    expect((await call(t.handle, path, { environments: [] })).status).toBe(200); expect(await readFile(join(t.root, id, "brief.md"), "utf8")).not.toContain("ENVIRONMENTS ATTACHED");
    for (const bad of [{ environments: [pending.id] }, { environments: ["env-missing-0000"] }, { environments: [a.id, a.id] }, { environments: Array(6).fill("x") }, { environments: "x" }, { other: 1 }]) expect((await call(t.handle, path, bad)).status).toBe(400);
  });
  it("attaches chosen environments when a run starts, rejects bad ids, and carries them into a hand-over", async () => {
    const t = await setup(); const env = await saveEnvironment(t.environmentsRoot, { name: "Four", description: "", origin: "digitised", source: { note: "Fig. 9a" }, grid: { rows: 4, cols: 4, ascii: ["....", ".##.", "....", "...."] }, start: [0, 0], goal: [3, 3] }, { createdBy: "app" });
    for (const bad of [{ environments: "env-x" }, { environments: ["../etc"] }, { environments: Array(6).fill("env-a-0000") }, { environments: [1] }]) expect((await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external", ...bad })).status).toBe(400);
    const missing = await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external", environments: ["env-missing-0000"] }); expect(missing.status).toBe(400); expect((await missing.json()).error).toContain("Unknown environment");
    const started = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "external", environments: [env.id] })).json();
    expect(started.run.environments).toEqual([expect.objectContaining({ id: env.id, version: 1, status: "approved", file: `environments/${env.id}.json` })]); expect(started.mcp.env.PAPERRUN_ENVIRONMENTS).toBe(t.environmentsRoot);
    const detail = await (await call(t.handle, `/api/paperrun/${started.run.id}`)).json(); expect(detail.files.map((f: { path: string }) => f.path)).toContain(`environments/${env.id}.json`);
    expect((await readFile(join(t.root, started.run.id, "brief.md"), "utf8"))).toContain("ENVIRONMENTS ATTACHED");
  });
  it("only lets runs prepared for an external agent be finished by hand", async () => {
    const t = await setup(); const muse = await (await call(t.handle, "/api/paperrun/start", { paper: "ACO", mode: "muse" })).json().catch(() => null);
    if (muse?.run) expect((await call(t.handle, `/api/paperrun/${muse.run.id}/finish`, {})).status).toBe(400);
  });
});
describe("who is working", () => {
  it("counts Muse runs that are mid-pipeline and external runs an agent touched in the last few minutes, and nothing finished", async () => {
    const { workingRuns } = await import("./paperrunCore"); const { createRun } = await import("./paperrunCore"); const { appendFile } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), "paperrun-working-")); dirs.push(root);
    const make = (mode: "muse" | "external", title: string, at: Date) => createRun(root, { paperId: "p", title, mode, model: "m", maxRounds: 1, tokenCap: 50000, spec, meta }, at);
    const old = new Date(Date.now() - 3600_000), muse = await make("muse", "Muse busy", old), idle = await make("external", "Idle agent", new Date(old.getTime() + 1000)), live = await make("external", "Live agent", new Date(old.getTime() + 2000)), finished = await make("muse", "Muse finished", new Date(old.getTime() + 3000));
    const { utimes } = await import("node:fs/promises"); for (const r of [muse, idle, live, finished]) await utimes(join(root, r.id, "events.jsonl"), old, old);
    await updateRun(root, muse.id, r => { r.status = "repairing"; }, old); await updateRun(root, finished.id, r => { r.status = "done"; }, old); await updateRun(root, idle.id, r => { r.status = "waiting_external"; }, old);
    await updateRun(root, live.id, r => { r.status = "waiting_external"; }, old); await appendFile(join(root, live.id, "events.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), kind: "agent", message: "Agent wrote impl.py" })}\n`);
    const now = Date.now(), list = await workingRuns(root, now);
    expect(list.map(w => [w.title, w.kind]).sort()).toEqual([["Live agent", "agent"], ["Muse busy", "muse"]]);
    expect((await workingRuns(root, now + 10 * 60_000)).map(w => w.title)).toEqual(["Muse busy"]);
    await updateRun(root, idle.id, r => { r.status = "running"; }, old); expect((await workingRuns(root, now + 10 * 60_000)).map(w => w.title).sort()).toEqual(["Idle agent", "Muse busy"]);
    const t = await setup(); const status = await (await call(t.handle, "/api/paperrun/status")).json(); expect(status.working).toEqual([]);
  });
});
