import type { Connect, Plugin } from "vite";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { getEnvironment } from "./environments.ts";
import { appendEvent, attachEnvironment, detachEnvironment, parsePolicy, setEnvPolicy, codePath, createRun, listCodeFiles, listRuns, readCodeFile, readEvents, readRun, readSpec, runDirectory, runTests, updateRun, validRunId, workingRuns } from "./paperrunCore.ts";
import { assessRun, continueRun, finalizeExternal, forkForExternal, guidanceFor, runPipeline, type PipelineDeps } from "./paperrunPipeline.ts";

const ROOT = fileURLToPath(new URL("../paperruns/", import.meta.url)), KNOWLEDGE = fileURLToPath(new URL("../knowledge/", import.meta.url)), ENVIRONMENTS = fileURLToPath(new URL("../environments/", import.meta.url));
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const short = (v: unknown, max: number) => typeof v === "string" && !!v.trim() && v.length <= max;
const MODELS = ["muse-wonder-1.0", "muse-spark-1.3"];

export interface PaperRunOptions { environmentsRoot?: string; knowledgeRoot?: string; root?: string; python?: string; knowledge: (req: Request) => Promise<Response>; send?: typeof fetch; testTimeoutMs?: number; pipeline?: (deps: PipelineDeps, runId: string, signal: AbortSignal) => Promise<void>; continuation?: (deps: PipelineDeps, runId: string, input: { rounds: number; addTokens: number; guidance: string }, signal: AbortSignal) => Promise<void>; sandboxAvailable?: boolean }
const FILE_ALLOWED = /^(?:report\.md|spec\.md|brief\.md|rounds\/[0-9]{1,2}\/(?:stdout\.txt|stderr\.txt|compared\.json|results\.json))$/;

export function createPaperRunHandler(key: string, options: PaperRunOptions) {
  const root = resolve(options.root ?? ROOT), python = resolve(options.python ?? join(root, ".venv/bin/python")), send = options.send ?? fetch;
  const active = new Map<string, AbortController>();
  const ready = () => (options.sandboxAvailable ?? (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec"))) ? existsSync(python) ? null : "The PaperRun Python environment is missing. Run: npm run paperrun:setup (in apps/lab)." : "Running code in a sandbox needs macOS. Use an external agent instead.";
  const knowledge = (path: string, body: unknown, method = "POST") => options.knowledge(new Request(`http://paperrun.local${path}`, { method, headers: { origin: "http://paperrun.local", "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }));
  const mcpConfig = () => ({ command: "node", args: ["--experimental-strip-types", fileURLToPath(new URL("./paperrunMcp.ts", import.meta.url))], env: { PAPERRUN_ROOT: root, PAPERRUN_PYTHON: python, PAPERRUN_ENVIRONMENTS: resolve(options.environmentsRoot ?? ENVIRONMENTS) } });
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.headers.get("origin") !== url.origin && req.method !== "GET") return json({ error: "Use PaperRun from this app." }, 403);
    if (req.method !== "GET" && req.headers.has("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin") return json({ error: "Use PaperRun from this app." }, 403);
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/api/paperrun/status") return json({ root, ready: ready() === null, problem: ready(), configured: !!key.trim(), mcp: mcpConfig(), running: [...active.keys()], working: await workingRuns(root) });
      if (req.method === "GET" && path === "/api/paperrun") return json({ runs: await listRuns(root) });
      const one = /^\/api\/paperrun\/(run-[0-9]{14}-[a-f0-9]{4})(?:\/(file|cancel|run-tests|finish|assess|continue|handover|environments))?$/.exec(path);
      if (one) {
        const id = one[1]!, action = one[2];
        if (!validRunId(id)) return json({ error: "Invalid run id." }, 400);
        const run = await readRun(root, id).catch(() => null); if (!run) return json({ error: "Unknown run." }, 404);
        if (req.method === "GET" && !action) {
          const report = await readFile(join(runDirectory(root, id), "report.md"), "utf8").catch(() => null);
          const spec = await readSpec(root, id).then(x => x.spec).catch(() => null);
          return json({ run, events: await readEvents(root, id, 120), files: await listCodeFiles(root, id), report, active: active.has(id), directory: runDirectory(root, id), gaps: (spec?.gaps ?? []).map(g => ({ id: g.id, kind: g.kind, impact: g.impact, description: g.description })) });
        }
        if (req.method === "GET" && action === "file") {
          const wanted = url.searchParams.get("path") ?? "";
          if (FILE_ALLOWED.test(wanted)) return json({ path: wanted, content: (await readFile(join(runDirectory(root, id), wanted), "utf8").catch(() => "")).slice(0, 200000) });
          if (wanted.startsWith("code/")) { codePath(root, id, wanted.slice(5)); return json({ path: wanted, content: await readCodeFile(root, id, wanted.slice(5)).catch(() => "") }); }
          return json({ error: "That file cannot be read here." }, 400);
        }
        if (req.method === "POST" && action === "cancel") {
          active.get(id)?.abort(); if (!active.has(id) && !["done", "failed", "cancelled"].includes(run.status)) await updateRun(root, id, r => { r.status = "cancelled"; r.error = "Cancelled by the user."; });
          await appendEvent(root, id, "cancel", "Cancel requested."); return json({ ok: true });
        }
        if (req.method === "POST" && action === "run-tests") {
          const problem = ready(); if (problem) return json({ error: problem }, 503);
          if (active.has(id)) return json({ error: "This run is already working." }, 409);
          const controller = new AbortController(); active.set(id, controller);
          try { const before = run.status; await updateRun(root, id, r => { r.status = "running"; }); const outcome = await runTests(root, id, run.rounds.used + 1, python, controller.signal, options.testTimeoutMs); await updateRun(root, id, r => { r.status = before === "done" ? "done" : r.mode === "external" ? "waiting_external" : before; }); return json({ rows: outcome.rows, error: outcome.error, stderr: outcome.stderr.slice(-4000), stdout: outcome.stdout.slice(-4000) }); }
          finally { active.delete(id); }
        }
        if (req.method === "POST" && action === "environments") {
          if (active.has(id) || (run.mode === "muse" && !["done", "failed", "cancelled"].includes(run.status))) return json({ error: "This run is still working. Change its environments once it has finished, or cancel it." }, 409);
          const value = JSON.parse((await req.text()) || "{}"), ids: unknown = value?.environments ?? (run.environments ?? []).map(e => e.id), policy = value?.policy === undefined ? undefined : parsePolicy(value.policy);
          if (!obj(value) || Object.keys(value).some(k => k !== "environments" && k !== "policy") || (value.policy !== undefined && !policy) || !Array.isArray(ids) || ids.length > 5 || ids.some(x => typeof x !== "string") || new Set(ids).size !== ids.length) return json({ error: "Send up to 5 different environment ids." }, 400);
          const envRoot = resolve(options.environmentsRoot ?? ENVIRONMENTS), want = ids as string[], have = (run.environments ?? []).map(e => e.id);
          for (const envId of want) if (!have.includes(envId)) { const env = await getEnvironment(envRoot, envId).catch(() => null); if (!env) return json({ error: "Unknown environment." }, 400); if (env.status !== "approved") return json({ error: "Only approved environments can be added." }, 400); }
          for (const envId of have) if (!want.includes(envId)) await detachEnvironment(root, id, envId);
          for (const envId of want) if (!have.includes(envId)) await attachEnvironment(root, id, envRoot, envId);
          if (policy) await setEnvPolicy(root, id, policy);
          return json({ run: await readRun(root, id) });
        }
        if (req.method === "POST" && action === "handover") {
          if (active.has(id)) return json({ error: "This run is still working. Wait for it or cancel it first." }, 409);
          const childId = await forkForExternal(root, id, resolve(options.knowledgeRoot ?? KNOWLEDGE), resolve(options.environmentsRoot ?? ENVIRONMENTS));
          return json({ run: await readRun(root, childId), directory: runDirectory(root, childId), mcp: mcpConfig() });
        }
        if (req.method === "POST" && action === "continue") {
          if (run.mode !== "muse") return json({ error: "Only runs Muse handled can be continued here. Your external agent continues in its own session." }, 400);
          if (!["done", "failed", "cancelled"].includes(run.status)) return json({ error: "Wait for the run to finish, or cancel it, before continuing." }, 409);
          if (!key.trim()) return json({ error: "Configure MODEL_API_KEY and restart the app." }, 503);
          const problem = ready(); if (problem) return json({ error: problem }, 503);
          if (active.size) return json({ error: "Another PaperRun is working. Wait for it or cancel it." }, 409);
          const raw = await req.text(), value = raw ? JSON.parse(raw) : {};
          if (!obj(value) || Object.keys(value).some(k => !["rounds", "addTokens"].includes(k)) || (value.rounds !== undefined && !(Number.isInteger(value.rounds) && (value.rounds as number) >= 1 && (value.rounds as number) <= 3)) || (value.addTokens !== undefined && !(Number.isInteger(value.addTokens) && (value.addTokens as number) >= 0 && (value.addTokens as number) <= 600000))) throw Error("Send rounds 1-3 and optionally addTokens up to 600000.");
          const spec = (await readSpec(root, id)).spec, controller = new AbortController(); active.set(id, controller);
          const deps: PipelineDeps = { root, key, send, python, environmentsRoot: resolve(options.environmentsRoot ?? ENVIRONMENTS), ...(options.testTimeoutMs ? { testTimeoutMs: options.testTimeoutMs } : {}) };
          void (options.continuation ?? continueRun)(deps, id, { rounds: (value.rounds as number | undefined) ?? 2, addTokens: (value.addTokens as number | undefined) ?? 150000, guidance: guidanceFor(run, spec) }, controller.signal).finally(() => active.delete(id));
          return json({ run: await readRun(root, id) });
        }
        if (req.method === "POST" && action === "assess") {
          if (!key.trim()) return json({ error: "Configure MODEL_API_KEY and restart the app." }, 503);
          if (active.has(id)) return json({ error: "This run is already working." }, 409);
          const controller = new AbortController(); active.set(id, controller);
          try { const deps: PipelineDeps = { root, key, send, python }; const result = await assessRun(deps, id, AbortSignal.any([controller.signal, AbortSignal.timeout(300000)])); return json({ concerns: result.concerns, stepCoverage: result.coverage, run: await readRun(root, id) }); }
          finally { active.delete(id); }
        }
        if (req.method === "POST" && action === "finish") {
          if (run.mode !== "external") return json({ error: "Only runs prepared for an external agent can be finished by hand." }, 400);
          const raw = await req.text(), parsed = raw ? JSON.parse(raw) : {};
          return json({ report: await finalizeExternal(root, id, { summary: obj(parsed) && short(parsed.summary, 3000) ? parsed.summary as string : "Finished from the app." }) });
        }
        return json({ error: "Unknown PaperRun operation." }, 404);
      }
      if (req.method === "POST" && path === "/api/paperrun/start") {
        const value = JSON.parse(await req.text());
        if (!obj(value) || Object.keys(value).some(k => !["paper", "mode", "rounds", "tokenCap", "model", "collection", "environments", "envPolicy"].includes(k)) || (value.envPolicy !== undefined && !parsePolicy(value.envPolicy)) || (value.environments !== undefined && !(Array.isArray(value.environments) && value.environments.length <= 5 && value.environments.every(e => typeof e === "string" && /^env-[a-z0-9-]{1,56}$/.test(e)))) || !short(value.paper, 200) || !["muse", "external"].includes(value.mode as string) || (value.rounds !== undefined && !(Number.isInteger(value.rounds) && (value.rounds as number) >= 0 && (value.rounds as number) <= 6)) || (value.tokenCap !== undefined && !(Number.isInteger(value.tokenCap) && (value.tokenCap as number) >= 50000 && (value.tokenCap as number) <= 2000000)) || (value.model !== undefined && !MODELS.includes(value.model as string)) || (value.collection !== undefined && !short(value.collection, 60))) throw Error("Send a paper, a mode (muse or external), and optionally rounds 0-6, a token cap, a Muse model and a collection.");
        const mode = value.mode as "muse" | "external", model = (value.model as string | undefined) ?? "muse-wonder-1.0";
        if (mode === "muse") { if (!key.trim()) return json({ error: "Configure MODEL_API_KEY and restart the app." }, 503); const problem = ready(); if (problem) return json({ error: problem }, 503); if (active.size) return json({ error: "Another PaperRun is working. Wait for it or cancel it." }, 409); }
        const built = await knowledge("/api/knowledge/replication", { paper: value.paper, model, ...(value.collection ? { collection: value.collection } : {}) });
        const data = await built.json();
        if (!built.ok) return json({ error: data.error ?? "The reproduction spec could not be built." }, built.status);
        if (data.status !== "spec") return json({ error: data.status === "ambiguous" ? "More than one stored paper matches. Use a more exact title." : "That paper is not in the knowledge base.", papers: data.papers }, 404);
        const run = await createRun(root, { paperId: data.paper.id, title: data.meta.title, mode, model, maxRounds: (value.rounds as number | undefined) ?? 4, tokenCap: (value.tokenCap as number | undefined) ?? 400000, spec: data.spec, meta: data.meta });
        if (value.envPolicy !== undefined) await setEnvPolicy(root, run.id, parsePolicy(value.envPolicy)!);
        for (const envId of (value.environments as string[] | undefined) ?? []) await attachEnvironment(root, run.id, resolve(options.environmentsRoot ?? ENVIRONMENTS), envId);
        if (mode === "muse") {
          const controller = new AbortController(); active.set(run.id, controller);
          const deps: PipelineDeps = { root, key, send, python, environmentsRoot: resolve(options.environmentsRoot ?? ENVIRONMENTS), ...(options.testTimeoutMs ? { testTimeoutMs: options.testTimeoutMs } : {}) };
          void (options.pipeline ?? runPipeline)(deps, run.id, controller.signal).finally(() => active.delete(run.id));
        }
        return json({ run: await readRun(root, run.id), directory: runDirectory(root, run.id), mcp: mode === "external" ? mcpConfig() : undefined });
      }
      return json({ error: "Unknown PaperRun operation." }, 404);
    } catch (error) { return json({ error: error instanceof Error ? error.message.slice(0, 400) : "PaperRun failed." }, 400); }
  };
}

export function paperRunPlugin(key: string, knowledge: (req: Request) => Promise<Response>): Plugin {
  const handle = createPaperRunHandler(key, { knowledge });
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/paperrun")) return next();
    try {
      const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) { res.statusCode = 413; res.end(JSON.stringify({ error: "Request too large." })); return; } chunks.push(chunk as Buffer); }
      const headers = new Headers(); for (const name of ["origin", "sec-fetch-site", "content-type"]) { const value = req.headers[name]; if (typeof value === "string") headers.set(name, value); }
      const response = await handle(new Request(new URL(req.url, `http://${req.headers.host ?? "localhost"}`), { method: req.method, headers, ...(["POST", "DELETE"].includes(req.method ?? "") ? { body: Buffer.concat(chunks) } : {}) }));
      res.statusCode = response.status; response.headers.forEach((v, k) => res.setHeader(k, v)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.statusCode = 500; res.end(JSON.stringify({ error: "PaperRun failed." })); }
  };
  return { name: "local-paperrun", configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
