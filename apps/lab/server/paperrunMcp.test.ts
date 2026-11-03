// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createMcpHandler } from "./paperrunMcp";
import { createRun, readEvents, readRun, setEnvPolicy } from "./paperrunCore";
import { validateReplicationSpec } from "./knowledgeReplication";
const python = resolve(__dirname, "../paperruns/.venv/bin/python");
const sandboxed = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && existsSync(python);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const paperText = ["Improved ACO", "Abstract", "We set the colony size to 50 ants.", "Methods", "The pheromone evaporation rate is 0.15 in all runs.", "Results", "In a 20*20 grid map the improved strategy converged in the 23rd iteration."].join("\n");
const spec = validateReplicationSpec({ goal: "g", steps: [{ name: "s", description: "d", quote: "colony size to 50 ants" }], parameters: [], reportedResults: [{ description: "iterations", value: "23rd iteration", condition: "", quote: "converged in the 23rd iteration" }], gaps: [{ kind: "randomness", description: "seeds", impact: "low", assumption: { proposal: "0-29", rationale: "" } }] }, paperText);
const meta = { title: "ACO study", model: "muse-wonder-1.0", builtAt: "2026-11-03T10:00:00.000Z" };
async function setup() {
  const base = await mkdtemp(join(tmpdir(), "paperrun-mcp-")); dirs.push(base); const root = join(base, "paperruns"), knowledgeRoot = join(base, "knowledge");
  await mkdir(join(knowledgeRoot, "paper-0001"), { recursive: true }); await writeFile(join(knowledgeRoot, "paper-0001/paper.txt"), paperText);
  const external = await createRun(root, { paperId: "paper-0001", title: "ACO study", mode: "external", model: "m", maxRounds: 4, tokenCap: 400000, spec, meta });
  const inApp = await createRun(root, { paperId: "paper-0001", title: "In-app", mode: "muse", model: "m", maxRounds: 4, tokenCap: 400000, spec, meta }, new Date(Date.now() + 2000));
  const rendered: { pdf: string; page: number }[] = [];
  const environmentsRoot = join(base, "environments");
  const handle = createMcpHandler({ root, python, knowledgeRoot, environmentsRoot, renderPage: async (pdf, page) => { rendered.push({ pdf, page }); return Buffer.from("PNGBYTES"); } });
  let n = 0;
  const rpc = async (method: string, params?: unknown) => handle({ jsonrpc: "2.0", id: ++n, method, ...(params === undefined ? {} : { params }) }) as unknown as Promise<Reply>;
  const tool = async (name: string, args: Record<string, unknown> = {}) => { const r = await rpc("tools/call", { name, arguments: args }); const content = r.result!.content[0]!.text; return { isError: !!r.result!.isError, content, json: () => JSON.parse(content) }; };
  return { root, external, inApp, handle, rpc, tool, rendered, knowledgeRoot, environmentsRoot };
}
interface Reply { id: number | null; result?: { content: { text: string }[]; isError?: boolean; tools: { name: string; description: string; inputSchema: { type: string } }[]; serverInfo: { name: string }; protocolVersion: string; instructions: string; capabilities: unknown }; error?: { code: number; message: string } }
const open4 = ["....", "....", "....", "...."];
describe("MCP protocol", () => {
  it("answers initialize, ping and tools/list, ignores notifications, and rejects the unknown", async () => {
    const t = await setup();
    const init = await t.rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "codex", version: "1" } });
    expect(init.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "paperrun" } }); expect(init.result!.instructions).toContain("paperrun_get_brief");
    expect(await t.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull(); expect((await t.rpc("ping")).result).toEqual({});
    const list = await t.rpc("tools/list"); const names = list.result!.tools.map(x => x.name);
    expect(names).toEqual(["paperrun_list_runs", "paperrun_get_brief", "paperrun_get_spec", "paperrun_read_paper", "paperrun_get_page_image", "paperrun_list_environments", "paperrun_get_environment", "paperrun_use_environment", "paperrun_save_environment", "paperrun_list_files", "paperrun_read_file", "paperrun_write_file", "paperrun_run_tests", "paperrun_log", "paperrun_finish"]);
    for (const tool of list.result!.tools) { expect(tool.description.length).toBeGreaterThan(20); expect(tool.inputSchema.type).toBe("object"); }
    expect((await t.rpc("nonsense")).error).toMatchObject({ code: -32601 }); expect((await t.rpc("tools/call", { name: "nope" })).error).toMatchObject({ code: -32602 });
    expect(await t.handle("junk")).toMatchObject({ error: { code: -32600 } }); expect(await t.handle({ jsonrpc: "2.0", id: 1 })).toMatchObject({ error: { code: -32600 } });
  });
});
describe("MCP tools", () => {
  it("lists only external runs and gives the brief, spec and exact paper text", async () => {
    const t = await setup();
    expect((await t.tool("paperrun_list_runs")).json()).toEqual([expect.objectContaining({ id: t.external.id, status: "waiting_external", title: "ACO study" })]);
    const brief = (await t.tool("paperrun_get_brief", { runId: t.external.id })).content; expect(brief).toContain("STATUS: waiting_external"); expect(brief).toContain("RESULTS CONTRACT"); expect(brief).toContain("R1: iterations = 23rd iteration");
    const data = JSON.parse((await t.tool("paperrun_get_spec", { runId: t.external.id })).content); expect(data.reportedResults[0]).toMatchObject({ id: "R1", value: "23rd iteration" }); expect(data.gaps[0].assumptionToUse).toBe("0-29");
    const read = (await t.tool("paperrun_read_paper", { runId: t.external.id, query: "methods" })).json(); expect(read[0].text).toContain("evaporation rate is 0.15"); expect(read[0].text).not.toContain("converged");
    expect((await t.tool("paperrun_read_paper", { runId: t.external.id, query: "zebra quantum" })).content).toBe("No match in the paper.");
  });
  it("follows what the user left to the agent: no picking or creating unless allowed, and the brief says what is allowed", async () => {
    const t = await setup(), grid = { rows: 4, cols: 4, ascii: ["....", ".##.", "....", "...."] };
    const make = (name: string) => t.tool("paperrun_save_environment", { name, origin: "digitised", source: { note: "Fig. 9a" }, grid, start: [0, 0], goal: [3, 3] });
    const libraryId = (await make("Library map")).json().id as string; // saved without a run id, so it is a plain library candidate made by an agent
    const mine = (name: string) => t.tool("paperrun_save_environment", { runId: t.external.id, name, origin: "digitised", source: { note: "Fig. 9a" }, grid, start: [0, 0], goal: [3, 3] });
    await setEnvPolicy(t.root, t.external.id, { pick: false, create: false });
    const noUse = await t.tool("paperrun_use_environment", { runId: t.external.id, envId: libraryId }); expect(noUse.isError).toBe(true); expect(noUse.content).toContain("not allowed you to choose");
    const noSave = await mine("Mine"); expect(noSave.isError).toBe(true); expect(noSave.content).toContain("not allowed you to create");
    await setEnvPolicy(t.root, t.external.id, { pick: false, create: true });
    const made = await mine("Mine"); expect(made.isError).toBe(false);
    expect((await t.tool("paperrun_use_environment", { runId: t.external.id, envId: libraryId })).isError).toBe(true); // creating is not picking
    expect((await t.tool("paperrun_use_environment", { runId: t.external.id, envId: made.json().id })).isError).toBe(false); // its own creation may be attached
    const brief = (await t.tool("paperrun_get_brief", { runId: t.external.id })).content; expect(brief).toContain("ENVIRONMENT PERMISSIONS FROM THE USER"); expect(brief).toContain("extend the library or create a new environment"); expect(brief).not.toContain("pick environments from the library yourself");
    await setEnvPolicy(t.root, t.external.id, { pick: true, create: false });
    expect((await t.tool("paperrun_use_environment", { runId: t.external.id, envId: libraryId })).isError).toBe(false);
    expect((await t.tool("paperrun_get_brief", { runId: t.external.id })).content).toContain("pick environments from the library yourself");
  });
  it("lists, reads, saves and attaches environments, and a saved one is only a candidate", async () => {
    const t = await setup(); expect((await t.tool("paperrun_list_environments")).json()).toEqual([]);
    const save = (over: Record<string, unknown> = {}) => t.tool("paperrun_save_environment", { runId: t.external.id, name: "Fig 9 simple", origin: "digitised", source: { note: "Fig. 9a", paperTitle: "ACO paper" }, grid: { rows: 4, cols: 4, ascii: ["....", ".##.", "....", "...."] }, start: [0, 0], goal: [3, 3], ...over });
    const saved = await save(); expect(saved.isError).toBe(false); const out = saved.json(); expect(out).toMatchObject({ status: "candidate", checks: { solvable: true } }); expect(out.note).toContain("approves it in the PaperRun tab");
    const list = (await t.tool("paperrun_list_environments")).json(); expect(list).toEqual([expect.objectContaining({ id: out.id, name: "Fig 9 simple", status: "candidate", kind: "fixed", rows: 4, cols: 4 })]);
    expect((await t.tool("paperrun_get_environment", { envId: out.id })).json()).toMatchObject({ id: out.id, grid: { ascii: ["....", ".##.", "....", "...."] }, createdBy: "agent" });
    const used = await t.tool("paperrun_use_environment", { runId: t.external.id, envId: out.id }); expect(used.json()).toMatchObject({ id: out.id, status: "candidate", file: `environments/${out.id}.json` });
    expect((await readRun(t.root, t.external.id)).environments).toHaveLength(1); expect((await t.tool("paperrun_get_brief", { runId: t.external.id })).content).toContain("ENVIRONMENTS ATTACHED");
    expect((await readEvents(t.root, t.external.id)).map(e => e.message)).toEqual(expect.arrayContaining([`Agent saved environment "Fig 9 simple" (${out.id}) as a candidate.`]));
    for (const bad of [save({ grid: { rows: 4, cols: 4, ascii: ["....", "..", "....", "...."] } }), save({ origin: "dream" }), save({ source: { note: "" } }), t.tool("paperrun_use_environment", { runId: t.inApp.id, envId: out.id }), t.tool("paperrun_use_environment", { runId: t.external.id, envId: "env-missing-0000" }), t.tool("paperrun_get_environment", { envId: "../x" })]) expect((await bad).isError).toBe(true);
    expect((await t.tool("paperrun_save_environment", { name: "No run id", origin: "manual", source: { note: "by hand" }, grid: { rows: 4, cols: 4, ascii: open4 }, start: [0, 0], goal: [3, 3] })).isError).toBe(false);
  });
  it("shows a page of the paper as an image so a vision-capable agent can read the figures", async () => {
    const t = await setup();
    const reply = await t.rpc("tools/call", { name: "paperrun_get_page_image", arguments: { runId: t.external.id, page: 3 } });
    expect(reply.result!.isError).toBeUndefined(); expect(reply.result!.content).toEqual([{ type: "text", text: 'Page 3 of "ACO study".' }, { type: "image", data: Buffer.from("PNGBYTES").toString("base64"), mimeType: "image/png" }]);
    expect(t.rendered).toEqual([{ pdf: join(t.knowledgeRoot, "paper-0001", "paper.pdf"), page: 3 }]);
    for (const args of [{ runId: t.external.id, page: 0 }, { runId: t.external.id, page: 301 }, { runId: t.external.id, page: 1.5 }, { runId: t.external.id }, { runId: t.inApp.id, page: 1 }]) expect((await t.tool("paperrun_get_page_image", args)).isError).toBe(true);
    expect(t.rendered).toHaveLength(1);
  });
  it("refuses runs handled by Muse, bad ids, bad paths, and writes after a run is finished", async () => {
    const t = await setup();
    for (const [name, args] of [["paperrun_get_brief", { runId: t.inApp.id }], ["paperrun_write_file", { runId: t.inApp.id, path: "a.py", content: "x" }], ["paperrun_get_brief", { runId: "../x" }], ["paperrun_get_brief", { runId: "run-20200101000000-abcd" }], ["paperrun_get_brief", {}]] as const) expect((await t.tool(name, args)).isError).toBe(true);
    expect((await t.tool("paperrun_get_brief", { runId: t.inApp.id })).content).toContain("handled by Muse");
    for (const path of ["../evil.py", "/etc/passwd.py", ".hidden.py", "run.sh", "results.json"]) expect((await t.tool("paperrun_write_file", { runId: t.external.id, path, content: "x" })).isError).toBe(true);
    expect((await t.tool("paperrun_write_file", { runId: t.external.id, path: "big.py", content: "x".repeat(200001) })).isError).toBe(true);
    expect((await t.tool("paperrun_write_file", { runId: t.external.id, path: "ok.py" })).isError).toBe(false);
    await t.tool("paperrun_finish", { runId: t.external.id, summary: "Done." });
    const after = await t.tool("paperrun_write_file", { runId: t.external.id, path: "late.py", content: "x" }); expect(after.isError).toBe(true); expect(after.content).toContain("This run is done");
  });
  it("writes, lists and reads files, and logs progress into the run the app shows", async () => {
    const t = await setup();
    expect((await t.tool("paperrun_write_file", { runId: t.external.id, path: "impl.py", content: "x = 1\n" })).content).toBe("Wrote impl.py.");
    expect((await t.tool("paperrun_list_files", { runId: t.external.id })).json()).toEqual([{ path: "impl.py", bytes: 6 }]); expect((await t.tool("paperrun_read_file", { runId: t.external.id, path: "impl.py" })).content).toBe("x = 1\n");
    await t.tool("paperrun_log", { runId: t.external.id, message: "Starting with the pheromone update." });
    expect((await readEvents(t.root, t.external.id)).map(e => `${e.kind}: ${e.message}`)).toEqual(expect.arrayContaining(["agent: Agent wrote impl.py", "agent: Starting with the pheromone update."]));
  });
  it.runIf(sandboxed)("runs the agent's tests in the sandbox and finishes with an app-built report", async () => {
    const t = await setup();
    await t.tool("paperrun_write_file", { runId: t.external.id, path: "run_tests.py", content: "import json\njson.dump({'results': [{'id': 'R1', 'reproduced': 23.2, 'tolerance': 0.1, 'note': 'mean of 30 seeds'}]}, open('results.json', 'w'))\n" });
    const tests = (await t.tool("paperrun_run_tests", { runId: t.external.id })).json(); expect(tests).toMatchObject({ round: 1, exitCode: 0, timedOut: false, error: null }); expect(tests.results[0]).toMatchObject({ id: "R1", status: "match", reproduced: "23.2" });
    expect(await readRun(t.root, t.external.id)).toMatchObject({ status: "waiting_external", rounds: { used: 1 } });
    expect((await t.tool("paperrun_read_file", { runId: t.external.id, path: "results.json" })).content).toContain("23.2");
    await t.tool("paperrun_write_file", { runId: t.external.id, path: "run_tests.py", content: "raise SystemExit(2)\n" });
    const broken = (await t.tool("paperrun_run_tests", { runId: t.external.id })).json(); expect(broken.error).toContain("exited with code 2"); expect(broken.results[0].status).toBe("not_run");
    const report = (await t.tool("paperrun_finish", { runId: t.external.id, summary: "Built with seeds 0-29; accuracy not measured.", assumptionsUsed: ["G1: seeds 0-29"] })).content;
    expect(report).toContain("an external coding agent"); expect(report).toContain("Built with seeds 0-29"); expect(report).toContain("G1: seeds 0-29"); expect(await readFile(join(t.root, t.external.id, "report.md"), "utf8")).toBe(report);
    expect(await readRun(t.root, t.external.id)).toMatchObject({ status: "done" });
  });
});
describe("rendering a real PDF page", () => {
  const minimal = "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF\n";
  it.runIf(existsSync("/opt/homebrew/bin/pdftoppm") || existsSync("/usr/bin/pdftoppm") || existsSync("/usr/local/bin/pdftoppm"))("renders a PNG with pdftoppm and reports a missing page clearly", async () => {
    const { renderPdfPage } = await import("./paperrunMcp"); const dir = await mkdtemp(join(tmpdir(), "paperrun-pdf-")); dirs.push(dir); await writeFile(join(dir, "p.pdf"), minimal);
    const png = await renderPdfPage(join(dir, "p.pdf"), 1); expect(png.subarray(1, 4).toString()).toBe("PNG");
    await expect(renderPdfPage(join(dir, "p.pdf"), 9)).rejects.toThrow("could not be rendered");
  });
});
describe.runIf(sandboxed)("the real stdio server", () => {
  it("speaks line-delimited JSON-RPC over stdin and stdout when started with node", async () => {
    const t = await setup();
    const child = spawn(process.execPath, ["--experimental-strip-types", resolve(__dirname, "paperrunMcp.ts")], { env: { PATH: process.env.PATH ?? "", PAPERRUN_ROOT: t.root, PAPERRUN_PYTHON: python }, stdio: ["pipe", "pipe", "pipe"] });
    const lines: Reply[] = []; let buffer = ""; child.stdout.on("data", d => { buffer += d.toString(); let i; while ((i = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (line.trim()) lines.push(JSON.parse(line)); } });
    const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }); send({ jsonrpc: "2.0", method: "notifications/initialized" }); send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    child.stdin.write("not json\n"); send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "paperrun_list_runs", arguments: {} } });
    child.stdin.end();
    await new Promise(r => child.on("close", r));
    expect(lines.map(l => l.id)).toEqual([1, 2, null, 3]); expect(lines[0]!.result!.serverInfo.name).toBe("paperrun"); expect(lines[1]!.result!.tools).toHaveLength(15); expect(lines[2]!.error!.code).toBe(-32700);
    expect(JSON.parse(lines[3]!.result!.content[0]!.text)[0].id).toBe(t.external.id);
  }, 30000);
  it("delivers a large reply in full even when the client closes stdin right away", async () => {
    const t = await setup(); const big = `${"x".repeat(100)}\n`.repeat(1900);
    await (await import("./paperrunCore")).writeCodeFile(t.root, t.external.id, "big.py", big);
    const child = spawn(process.execPath, ["--experimental-strip-types", resolve(__dirname, "paperrunMcp.ts")], { env: { PATH: process.env.PATH ?? "", PAPERRUN_ROOT: t.root, PAPERRUN_PYTHON: python }, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; child.stdout.on("data", d => { out += d.toString(); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "paperrun_read_file", arguments: { runId: t.external.id, path: "big.py" } } })}\n`); child.stdin.end();
    await new Promise(r => child.on("close", r));
    const reply = JSON.parse(out.trim()); expect(reply.id).toBe(1); expect(reply.result.content[0].text).toBe(big);
  }, 30000);
});
