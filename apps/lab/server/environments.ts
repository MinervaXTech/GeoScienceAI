import type { Connect, Plugin } from "vite";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEnvironment, validEnvId, validateEnvironmentInput, type EnvCreator, type Environment, type EnvironmentInput } from "../src/domain/environment.ts";

const ROOT = fileURLToPath(new URL("../environments/", import.meta.url)), RUNS = fileURLToPath(new URL("../paperruns/", import.meta.url));
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
/** A fingerprint of everything that defines the world, so a run can record exactly which one it used. */
export function environmentHash(input: EnvironmentInput): string {
  const { name, description, origin, source, grid, generator, start, goal, targets, dynamicObstacles, scale, assumptions } = input;
  return createHash("sha256").update(JSON.stringify(stable({ name, description, origin, source, grid, generator, start, goal, targets, dynamicObstacles, scale, assumptions }))).digest("hex").slice(0, 16);
}
const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "map";
const dir = (root: string, id: string) => { if (!validEnvId(id)) throw Error("Invalid environment id."); return join(root, id); };
async function atomic(path: string, value: unknown) { const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`; await writeFile(tmp, JSON.stringify(value, null, 1)); await rename(tmp, path); }

export async function getEnvironment(root: string, id: string): Promise<Environment> { return JSON.parse(await readFile(join(dir(root, id), "env.json"), "utf8")); }
export async function listEnvironments(root: string): Promise<Environment[]> {
  const out: Environment[] = [];
  for (const name of await readdir(root).catch(() => [] as string[])) if (validEnvId(name)) { try { out.push(await getEnvironment(root, name)); } catch { /* an incomplete folder is skipped */ } }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
/**
 * Saves a new environment after checking it. What the app or the user makes is approved at once, provided its checks pass.
 * What Muse or an agent makes starts as a candidate, and needs the user's approval before it counts as part of the shared library.
 */
export async function saveEnvironment(root: string, value: unknown, options: { createdBy: EnvCreator; parentId?: string; now?: Date }): Promise<Environment> {
  const input = validateEnvironmentInput(value), now = (options.now ?? new Date()).toISOString(), checks = checkEnvironment(input, now);
  let id = `env-${slug(input.name)}-${randomBytes(2).toString("hex")}`;
  while (await getEnvironment(root, id).then(() => true, () => false)) id = `env-${slug(input.name)}-${randomBytes(2).toString("hex")}`;
  const trusted = options.createdBy === "app" || options.createdBy === "user";
  const env: Environment = { ...input, id, status: trusted && checks.solvable ? "approved" : "candidate", version: 1, hash: environmentHash(input), checks, createdBy: options.createdBy, createdAt: now, updatedAt: now, ...(options.parentId ? { parentId: options.parentId } : {}) };
  await mkdir(dir(root, id), { recursive: true }); await atomic(join(dir(root, id), "env.json"), env);
  return env;
}
export async function approveEnvironment(root: string, id: string, now = new Date()): Promise<Environment> {
  const env = await getEnvironment(root, id), checks = checkEnvironment(env, now.toISOString());
  if (!checks.solvable) throw Error(`This environment fails its checks, so it cannot be approved: ${checks.notes.filter(n => /no route|no connected/.test(n)).join(" ") || "see its check notes"}`);
  const next: Environment = { ...env, status: "approved", checks, updatedAt: now.toISOString() };
  await atomic(join(dir(root, id), "env.json"), next); return next;
}
/** Run ids that recorded this environment as used. */
export async function environmentUsage(runsRoot: string, id: string): Promise<string[]> {
  const used: string[] = [];
  for (const name of await readdir(runsRoot).catch(() => [] as string[])) {
    if (!/^run-\d{14}-[a-f0-9]{4}$/.test(name)) continue;
    try { const run = JSON.parse(await readFile(join(runsRoot, name, "run.json"), "utf8")); if ((run.environments ?? []).some((e: { id: string }) => e.id === id)) used.push(name); } catch { /* skip */ }
  }
  return used;
}
export async function deleteEnvironment(root: string, runsRoot: string, id: string): Promise<void> {
  await getEnvironment(root, id).catch(() => { throw Error("Unknown environment."); });
  const used = await environmentUsage(runsRoot, id);
  if (used.length) throw Error(`This environment is used by ${used.length} run${used.length === 1 ? "" : "s"} (${used.slice(0, 3).join(", ")}${used.length > 3 ? ", …" : ""}). Results from those runs refer to it, so it is kept.`);
  await rm(dir(root, id), { recursive: true, force: true });
}

const summary = (e: Environment) => ({ id: e.id, name: e.name, description: e.description, origin: e.origin, status: e.status, version: e.version, hash: e.hash, source: e.source, kind: e.grid ? "fixed" : "generator", rows: e.grid?.rows ?? e.generator!.rows, cols: e.grid?.cols ?? e.generator!.cols, generator: e.generator, start: e.start ?? e.generator?.start, goal: e.goal ?? e.generator?.goal, targets: e.targets ?? [], dynamicObstacles: e.dynamicObstacles ?? [], assumptions: e.assumptions ?? [], scale: e.scale, solvable: e.checks.solvable, checkNotes: e.checks.notes, createdBy: e.createdBy, createdAt: e.createdAt });
export { summary as environmentSummary };

export interface EnvironmentsOptions { root?: string; runsRoot?: string }
export function createEnvironmentsHandler(options: EnvironmentsOptions = {}) {
  const root = resolve(options.root ?? ROOT), runsRoot = resolve(options.runsRoot ?? RUNS);
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method !== "GET" && (req.headers.get("origin") !== url.origin || (req.headers.has("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin"))) return json({ error: "Use the environment library from this app." }, 403);
    try {
      if (req.method === "GET" && url.pathname === "/api/environments") { await mkdir(root, { recursive: true }); return json({ environments: (await listEnvironments(root)).map(e => ({ ...summary(e), ascii: e.grid?.ascii })) }); }
      const one = /^\/api\/environments\/([a-z0-9-]+)(?:\/(approve))?$/.exec(url.pathname);
      if (one) {
        const id = one[1]!;
        if (!validEnvId(id)) return json({ error: "Invalid environment id." }, 400);
        const env = await getEnvironment(root, id).catch(() => null); if (!env) return json({ error: "Unknown environment." }, 404);
        if (req.method === "GET" && !one[2]) return json({ environment: env, usedBy: await environmentUsage(runsRoot, id) });
        if (req.method === "POST" && one[2] === "approve") return json({ environment: await approveEnvironment(root, id) });
        if (req.method === "DELETE" && !one[2]) { await deleteEnvironment(root, runsRoot, id); return json({ deleted: id }); }
      }
      if (req.method === "POST" && url.pathname === "/api/environments") { await mkdir(root, { recursive: true }); return json({ environment: await saveEnvironment(root, JSON.parse(await req.text()), { createdBy: "user" }) }, 201); }
      return json({ error: "Unknown environment operation." }, 404);
    } catch (error) { return json({ error: error instanceof Error ? error.message.slice(0, 400) : "The environment library failed." }, 400); }
  };
}

export function environmentsPlugin(): Plugin {
  const handle = createEnvironmentsHandler();
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/environments")) return next();
    try {
      const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) { res.statusCode = 413; res.end(JSON.stringify({ error: "Request too large." })); return; } chunks.push(chunk as Buffer); }
      const headers = new Headers(); for (const name of ["origin", "sec-fetch-site", "content-type"]) { const value = req.headers[name]; if (typeof value === "string") headers.set(name, value); }
      const response = await handle(new Request(new URL(req.url, `http://${req.headers.host ?? "localhost"}`), { method: req.method, headers, ...(["POST", "DELETE"].includes(req.method ?? "") ? { body: Buffer.concat(chunks) } : {}) }));
      res.statusCode = response.status; response.headers.forEach((v, k) => res.setHeader(k, v)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.statusCode = 500; res.end(JSON.stringify({ error: "The environment library failed." })); }
  };
  return { name: "local-environments", configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
