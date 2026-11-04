// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeDirectory, createWorkshop, createWorkshopHandler, editHypotheses, initializeCode, parseHypotheses, prepareWorkshop, readmeText, readWorkshop, type WorkshopDeps } from "./workshop";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const origin = "http://localhost:5173", DESC = "desc-20261104100000-aaaa";
const exploration = (over: Record<string, unknown> = {}) => ({ id: DESC, runId: "run-1", paperId: "paper-0001", title: "ACO study", goal: "Can ACO go to the real world?", model: "muse-wonder-1.0", status: "done", online: true, repos: [{ kind: "repo", title: "me/aco-dwa", year: 2026, url: "https://github.com/me/aco-dwa", cites: 12, snippet: "", meta: "12 stars" }], scoutQueries: [], replication: { rating: "Early attempt", verified: 0, total: 17, coveragePercent: 69 }, tokens: { used: 1, cap: 2 }, findings: [], verdict: "feasible_with_changes", report: "# Feasibility study: ACO study\n\n**Goal:** g\n\n**Verdict:** Feasible with changes\n\nPossible with sensing.\n", nextSteps: ["Build a field map", "Test the local planner on noisy sensors"], events: [], createdAt: "2026-11-04T10:00:00.000Z", updatedAt: "2026-11-04T10:00:00.000Z", ...over });
async function setup(over: Record<string, unknown> = {}) {
  const base = await mkdtemp(join(tmpdir(), "workshop-")); dirs.push(base);
  const descendRoot = join(base, "desc"), root = join(base, "ws"); await mkdir(join(descendRoot, DESC), { recursive: true });
  await writeFile(join(descendRoot, DESC, "descend.json"), JSON.stringify(exploration(over)));
  return { root, descendRoot };
}
const reply = (content: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { total_tokens: 10 } }));
const good = (async () => reply({ hypotheses: [{ statement: "The local planner copes with 10% sensor noise", test: "Add Gaussian noise to the range readings", success: "Mission completion above 80% supports it, below 50% refutes it" }, { statement: "The local planner copes with 10% sensor noise", test: "duplicate", success: "" }, { statement: "A field map can be digitised from satellite imagery", test: "", success: "" }, { statement: "" }] })) as unknown as typeof fetch;
const deps = (t: { root: string; descendRoot: string }, send: typeof fetch = good, key = "k"): WorkshopDeps => ({ ...t, key, send });

describe("Workshop", () => {
  it("keeps up to six distinct, non-empty hypotheses", () => {
    expect(parseHypotheses({ hypotheses: [{ statement: "a", test: "t", success: "s" }, { statement: "a" }, { statement: "" }, ...Array.from({ length: 9 }, (_, i) => ({ statement: `h${i}` }))] }).map(h => h.statement)).toEqual(["a", "h0", "h1", "h2", "h3", "h4"]);
    expect(parseHypotheses(null)).toEqual([]); expect(parseHypotheses({ hypotheses: "x" })).toEqual([]);
  });
  it("creates one container with a code folder, the baseline status and the report's context, then adds Muse's hypotheses", async () => {
    const t = await setup(), d = deps(t), w = await createWorkshop(d, { descendId: DESC, model: "muse-wonder-1.0" });
    expect(w).toMatchObject({ status: "preparing", paperId: "paper-0001", verdict: "feasible_with_changes", summary: "Possible with sensing.", nextSteps: ["Build a field map", "Test the local planner on noisy sensors"], replication: { rating: "Early attempt", verified: 0 } });
    expect(await readdir(codeDirectory(t.root, w.id))).toEqual([]); expect(w.repos[0]!.title).toBe("me/aco-dwa");
    await prepareWorkshop(d, w.id, new AbortController().signal); const ready = await readWorkshop(t.root, w.id);
    expect(ready.status).toBe("ready"); expect(ready.hypotheses.map(h => [h.id, h.status])).toEqual([["H1", "untested"], ["H2", "untested"]]); expect(ready.hypotheses[0]!.success).toContain("refutes");
    expect(ready.log.map(l => l.message).join(" ")).toContain("Muse wrote the hypotheses");
  });
  it("falls back to the report's next steps, as written, when Muse cannot write hypotheses, and says so", async () => {
    const t = await setup(), d = deps(t, (async () => new Response("no", { status: 500 })) as unknown as typeof fetch), w = await createWorkshop(d, { descendId: DESC, model: "muse-wonder-1.0" });
    await prepareWorkshop(d, w.id, new AbortController().signal); const ready = await readWorkshop(t.root, w.id);
    expect(ready.status).toBe("ready"); expect(ready.hypotheses.map(h => h.statement)).toEqual(["Build a field map", "Test the local planner on noisy sensors"]); expect(ready.hypotheses[0]!.test).toBe("");
    expect(ready.log.at(-1)!.message).toContain("next steps were used as written");
    const none = await setup({ nextSteps: [] }), d2 = deps(none, (async () => new Response("no", { status: 500 })) as unknown as typeof fetch), w2 = await createWorkshop(d2, { descendId: DESC, model: "muse-wonder-1.0" });
    await prepareWorkshop(d2, w2.id, new AbortController().signal); expect(await readWorkshop(none.root, w2.id)).toMatchObject({ status: "failed", error: expect.stringContaining("no next steps") });
  });
  it("sets up the code folder: a README, one stub per hypothesis and a copy of the replication code, never overwriting anything", async () => {
    const t = await setup(), runsRoot = join(t.root, "..", "runs"), shared = join(runsRoot, "_code", "paper-0001"); dirs.push(runsRoot);
    await mkdir(join(shared, "environments"), { recursive: true }); await mkdir(join(shared, "__pycache__"), { recursive: true });
    await writeFile(join(shared, "impl.py"), "x = 1\n"); await writeFile(join(shared, "notes.md"), "n"); await writeFile(join(shared, "environments", "env-a.json"), "{}"); await writeFile(join(shared, "big.json"), "x".repeat(200_001)); await writeFile(join(shared, "data.bin"), "bin"); await writeFile(join(shared, ".hidden"), "h"); await writeFile(join(shared, "__pycache__", "x.pyc"), "c"); await symlink("/etc/hosts", join(shared, "link.txt"));
    const d = { ...deps(t), runsRoot }, w = await createWorkshop(d, { descendId: DESC, model: "muse-wonder-1.0" }); await prepareWorkshop(d, w.id, new AbortController().signal);
    const { result, workshop } = await initializeCode(d, w.id);
    expect(result.created.sort()).toEqual([".gitignore", "README.md", "baseline/SOURCE.md", "baseline/environments/env-a.json", "baseline/impl.py", "baseline/notes.md", "experiments/h1_the_local_planner_copes_with_10.py", "experiments/h2_a_field_map_can_be_digitised_from.py"].sort());
    expect(result.baseline).toEqual({ from: "the external agent's code folder", files: 3, skipped: 2 }); expect(result.skipped).toEqual([]); // big.json and data.bin were left out; the link, hidden file and cache were never looked at
    const code = codeDirectory(t.root, w.id), readme = await readFile(join(code, "README.md"), "utf8");
    expect(readme).toContain("Baseline:"); expect(readme).toMatch(/treat the method as unverified|only as good as that baseline/); expect(readme).toContain("### H1: The local planner copes with 10% sensor noise"); expect(readme).toContain("`baseline/`"); expect(readme).toContain("workshop_record_experiment");
    const stub = await readFile(join(code, "experiments/h1_the_local_planner_copes_with_10.py"), "utf8"); expect(stub).toContain("raise NotImplementedError"); expect(stub).toContain("Add Gaussian noise"); expect(stub).not.toMatch(/return\s+\{|value\s*=\s*\d/);
    expect(await readFile(join(code, "baseline/SOURCE.md"), "utf8")).toContain("unverified"); expect(await readFile(join(code, "baseline/impl.py"), "utf8")).toBe("x = 1\n"); expect(await readFile(join(shared, "impl.py"), "utf8")).toBe("x = 1\n");
    expect(workshop.log.at(-1)!.message).toBe("Set up the code folder: 8 file(s), including a baseline copy of 3 replication file(s).");
    // run again after the user has changed things: nothing is overwritten, nothing is added
    await writeFile(join(code, "README.md"), "my own notes"); await writeFile(join(code, "baseline/impl.py"), "edited\n");
    const again = await initializeCode(d, w.id); expect(again.result.created).toEqual([]); expect(again.result.skipped.length).toBeGreaterThanOrEqual(5);
    expect(await readFile(join(code, "README.md"), "utf8")).toBe("my own notes"); expect(await readFile(join(code, "baseline/impl.py"), "utf8")).toBe("edited\n"); expect((await readWorkshop(t.root, w.id)).log).toHaveLength(workshop.log.length);
  });
  it("sets up without a baseline when the paper has no replication code, uses the Muse folder when only that exists, and refuses a workshop that is not ready", async () => {
    const t = await setup(), runsRoot = join(t.root, "..", "runs2"); dirs.push(runsRoot);
    const d = { ...deps(t), runsRoot }, w = await createWorkshop(d, { descendId: DESC, model: "muse-wonder-1.0" });
    await expect(initializeCode(d, w.id)).rejects.toThrow(/no hypotheses yet/); await prepareWorkshop(d, w.id, new AbortController().signal);
    const none = await initializeCode(d, w.id); expect(none.result.baseline).toBeNull(); expect(none.result.created).not.toContain("baseline/SOURCE.md"); expect(await readFile(join(codeDirectory(t.root, w.id), "README.md"), "utf8")).not.toContain("`baseline/`");
    const t2 = await setup(), runs2 = join(t2.root, "..", "runs3"); dirs.push(runs2); await mkdir(join(runs2, "_code-muse", "paper-0001"), { recursive: true }); await writeFile(join(runs2, "_code-muse", "paper-0001", "impl.py"), "m = 1\n");
    const d2 = { ...deps(t2), runsRoot: runs2 }, w2 = await createWorkshop(d2, { descendId: DESC, model: "muse-wonder-1.0" }); await prepareWorkshop(d2, w2.id, new AbortController().signal);
    expect((await initializeCode(d2, w2.id)).result.baseline).toEqual({ from: "the Muse code folder", files: 1, skipped: 0 });
    expect(readmeText({ ...(await readWorkshop(t2.root, w2.id)), hypotheses: [{ id: "H1", statement: "S", test: "", success: "", status: "untested", evidence: [] }] }, false)).toContain("Test: not written yet");
  });
  it("starts only from an exploration whose report is ready", async () => {
    await expect(createWorkshop(deps(await setup({ status: "researching" })), { descendId: DESC, model: "m" })).rejects.toThrow(/report is ready/);
    await expect(createWorkshop(deps(await setup()), { descendId: "desc-20261104000000-bbbb", model: "m" })).rejects.toThrow(/Unknown exploration/);
  });
  it("lets the user edit the hypothesis text without touching status or evidence", async () => {
    const t = await setup(), d = deps(t), w = await createWorkshop(d, { descendId: DESC, model: "m" }); await prepareWorkshop(d, w.id, new AbortController().signal);
    const { updateWorkshop } = await import("./workshop"); await updateWorkshop(t.root, w.id, x => { x.hypotheses[0]!.status = "supported"; x.hypotheses[0]!.evidence = ["E1"]; });
    const edited = await editHypotheses(t.root, w.id, [{ id: "H1", statement: "Reworded claim", test: "new test", success: "new bar" }, { statement: "A brand new one" }, { statement: "" }]);
    expect(edited.hypotheses.map(h => [h.id, h.statement, h.status, h.evidence])).toEqual([["H1", "Reworded claim", "supported", ["E1"]], ["H3", "A brand new one", "untested", []]]);
    expect(edited.log.at(-1)).toMatchObject({ by: "user", message: "Edited the hypotheses." });
    await expect(editHypotheses(t.root, w.id, [])).rejects.toThrow(/at least one|between 1/); await expect(editHypotheses(t.root, w.id, [{ statement: "" }])).rejects.toThrow(/at least one/); await expect(editHypotheses(t.root, w.id, "x")).rejects.toThrow(/between 1/);
  });
  it("serves the routes once per exploration and refuses other origins and bad requests", async () => {
    const t = await setup(), handle = createWorkshopHandler("k", { ...t, send: good });
    const call = (path: string, body?: unknown, from = origin) => handle(new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: from, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    expect((await call("/api/workshop/start", { descendId: DESC }, "http://evil.example")).status).toBe(403); expect((await call("/api/workshop/start", {})).status).toBe(400); expect((await call("/api/workshop/start", { descendId: DESC, model: "gpt" })).status).toBe(400);
    const started = await call("/api/workshop/start", { descendId: DESC }); expect(started.status).toBe(201); const { workshop } = await started.json();
    for (let i = 0; i < 300 && (await readWorkshop(t.root, workshop.id)).status === "preparing"; i++) await new Promise(r => setTimeout(r, 50));
    const again = await (await call("/api/workshop/start", { descendId: DESC })).json(); expect(again).toMatchObject({ existing: true, workshop: { id: workshop.id } });
    const status = await (await call("/api/workshop/status")).json(); expect(status.mcp).toMatchObject({ command: "node", args: ["--experimental-strip-types", expect.stringContaining("workshopMcp.ts")], env: { WORKSHOP_ROOT: t.root } });
    const list = await (await call("/api/workshop")).json(); expect(list.workshops).toHaveLength(1); expect(list.workshops[0].report).toBeUndefined();
    const detail = await (await call(`/api/workshop/${workshop.id}`)).json(); expect(detail.workshop.status).toBe("ready"); expect(detail.codeDirectory).toBe(codeDirectory(t.root, workshop.id)); expect(detail.files).toEqual([]);
    await writeFile(join(codeDirectory(t.root, workshop.id), "main.py"), "print(1)"); expect((await (await call(`/api/workshop/${workshop.id}`)).json()).files).toEqual([expect.objectContaining({ path: "main.py", bytes: 8 })]);
    const init = await call(`/api/workshop/${workshop.id}/init`, {}); expect(init.status).toBe(200); expect((await init.json()).result.created).toContain("README.md"); expect((await call(`/api/workshop/${workshop.id}/init`, {}, "http://evil.example")).status).toBe(403);
    const edit = await call(`/api/workshop/${workshop.id}/hypotheses`, { hypotheses: [{ id: "H1", statement: "Edited" }] }); expect((await edit.json()).workshop.hypotheses[0].statement).toBe("Edited");
    expect((await call("/api/workshop/ws-20261104000000-aaaa")).status).toBe(404); expect((await call(`/api/workshop/${workshop.id}/hypotheses`, { hypotheses: [] })).status).toBe(400);
  });
});
