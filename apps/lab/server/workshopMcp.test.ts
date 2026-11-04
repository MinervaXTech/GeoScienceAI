// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createWorkshopMcpHandler, briefText } from "./workshopMcp";
import { codeDirectory, listWorkshopFiles, readWorkshop, updateWorkshop, type WorkshopRecord } from "./workshop";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const ID = "ws-20261104100000-aaaa", fixed = () => new Date("2026-11-04T03:00:00.000Z");
const record = (over: Partial<WorkshopRecord> = {}): WorkshopRecord => ({ id: ID, descendId: "desc-1", paperId: "paper-0001", title: "ACO study", goal: "Can ACO go to the real world?", model: "m", status: "ready", createdAt: "2026-11-04T02:00:00.000Z", updatedAt: "2026-11-04T02:00:00.000Z", verdict: "feasible_with_changes", replication: { rating: "Early attempt", verified: 0, total: 17, coveragePercent: 69 }, summary: "s", report: "# Report\nPossible with sensing.", nextSteps: ["Build a field map"], repos: [{ kind: "repo", title: "me/aco-dwa", year: 2026, url: "https://github.com/me/aco-dwa", cites: 12, snippet: "", meta: "12 stars" }], hypotheses: [{ id: "H1", statement: "The planner copes with noise", test: "Add noise", success: ">80% supports", status: "untested", evidence: [] }, { id: "H2", statement: "A map can be digitised", test: "", success: "", status: "untested", evidence: [] }], experiments: [], log: [], ...over });
async function setup(over: Partial<WorkshopRecord> = {}) {
  const root = await mkdtemp(join(tmpdir(), "workshop-mcp-")); dirs.push(root);
  await mkdir(codeDirectory(root, ID), { recursive: true }); await writeFile(join(root, ID, "workshop.json"), JSON.stringify(record(over)));
  const handle = createWorkshopMcpHandler({ root, now: fixed }); let n = 0;
  const rpc = async (method: string, params?: unknown) => handle({ jsonrpc: "2.0", id: ++n, method, ...(params === undefined ? {} : { params }) }) as unknown as Promise<{ result?: { content: { text: string }[]; isError?: boolean; tools: { name: string }[]; serverInfo: { name: string }; instructions: string }; error?: { code: number } }>;
  const tool = async (name: string, args: Record<string, unknown> = {}) => { const r = await rpc("tools/call", { name, arguments: args }); const content = r.result!.content[0]!.text; return { isError: !!r.result!.isError, content, json: () => JSON.parse(content) }; };
  return { root, handle, rpc, tool };
}
describe("workshop MCP protocol", () => {
  it("answers initialize, ping and tools/list, ignores notifications, and rejects the unknown", async () => {
    const t = await setup(), init = await t.rpc("initialize", { protocolVersion: "2025-03-26" });
    expect(init.result).toMatchObject({ serverInfo: { name: "workshop" } }); expect(init.result!.instructions).toContain("workshop_get_brief");
    expect(await t.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull(); expect((await t.rpc("ping")).result).toEqual({});
    expect((await t.rpc("tools/list")).result!.tools.map(x => x.name)).toEqual(["workshop_list", "workshop_get_brief", "workshop_get_report", "workshop_list_files", "workshop_read_file", "workshop_log", "workshop_set_status", "workshop_record_experiment"]);
    expect((await t.rpc("tools/call", { name: "nope" })).error?.code).toBe(-32602); expect((await t.rpc("nope")).error?.code).toBe(-32601); expect(await t.handle(5)).toMatchObject({ error: { code: -32600 } });
  });
});
describe("workshop MCP tools", () => {
  it("gives a brief with the baseline warning, the code folder, the hypotheses and the rules", async () => {
    const t = await setup(), brief = (await t.tool("workshop_get_brief", { workshopId: ID })).content;
    expect(brief).toContain("Nothing has been verified, so treat the method as unverified"); expect(brief).toContain(codeDirectory(t.root, ID)); expect(brief).toContain("H1 [untested] The planner copes with noise"); expect(brief).toContain("Test: Add noise");
    expect(brief).toContain("Test: not written yet"); expect(brief).toContain("me/aco-dwa https://github.com/me/aco-dwa (12 stars)"); expect(brief).toContain("Never write a value you did not measure"); expect(brief).toContain("1. Build a field map");
    expect(briefText(record({ replication: { rating: "Well replicated", verified: 9, total: 10, coveragePercent: null } }), "/f")).not.toContain("treat the method as unverified");
    expect((await t.tool("workshop_get_report", { workshopId: ID })).content).toContain("Possible with sensing."); expect((await t.tool("workshop_list")).json()).toEqual([expect.objectContaining({ id: ID, hypotheses: 2, open: 2 })]);
  });
  it("describes the folder layout in the brief once the code folder has been set up", async () => {
    const t = await setup(); expect((await t.tool("workshop_get_brief", { workshopId: ID })).content).not.toContain("It is already set up");
    await writeFile(join(codeDirectory(t.root, ID), "README.md"), "# set up\n"); const brief = (await t.tool("workshop_get_brief", { workshopId: ID })).content;
    expect(brief).toContain("It is already set up: README.md says what is being tested"); expect(brief).toContain("baseline/ is a copy of the replication code"); expect(brief).toContain("do not edit it");
  });
  it("logs progress, and sets testing or inconclusive but never supported or refuted without an experiment", async () => {
    const t = await setup();
    expect((await t.tool("workshop_log", { workshopId: ID, message: "Started the noise test in VS Code" })).content).toBe("Logged.");
    expect((await t.tool("workshop_set_status", { workshopId: ID, hypothesisId: "H1", status: "testing" })).content).toBe("H1 is now testing.");
    for (const status of ["supported", "refuted"]) { const r = await t.tool("workshop_set_status", { workshopId: ID, hypothesisId: "H1", status }); expect(r.isError).toBe(true); expect(r.content).toContain("workshop_record_experiment"); }
    expect((await t.tool("workshop_set_status", { workshopId: ID, hypothesisId: "H9", status: "testing" })).content).toContain("Use one of: H1, H2"); expect((await t.tool("workshop_set_status", { workshopId: ID, hypothesisId: "H1", status: "done" })).isError).toBe(true);
    const w = await readWorkshop(t.root, ID); expect(w.hypotheses[0]!.status).toBe("testing"); expect(w.log.map(l => [l.by, l.message])).toEqual([["agent", "Started the noise test in VS Code"], ["agent", "H1 set to testing."]]);
  });
  it("records an experiment as the hypothesis's evidence, and needs a metric and a value to call it supported or refuted", async () => {
    const t = await setup();
    const noValue = await t.tool("workshop_record_experiment", { workshopId: ID, hypothesisId: "H1", summary: "Ran 30 missions with 10% noise", status: "supported" }); expect(noValue.isError).toBe(true); expect(noValue.content).toContain("metric and the value");
    expect((await readWorkshop(t.root, ID)).experiments).toEqual([]);
    const first = (await t.tool("workshop_record_experiment", { workshopId: ID, hypothesisId: "H1", summary: "Ran 30 missions with 10% noise", metric: "mission completion", value: "17/30" })).json();
    expect(first).toMatchObject({ experimentId: "E1", hypothesis: "H1", status: "testing" }); expect(first.reminder).toContain("unverified");
    const second = (await t.tool("workshop_record_experiment", { workshopId: ID, hypothesisId: "H1", summary: "Repeated with 5% noise", metric: "mission completion", value: "9/30", status: "refuted" })).json(); expect(second).toMatchObject({ experimentId: "E2", status: "refuted" });
    const w = await readWorkshop(t.root, ID); expect(w.hypotheses[0]).toMatchObject({ status: "refuted", evidence: ["E1", "E2"] }); expect(w.hypotheses[1]!.status).toBe("untested");
    expect(w.experiments.map(e => [e.id, e.by, e.at])).toEqual([["E1", "agent", "2026-11-04T03:00:00.000Z"], ["E2", "agent", "2026-11-04T03:00:00.000Z"]]);
    expect((await t.tool("workshop_set_status", { workshopId: ID, hypothesisId: "H1", status: "inconclusive" })).content).toBe("H1 is now inconclusive.");
  });
  it("refuses a workshop that is not ready, an unknown one, and a bad id", async () => {
    const preparing = await setup({ status: "preparing", hypotheses: [] }); expect((await preparing.tool("workshop_get_brief", { workshopId: ID })).content).toContain("still preparing");
    const failed = await setup({ status: "failed" }); expect((await failed.tool("workshop_log", { workshopId: ID, message: "x" })).content).toContain("failed to prepare");
    const t = await setup(); expect((await t.tool("workshop_get_brief", { workshopId: "ws-20261104000000-bbbb" })).content).toBe("Unknown workshop."); expect((await t.tool("workshop_get_brief", { workshopId: "../etc" })).content).toContain("must look like ws-");
  });
  it("lists and reads only what is inside the code folder, whatever the editor wrote there", async () => {
    const t = await setup(), code = codeDirectory(t.root, ID);
    await mkdir(join(code, "src"), { recursive: true }); await mkdir(join(code, ".git"), { recursive: true }); await mkdir(join(code, "node_modules/x"), { recursive: true });
    await writeFile(join(code, "src/planner.py"), "print(1)\n"); await writeFile(join(code, "README.md"), "hi"); await writeFile(join(code, ".git/config"), "x"); await writeFile(join(code, "node_modules/x/i.js"), "x"); await writeFile(join(code, ".hidden"), "x"); await writeFile(join(t.root, "secret.txt"), "secret");
    expect((await listWorkshopFiles(t.root, ID)).map(f => f.path)).toEqual(["README.md", "src/planner.py"]); expect((await t.tool("workshop_list_files", { workshopId: ID })).json().map((f: { path: string }) => f.path)).toEqual(["README.md", "src/planner.py"]);
    expect((await t.tool("workshop_read_file", { workshopId: ID, path: "src/planner.py" })).content).toBe("print(1)\n");
    for (const path of ["../secret.txt", "../../workshop.json", "/etc/hosts", "missing.py", "src"]) expect((await t.tool("workshop_read_file", { workshopId: ID, path })).isError).toBe(true);
    await writeFile(join(code, "big.txt"), "x".repeat(100_001)); expect((await t.tool("workshop_read_file", { workshopId: ID, path: "big.txt" })).content).toContain("larger than 100 KB");
  });
  it("keeps every write when two agents report at once", async () => {
    const t = await setup(); await Promise.all(["a", "b", "c", "d"].map((m, i) => t.tool("workshop_record_experiment", { workshopId: ID, hypothesisId: i % 2 ? "H2" : "H1", summary: `run ${m}`, metric: "m", value: String(i) })));
    const w = await readWorkshop(t.root, ID); expect(w.experiments.map(e => e.id).sort()).toEqual(["E1", "E2", "E3", "E4"]); expect(w.hypotheses[0]!.evidence.length + w.hypotheses[1]!.evidence.length).toBe(4);
    await updateWorkshop(t.root, ID, x => { x.log.push({ at: "t", by: "user", message: "kept" }); }); expect((await readWorkshop(t.root, ID)).experiments).toHaveLength(4);
  });
  it("serves the tools over stdio as a separate process", async () => {
    const t = await setup(), child = spawn("node", ["--experimental-strip-types", resolve(__dirname, "workshopMcp.ts")], { env: { ...process.env, WORKSHOP_ROOT: t.root }, stdio: ["pipe", "pipe", "pipe"] });
    const lines: string[] = []; child.stdout.on("data", d => lines.push(...String(d).split("\n").filter(Boolean)));
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "workshop_log", arguments: { workshopId: ID, message: "from a real process" } } })}\nnot json\n`); child.stdin.end();
    await new Promise(r => child.on("close", r));
    expect(JSON.parse(lines[0]!).result.content[0].text).toBe("Logged."); expect(JSON.parse(lines[1]!).error.code).toBe(-32700);
    expect((await readWorkshop(t.root, ID)).log.map(l => l.message)).toEqual(["from a real process"]);
  });
});
