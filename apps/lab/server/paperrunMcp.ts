import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendEvent, attachEnvironment, listCodeFiles, listRuns, readCodeFile, readRun, readSpec, runDirectory, runTests, setStage, summarise, updateRun, validRunId, writeCodeFile } from "./paperrunCore.ts";
import { finalizeExternal, specForModel } from "./paperrunPipeline.ts";
import { findPassages } from "./knowledgeRead.ts";
import { environmentSummary, getEnvironment, listEnvironments, saveEnvironment } from "./environments.ts";

export interface McpOptions { environmentsRoot?: string; root: string; python: string; knowledgeRoot: string; renderPage?: (pdfPath: string, page: number) => Promise<Buffer> }
export interface ImageResult { image: { data: string; mimeType: string }; caption: string }
const isImage = (v: unknown): v is ImageResult => !!v && typeof v === "object" && "image" in (v as object) && "caption" in (v as object);
interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; run(args: Record<string, unknown>): Promise<unknown> }
const runIdSchema = { type: "string", description: "The PaperRun id, for example run-20261103141600-ab12." };
const text = (value: unknown) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const str = (v: unknown, name: string, max = 200_000) => { if (typeof v !== "string" || !v.trim() || v.length > max) throw Error(`${name} must be a non-empty string.`); return v; };

/** Renders one PDF page to PNG with poppler's pdftoppm, scaling down if the picture would be too large to send. */
export async function renderPdfPage(pdfPath: string, page: number): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "paperrun-page-"));
  try {
    for (const dpi of [130, 90, 60]) {
      await new Promise<void>((done, fail) => execFile("pdftoppm", ["-r", String(dpi), "-f", String(page), "-l", String(page), "-png", "-singlefile", pdfPath, join(dir, "page")], { timeout: 60000 }, error => error ? fail((error as NodeJS.ErrnoException).code === "ENOENT" ? Error("pdftoppm not found. Install poppler with: brew install poppler") : Error(`Page ${page} could not be rendered. Check that the paper has that page.`)) : done()));
      const png = await readFile(join(dir, "page.png")); if (png.length <= 3_000_000) return png;
    }
    throw Error("The page image is too large to send.");
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** The tools an outside coding agent uses to work a PaperRun. They only touch runs prepared for an external agent, and every action lands in the run's log that the app shows. */
export function paperRunTools(options: McpOptions): Tool[] {
  const { root, python, knowledgeRoot } = options, render = options.renderPage ?? renderPdfPage, envRoot = options.environmentsRoot ?? join(knowledgeRoot, "..", "environments");
  const external = async (args: Record<string, unknown>, writable: boolean) => {
    const id = args.runId; if (!validRunId(id)) throw Error("runId must look like run-YYYYMMDDHHMMSS-xxxx.");
    const run = await readRun(root, id).catch(() => { throw Error("Unknown run."); });
    if (run.mode !== "external") throw Error("This run is handled by Muse inside the app. Prepare a run for an external agent in the PaperRun tab.");
    if (writable && ["done", "cancelled"].includes(run.status)) throw Error(`This run is ${run.status}; start a new one.`);
    return { id, run };
  };
  const tools: Tool[] = [
    { name: "paperrun_list_runs", description: "List PaperRuns prepared for external agents, newest first, with their status.", inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => (await listRuns(root)).filter(r => r.mode === "external").map(r => ({ id: r.id, title: r.title, status: r.status, createdAt: r.createdAt, roundsUsed: r.rounds.used })) },
    { name: "paperrun_get_brief", description: "Get the full brief for a run: the task, rules, reproduction spec (steps, equations, parameters, environment), the reported results to match with ids R1..Rn, the gaps with their assumptions, and the results contract your run_tests.py must follow. Read this first.", inputSchema: { type: "object", properties: { runId: runIdSchema }, required: ["runId"], additionalProperties: false },
      run: async args => { const { id, run } = await external(args, false); return `STATUS: ${run.status}, test rounds used ${run.rounds.used}\n\n${await readFile(join(runDirectory(root, id), "brief.md"), "utf8")}`; } },
    { name: "paperrun_get_spec", description: "Get the reproduction spec as structured JSON, with reported results labelled R1..Rn and the assumption chosen for each gap.", inputSchema: { type: "object", properties: { runId: runIdSchema }, required: ["runId"], additionalProperties: false },
      run: async args => { const { id, run } = await external(args, false); return specForModel((await readSpec(root, id)).spec, run.assumptions); } },
    { name: "paperrun_read_paper", description: "Read exact text from the stored paper by section name (abstract, methods, results, discussion, conclusion) or keywords, with character offsets and page numbers when known. Use it to check an equation, a parameter table or a step. PDF equations may be garbled; report that rather than guessing.", inputSchema: { type: "object", properties: { runId: runIdSchema, query: { type: "string", description: "Section name or keywords." } }, required: ["runId", "query"], additionalProperties: false },
      run: async args => { const { run } = await external(args, false); const paper = await readFile(join(knowledgeRoot, run.paperId, "paper.txt"), "utf8").catch(() => ""); if (!paper) throw Error("The saved paper text is missing."); const passages = findPassages(paper, str(args.query, "query", 200), 6000); return passages.length ? passages.map(p => ({ from: p.from, to: p.to, ...(p.page ? { page: p.page } : {}), text: p.text })) : "No match in the paper."; } },
    { name: "paperrun_get_page_image", description: "See one page of the stored paper as an image (PNG). Use it to read what the text cannot give you: obstacle maps, start and goal positions, figures, tables and equations. If you can read images, digitise what you need into a data file in the code folder with paperrun_write_file, and say in your result notes how approximate it is.", inputSchema: { type: "object", properties: { runId: runIdSchema, page: { type: "integer", minimum: 1, maximum: 300, description: "Page number, starting at 1." } }, required: ["runId", "page"], additionalProperties: false },
      run: async args => { const { run } = await external(args, false); const page = args.page; if (!Number.isInteger(page) || (page as number) < 1 || (page as number) > 300) throw Error("page must be an integer from 1 to 300."); const png = await render(join(knowledgeRoot, run.paperId, "paper.pdf"), page as number); return { image: { data: png.toString("base64"), mimeType: "image/png" }, caption: `Page ${page} of "${run.title}".` } satisfies ImageResult; } },
    { name: "paperrun_list_environments", description: "List the shared library of environments (worlds) that runs reuse: maps digitised from papers, generators that make random maps from stated parameters, and so on. Look here before building your own world, and reuse one when its description matches what the paper used.", inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => (await listEnvironments(envRoot)).map(e => ({ ...environmentSummary(e) })) },
    { name: "paperrun_get_environment", description: "Get one environment in full, including its map as rows of '#' (blocked) and '.' (free), start, goal, targets and where it came from.", inputSchema: { type: "object", properties: { envId: { type: "string" } }, required: ["envId"], additionalProperties: false },
      run: async args => getEnvironment(envRoot, str(args.envId, "envId", 60)) },
    { name: "paperrun_use_environment", description: "Attach a library environment to a run. It is copied into the run's code folder as environments/<id>.json (generators are written out as numbered instances), the version is recorded, and the brief gains a section about it. Load it in your code instead of inventing a map.", inputSchema: { type: "object", properties: { runId: runIdSchema, envId: { type: "string" } }, required: ["runId", "envId"], additionalProperties: false },
      run: async args => {
        const { id } = await external(args, true), envId = str(args.envId, "envId", 60), made = await readRun(root, id), policy = made.envPolicy;
        if (policy && !policy.pick) {
          if (!policy.create) throw Error("The user has not allowed you to choose environments for this run. Ask them to attach one in the PaperRun tab (Environments section of the run), or to tick \"allow agent choose suitable map\".");
          if (!(made.createdEnvironments ?? []).includes(envId)) throw Error("You may only attach environments you created yourself for this run. Picking from the library is not allowed unless the user ticks \"allow agent choose suitable map\".");
        }
        return attachEnvironment(root, id, envRoot, envId);
      } },
    { name: "paperrun_save_environment", description: "Save a new environment you made or digitised, so later runs can reuse it. It enters the library as a CANDIDATE and counts as shared only after the user approves it. Give either grid {rows, cols, ascii:[...]} or generator {type:'random-obstacles', rows, cols, density, seedBase, instances}, plus origin (digitised | generated-from-parameters | generated-from-description | satellite | manual), source.note saying exactly where it came from (and paperTitle/figure if from a paper), start/goal or targets as [row, col], and any assumptions. Prefer a faithful one: digitise a figure if the paper has one, generate from stated parameters if it gives them, and say plainly when you had to assume.", inputSchema: { type: "object", properties: { runId: { type: "string", description: "Optional: the run this is for, so the save is logged there." }, name: { type: "string" }, description: { type: "string" }, origin: { type: "string", enum: ["digitised", "generated-from-parameters", "generated-from-description", "satellite", "manual"] }, source: { type: "object", description: "{note, paperTitle?, figure?}" }, grid: { type: "object", description: "{rows, cols, ascii}" }, generator: { type: "object", description: "{type, rows, cols, density, seedBase?, instances?, start?, goal?}" }, start: { type: "array", items: { type: "integer" } }, goal: { type: "array", items: { type: "integer" } }, targets: { type: "array", items: { type: "array", items: { type: "integer" } } }, dynamicObstacles: { type: "array", items: { type: "array", items: { type: "number" } } }, scale: { type: "object" }, assumptions: { type: "array", items: { type: "string" } } }, required: ["name", "origin", "source"], additionalProperties: false },
      run: async args => { const { runId, ...input } = args; const id = runId === undefined ? null : (await external({ runId }, true)).id;
        if (id) { const policy = (await readRun(root, id)).envPolicy; if (policy && !policy.create) throw Error("The user has not allowed you to create or extend environments for this run. They can tick \"extend or create environment options\" in the run's Environments section."); }
        const saved = await saveEnvironment(envRoot, input, { createdBy: "agent" }); if (id) await updateRun(root, id, r => { r.createdEnvironments = [...(r.createdEnvironments ?? []), saved.id]; });
        if (id) await appendEvent(root, id, "environment", `Agent saved environment "${saved.name}" (${saved.id}) as a candidate.`); return { id: saved.id, status: saved.status, checks: saved.checks, note: "Saved as a candidate. The user approves it in the PaperRun tab before it counts as shared. Attach it to your run with paperrun_use_environment." }; } },
    { name: "paperrun_list_files", description: "List the files in the run's code folder.", inputSchema: { type: "object", properties: { runId: runIdSchema }, required: ["runId"], additionalProperties: false },
      run: async args => { const { id } = await external(args, false); return listCodeFiles(root, id); } },
    { name: "paperrun_read_file", description: "Read a file from the run's code folder (including results.json after a test run).", inputSchema: { type: "object", properties: { runId: runIdSchema, path: { type: "string" } }, required: ["runId", "path"], additionalProperties: false },
      run: async args => { const { id } = await external(args, false); return readCodeFile(root, id, str(args.path, "path", 120)); } },
    { name: "paperrun_write_file", description: "Write a file into the run's code folder (.py, .txt, .md, .json or .csv, at most 200 KB, at most 40 files). Write your implementation and run_tests.py here, not on your own disk, so the app can run and show them.", inputSchema: { type: "object", properties: { runId: runIdSchema, path: { type: "string", description: "Relative path such as impl.py." }, content: { type: "string" } }, required: ["runId", "path", "content"], additionalProperties: false },
      run: async args => { const { id } = await external(args, true); const path = str(args.path, "path", 120); await writeCodeFile(root, id, path, typeof args.content === "string" ? args.content : ""); await appendEvent(root, id, "agent", `Agent wrote ${path}`); return `Wrote ${path}.`; } },
    { name: "paperrun_run_tests", description: "Run run_tests.py in the app's sandbox (no network, writes only inside the run folder, 10 minute limit; Python with numpy, scipy, matplotlib, pandas). The app compares the numbers your code produced with the paper's and returns match, within tolerance, mismatch, not comparable or not run for each result. Call it after each change.", inputSchema: { type: "object", properties: { runId: runIdSchema }, required: ["runId"], additionalProperties: false },
      run: async args => {
        const { id, run } = await external(args, true); await updateRun(root, id, r => { r.status = "running"; }); await setStage(root, id, "Run tests", "running");
        try { const outcome = await runTests(root, id, run.rounds.used + 1, python); await setStage(root, id, "Run tests", "done", Object.entries(summarise(outcome.rows)).filter(([, n]) => n).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ")); return { round: outcome.round, exitCode: outcome.code, timedOut: outcome.timedOut, error: outcome.error ?? null, results: outcome.rows, stdoutTail: outcome.stdout.slice(-3000), stderrTail: outcome.stderr.slice(-3000) }; }
        finally { await updateRun(root, id, r => { if (r.status === "running") r.status = "waiting_external"; }); }
      } },
    { name: "paperrun_log", description: "Add a progress note to the run's log. It appears live in the PaperRun tab of the app.", inputSchema: { type: "object", properties: { runId: runIdSchema, message: { type: "string" } }, required: ["runId", "message"], additionalProperties: false },
      run: async args => { const { id } = await external(args, true); await appendEvent(root, id, "agent", str(args.message, "message", 2000)); return "Logged."; } },
    { name: "paperrun_finish", description: "Finish the run. The app builds the report from the latest compared results, lists the gaps and assumptions, and runs its own check for hardcoded results. Say honestly what you could not reproduce.", inputSchema: { type: "object", properties: { runId: runIdSchema, summary: { type: "string", description: "What you built, what you approximated, and what does not match and why." }, assumptionsUsed: { type: "array", items: { type: "string" }, description: "The assumptions you relied on, such as 'G3: 8-connected grid'." } }, required: ["runId", "summary"], additionalProperties: false },
      run: async args => { const { id } = await external(args, true); return finalizeExternal(root, id, { summary: str(args.summary, "summary", 3000), ...(Array.isArray(args.assumptionsUsed) ? { assumptionsUsed: args.assumptionsUsed.map(String) } : {}) }); } },
  ];
  return tools;
}

/** A JSON-RPC 2.0 handler for the Model Context Protocol (initialize, ping, tools/list, tools/call). Notifications return null. */
export function createMcpHandler(options: McpOptions) {
  const tools = paperRunTools(options), byName = new Map(tools.map(t => [t.name, t]));
  return async (message: unknown): Promise<Record<string, unknown> | null> => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } };
    const { id, method, params } = message as { id?: string | number; method?: unknown; params?: Record<string, unknown> };
    const reply = (result: unknown) => id === undefined ? null : { jsonrpc: "2.0", id, result };
    const fail = (code: number, text: string) => id === undefined ? null : { jsonrpc: "2.0", id, error: { code, message: text } };
    if (typeof method !== "string") return fail(-32600, "Invalid request.");
    if (method === "initialize") return reply({ protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "paperrun", version: "1.0.0" }, instructions: "Work a PaperRun prepared in the app. Start with paperrun_get_brief, write files with paperrun_write_file, test with paperrun_run_tests, and end with paperrun_finish. Never write a reported value in as a reproduced one." });
    if (method.startsWith("notifications/")) return null;
    if (method === "ping") return reply({});
    if (method === "tools/list") return reply({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (method === "tools/call") {
      const tool = typeof params?.name === "string" ? byName.get(params.name) : undefined; if (!tool) return fail(-32602, "Unknown tool.");
      try { const out = await tool.run(params?.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {}); return reply(isImage(out) ? { content: [{ type: "text", text: out.caption }, { type: "image", data: out.image.data, mimeType: out.image.mimeType }] } : text(out)); }
      catch (error) { return reply({ ...text(error instanceof Error ? error.message : "The tool failed."), isError: true }); }
    }
    return fail(-32601, `Method not found: ${method}`);
  };
}
/** Serves the handler over stdio, one JSON message per line, logging only to stderr. */
export function serveStdio(options: McpOptions) {
  const handle = createMcpHandler(options), lines = createInterface({ input: process.stdin });
  let pending = Promise.resolve();
  lines.on("line", line => { if (!line.trim()) return; pending = pending.then(async () => { let message: unknown; try { message = JSON.parse(line); } catch { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } })}\n`); return; } const response = await handle(message); if (response) process.stdout.write(`${JSON.stringify(response)}\n`); }); });
  // Wait for stdout to flush before exiting: a large reply (a page image) would otherwise be cut off when the client closes its end.
  lines.on("close", () => { void pending.then(() => { process.stdout.write("", () => process.exit(0)); }); });
}
const here = fileURLToPath(new URL(".", import.meta.url));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(process.env.PAPERRUN_ROOT ?? join(here, "../paperruns"));
  serveStdio({ root, python: resolve(process.env.PAPERRUN_PYTHON ?? join(root, ".venv/bin/python")), knowledgeRoot: resolve(process.env.PAPERRUN_KNOWLEDGE ?? join(here, "../knowledge")), environmentsRoot: resolve(process.env.PAPERRUN_ENVIRONMENTS ?? join(here, "../environments")) });
}
