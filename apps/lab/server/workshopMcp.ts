import { createInterface } from "node:readline";
import { readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { codeDirectory, listWorkshopFiles, listWorkshops, logLine, readWorkshop, updateWorkshop, WORKSHOP_ID, HYPOTHESIS_STATUS, type HypothesisStatus, type WorkshopRecord } from "./workshop.ts";

export interface WorkshopMcpOptions { root: string; now?: () => Date }
interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; run(args: Record<string, unknown>): Promise<unknown> }
const idSchema = { type: "string", description: "The workshop id, for example ws-20261104100000-ab12." };
const text = (value: unknown) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const str = (v: unknown, name: string, max: number) => { if (typeof v !== "string" || !v.trim() || v.length > max) throw Error(`${name} must be a non-empty string of at most ${max} characters.`); return v.trim(); };
export const briefText = (w: WorkshopRecord, folder: string, layout = false): string => [
  `WORKSHOP ${w.id}: ${w.title}`, `GOAL: ${w.goal}`, "",
  `BASELINE: the replication this builds on is rated "${w.replication.rating}", with ${w.replication.verified} of ${w.replication.total} results verified against the paper and method coverage ${w.replication.coveragePercent === null ? "not assessed" : `${w.replication.coveragePercent}%`}.${w.replication.verified === 0 ? " Nothing has been verified, so treat the method as unverified and say so in every result." : ""}`, "",
  `CODE FOLDER (write all code here, in your own editor; the app lists it live): ${folder}`,
  ...(layout ? ["  It is already set up: README.md says what is being tested, experiments/ holds one stub per hypothesis (each stops with NotImplementedError until written), and baseline/ is a copy of the replication code. The baseline is unverified: do not edit it, copy what you need into experiments/."] : []), "",
  "HYPOTHESES TO TEST", ...w.hypotheses.flatMap(h => [`${h.id} [${h.status}] ${h.statement}`, h.test ? `  Test: ${h.test}` : "  Test: not written yet, propose one in your first log entry", h.success ? `  Support or refute: ${h.success}` : "  Support or refute: not written yet"]), "",
  "NEXT STEPS FROM THE REPORT", ...w.nextSteps.map((s, i) => `${i + 1}. ${s}`), "",
  ...(w.repos.length ? ["CODE LEADS (found by search: not run, not audited, licences unchecked)", ...w.repos.map(r => `- ${r.title} ${r.url} (${r.meta})`), ""] : []),
  "RULES", "- Log what you do with workshop_log, so the app shows your progress.",
  "- Record each experiment with workshop_record_experiment: what you did, the metric and the value you measured. Never write a value you did not measure.",
  "- A hypothesis is marked supported or refuted only with a recorded experiment attached. Use workshop_set_status for testing or inconclusive.",
  "- Say plainly when an experiment cannot settle a hypothesis because the baseline is unverified or the data is simulated.",
].join("\n");

/** The tools an outside coding agent uses to report on a workshop. Code is written in the agent's own editor; these tools carry what happened back to the app. */
export function workshopTools(options: WorkshopMcpOptions): Tool[] {
  const { root } = options, deps = { now: options.now };
  const ready = async (args: Record<string, unknown>) => {
    const id = args.workshopId; if (typeof id !== "string" || !WORKSHOP_ID.test(id)) throw Error("workshopId must look like ws-YYYYMMDDHHMMSS-xxxx.");
    const w = await readWorkshop(root, id).catch(() => { throw Error("Unknown workshop."); });
    if (w.status !== "ready") throw Error(w.status === "preparing" ? "The workshop is still preparing its hypotheses. Try again in a minute." : "This workshop failed to prepare, so it has no hypotheses to work on.");
    return { id, w };
  };
  const hypothesis = (w: WorkshopRecord, id: unknown) => { const h = w.hypotheses.find(x => x.id === id); if (!h) throw Error(`Unknown hypothesis. Use one of: ${w.hypotheses.map(x => x.id).join(", ")}.`); return h; };
  const statusOf = (v: unknown) => { if (typeof v !== "string" || !(HYPOTHESIS_STATUS as readonly string[]).includes(v)) throw Error(`status must be one of: ${HYPOTHESIS_STATUS.join(", ")}.`); return v as HypothesisStatus; };
  return [
    { name: "workshop_list", description: "List workshops, newest first, with their status and how many hypotheses are supported, refuted or still open.", inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => (await listWorkshops(root)).map(w => ({ id: w.id, title: w.title, goal: w.goal, status: w.status, hypotheses: w.hypotheses.length, open: w.hypotheses.filter(h => ["untested", "testing"].includes(h.status)).length, createdAt: w.createdAt })) },
    { name: "workshop_get_brief", description: "Get the brief for a workshop: the goal, how far the baseline replication can be trusted, the code folder to work in, the hypotheses with how to test each, the report's next steps, code leads and the rules. Read this first.", inputSchema: { type: "object", properties: { workshopId: idSchema }, required: ["workshopId"], additionalProperties: false },
      run: async args => { const { id, w } = await ready(args); return briefText(w, codeDirectory(root, id), (await listWorkshopFiles(root, id)).some(f => f.path === "README.md")); } },
    { name: "workshop_get_report", description: "Get the full Descendance report this workshop came from, including its sources found online.", inputSchema: { type: "object", properties: { workshopId: idSchema }, required: ["workshopId"], additionalProperties: false },
      run: async args => (await ready(args)).w.report },
    { name: "workshop_list_files", description: "List the files in the workshop's code folder, found from the folder itself.", inputSchema: { type: "object", properties: { workshopId: idSchema }, required: ["workshopId"], additionalProperties: false },
      run: async args => listWorkshopFiles(root, (await ready(args)).id) },
    { name: "workshop_read_file", description: "Read a text file from the workshop's code folder (at most 100 KB).", inputSchema: { type: "object", properties: { workshopId: idSchema, path: { type: "string" } }, required: ["workshopId", "path"], additionalProperties: false },
      run: async args => { const { id } = await ready(args), base = codeDirectory(root, id), full = resolve(base, str(args.path, "path", 200)); if (relative(base, full).startsWith("..") || !full.startsWith(base)) throw Error("That path is outside the code folder."); const s = await stat(full).catch(() => null); if (!s?.isFile()) throw Error("No such file."); if (s.size > 100_000) throw Error("That file is larger than 100 KB."); return readFile(full, "utf8"); } },
    { name: "workshop_log", description: "Add a progress note. It appears live in the Workshop tab.", inputSchema: { type: "object", properties: { workshopId: idSchema, message: { type: "string" } }, required: ["workshopId", "message"], additionalProperties: false },
      run: async args => { const { id } = await ready(args); const message = str(args.message, "message", 2000); await updateWorkshop(root, id, w => { w.log.push(logLine(deps, "agent", message)); }, options.now?.()); return "Logged."; } },
    { name: "workshop_set_status", description: "Set a hypothesis to testing, inconclusive or untested. Supported and refuted are not set here: they need a recorded experiment, so use workshop_record_experiment.", inputSchema: { type: "object", properties: { workshopId: idSchema, hypothesisId: { type: "string", description: "For example H1." }, status: { type: "string", enum: ["untested", "testing", "inconclusive"] } }, required: ["workshopId", "hypothesisId", "status"], additionalProperties: false },
      run: async args => {
        const { id, w } = await ready(args), h = hypothesis(w, args.hypothesisId), status = statusOf(args.status);
        if (status === "supported" || status === "refuted") throw Error("Supported and refuted need evidence. Run the experiment, then call workshop_record_experiment with the metric and value you measured.");
        await updateWorkshop(root, id, x => { hypothesis(x, h.id).status = status; x.log.push(logLine(deps, "agent", `${h.id} set to ${status}.`)); }, options.now?.()); return `${h.id} is now ${status}.`;
      } },
    { name: "workshop_record_experiment", description: "Record one experiment against a hypothesis: what you did, the metric and the value you measured. The experiment becomes the hypothesis's evidence. To mark the hypothesis supported or refuted in the same call, give status and also metric and value. The Workshop tab labels it as reported by an agent, and a reader will judge it, so report honestly, including a result that goes against the hypothesis.", inputSchema: { type: "object", properties: { workshopId: idSchema, hypothesisId: { type: "string" }, summary: { type: "string", description: "What you did, in one or two sentences." }, metric: { type: "string", description: "What you measured, for example mission completion rate." }, value: { type: "string", description: "The value you measured, for example 17/30." }, status: { type: "string", enum: ["testing", "supported", "refuted", "inconclusive"], description: "Optional new status for the hypothesis." } }, required: ["workshopId", "hypothesisId", "summary"], additionalProperties: false },
      run: async args => {
        const { id, w } = await ready(args), h = hypothesis(w, args.hypothesisId), summary = str(args.summary, "summary", 600);
        const metric = args.metric === undefined ? undefined : str(args.metric, "metric", 120), value = args.value === undefined ? undefined : str(args.value, "value", 200), status = args.status === undefined ? undefined : statusOf(args.status);
        if ((status === "supported" || status === "refuted") && (!metric || !value)) throw Error("To mark a hypothesis supported or refuted, give the metric and the value you measured.");
        let experimentId = "";
        await updateWorkshop(root, id, x => {
          const target = hypothesis(x, h.id); experimentId = `E${x.experiments.length + 1}`;
          x.experiments.push({ id: experimentId, hypothesisId: h.id, summary, ...(metric ? { metric } : {}), ...(value ? { value } : {}), by: "agent", at: (options.now?.() ?? new Date()).toISOString() });
          target.evidence = [...target.evidence, experimentId]; if (status) target.status = status; else if (target.status === "untested") target.status = "testing";
          x.log.push(logLine(deps, "agent", `Recorded ${experimentId} for ${h.id}${metric && value ? `: ${metric} ${value}` : ""}${status ? `, now ${status}` : ""}.`));
        }, options.now?.());
        return { experimentId, hypothesis: h.id, status: status ?? (h.status === "untested" ? "testing" : h.status), reminder: w.replication.verified === 0 ? "The baseline replication is unverified, so say so when you report this result." : undefined };
      } },
  ];
}

/** A JSON-RPC 2.0 handler for the Model Context Protocol (initialize, ping, tools/list, tools/call). Notifications return null. */
export function createWorkshopMcpHandler(options: WorkshopMcpOptions) {
  const tools = workshopTools(options), byName = new Map(tools.map(t => [t.name, t]));
  return async (message: unknown): Promise<Record<string, unknown> | null> => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } };
    const { id, method, params } = message as { id?: string | number; method?: unknown; params?: Record<string, unknown> };
    const reply = (result: unknown) => id === undefined ? null : { jsonrpc: "2.0", id, result };
    const fail = (code: number, msg: string) => id === undefined ? null : { jsonrpc: "2.0", id, error: { code, message: msg } };
    if (typeof method !== "string") return fail(-32600, "Invalid request.");
    if (method === "initialize") return reply({ protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "workshop", version: "1.0.0" }, instructions: "Work a workshop prepared in the app. Start with workshop_get_brief, write code in the code folder with your own editor, log with workshop_log, and record each experiment with workshop_record_experiment. Never report a value you did not measure." });
    if (method.startsWith("notifications/")) return null;
    if (method === "ping") return reply({});
    if (method === "tools/list") return reply({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (method === "tools/call") {
      const tool = typeof params?.name === "string" ? byName.get(params.name) : undefined; if (!tool) return fail(-32602, "Unknown tool.");
      try { return reply(text(await tool.run(params?.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {}))); }
      catch (error) { return reply({ ...text(error instanceof Error ? error.message : "The tool failed."), isError: true }); }
    }
    return fail(-32601, `Method not found: ${method}`);
  };
}
export function serveStdio(options: WorkshopMcpOptions) {
  const handle = createWorkshopMcpHandler(options), lines = createInterface({ input: process.stdin });
  let pending = Promise.resolve();
  lines.on("line", line => { if (!line.trim()) return; pending = pending.then(async () => { let message: unknown; try { message = JSON.parse(line); } catch { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } })}\n`); return; } const response = await handle(message); if (response) process.stdout.write(`${JSON.stringify(response)}\n`); }); });
  lines.on("close", () => { void pending.then(() => { process.stdout.write("", () => process.exit(0)); }); });
}
const here = fileURLToPath(new URL(".", import.meta.url));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serveStdio({ root: resolve(process.env.WORKSHOP_ROOT ?? join(here, "../workshops")) });
