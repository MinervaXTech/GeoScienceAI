// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveEnvironment, createEnvironmentsHandler, deleteEnvironment, environmentHash, environmentUsage, getEnvironment, listEnvironments, saveEnvironment } from "./environments";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const fixed = (over: Record<string, unknown> = {}) => ({ name: "Open four", description: "", origin: "digitised", source: { note: "Fig. 9 (a)", paperTitle: "ACO paper", figure: "Fig. 9a" }, grid: { rows: 4, cols: 4, ascii: ["....", ".##.", "....", "...."] }, start: [0, 0], goal: [3, 3], ...over });
const walled = fixed({ name: "Walled", grid: { rows: 4, cols: 4, ascii: ["..#.", "..#.", "..#.", "..#."] } });
const setup = async () => { const base = await mkdtemp(join(tmpdir(), "envs-")); dirs.push(base); const root = join(base, "environments"), runs = join(base, "paperruns"); await mkdir(root, { recursive: true }); await mkdir(runs, { recursive: true }); return { root, runs }; };
describe("the environment library", () => {
  it("approves what the app or the user makes, but only proposes what Muse or an agent makes", async () => {
    const { root } = await setup();
    const app = await saveEnvironment(root, fixed(), { createdBy: "app" }), user = await saveEnvironment(root, fixed({ name: "User map" }), { createdBy: "user" }), agent = await saveEnvironment(root, fixed({ name: "Agent map" }), { createdBy: "agent" }), muse = await saveEnvironment(root, fixed({ name: "Muse map" }), { createdBy: "muse" });
    expect([app, user, agent, muse].map(e => e.status)).toEqual(["approved", "approved", "candidate", "candidate"]);
    expect(app).toMatchObject({ version: 1, createdBy: "app", checks: { solvable: true } }); expect(app.id).toMatch(/^env-open-four-[0-9a-f]{4}$/); expect(app.hash).toHaveLength(16);
  });
  it("never approves an environment whose checks fail, even from the user", async () => {
    const { root } = await setup(); const bad = await saveEnvironment(root, walled, { createdBy: "user" });
    expect(bad).toMatchObject({ status: "candidate", checks: { solvable: false } }); await expect(approveEnvironment(root, bad.id)).rejects.toThrow("fails its checks");
  });
  it("lets the user approve a good candidate", async () => {
    const { root } = await setup(); const c = await saveEnvironment(root, fixed(), { createdBy: "agent" });
    const approved = await approveEnvironment(root, c.id, new Date("2026-11-04T00:00:00Z")); expect(approved).toMatchObject({ status: "approved", updatedAt: "2026-11-04T00:00:00.000Z" }); expect((await getEnvironment(root, c.id)).status).toBe("approved");
  });
  it("gives each environment a unique id, a stable fingerprint, and sorted listing", async () => {
    const { root } = await setup(); const a = await saveEnvironment(root, fixed({ name: "Zeta" }), { createdBy: "app" }), b = await saveEnvironment(root, fixed({ name: "Alpha" }), { createdBy: "app" }), c = await saveEnvironment(root, fixed({ name: "Alpha" }), { createdBy: "app" });
    expect(new Set([a.id, b.id, c.id]).size).toBe(3); expect((await listEnvironments(root)).map(e => e.name)).toEqual(["Alpha", "Alpha", "Zeta"]);
    expect(b.hash).toBe(c.hash); expect(b.hash).not.toBe(a.hash);
    const h = (over: Record<string, unknown>) => environmentHash(fixed(over) as never); expect(h({})).toBe(h({})); expect(h({ start: [0, 1] })).not.toBe(h({}));
  });
  it("rejects invalid input with a message and keeps bad ids out of the filesystem", async () => {
    const { root } = await setup();
    await expect(saveEnvironment(root, fixed({ grid: { rows: 3, cols: 3, ascii: ["..", "..", ".."] } }), { createdBy: "user" })).rejects.toThrow(); await expect(saveEnvironment(root, "nope", { createdBy: "user" })).rejects.toThrow("must be an object");
    for (const id of ["../x", "env-../x", "ENV-x", "env-"]) await expect(getEnvironment(root, id)).rejects.toThrow("Invalid environment id");
    await expect(getEnvironment(root, "env-missing-0000")).rejects.toThrow();
  });
  it("keeps an environment that a run used, and deletes one that nothing used", async () => {
    const { root, runs } = await setup(); const used = await saveEnvironment(root, fixed({ name: "Used" }), { createdBy: "app" }), free = await saveEnvironment(root, fixed({ name: "Free" }), { createdBy: "app" });
    await mkdir(join(runs, "run-20261103000000-abcd")); await writeFile(join(runs, "run-20261103000000-abcd", "run.json"), JSON.stringify({ environments: [{ id: used.id }] }));
    expect(await environmentUsage(runs, used.id)).toEqual(["run-20261103000000-abcd"]); expect(await environmentUsage(runs, free.id)).toEqual([]);
    await expect(deleteEnvironment(root, runs, used.id)).rejects.toThrow("used by 1 run"); await deleteEnvironment(root, runs, free.id);
    expect((await listEnvironments(root)).map(e => e.name)).toEqual(["Used"]); await expect(deleteEnvironment(root, runs, free.id)).rejects.toThrow("Unknown environment");
  });
});
describe("the environment routes", () => {
  const origin = "http://localhost:5173";
  const call = (h: (r: Request) => Promise<Response>, path: string, body?: unknown, method = body === undefined ? "GET" : "POST", from = origin) => h(new Request(`${origin}${path}`, { method, headers: { origin: from, "sec-fetch-site": "same-origin", "content-type": "application/json" }, ...(body === undefined || method === "DELETE" ? {} : { body: JSON.stringify(body) }) }));
  it("lists summaries with previews, returns one in full, and creates user-approved environments", async () => {
    const { root, runs } = await setup(); const h = createEnvironmentsHandler({ root, runsRoot: runs });
    expect((await (await call(h, "/api/environments")).json()).environments).toEqual([]);
    const made = await call(h, "/api/environments", fixed()); expect(made.status).toBe(201); const env = (await made.json()).environment; expect(env).toMatchObject({ status: "approved", createdBy: "user" });
    const list = (await (await call(h, "/api/environments")).json()).environments; expect(list).toEqual([expect.objectContaining({ id: env.id, name: "Open four", kind: "fixed", rows: 4, cols: 4, solvable: true, ascii: ["....", ".##.", "....", "...."] })]);
    const full = await (await call(h, `/api/environments/${env.id}`)).json(); expect(full.environment.grid.ascii).toHaveLength(4); expect(full.usedBy).toEqual([]);
  });
  it("approves a candidate, refuses to delete a used one, and refuses other origins and bad input", async () => {
    const { root, runs } = await setup(); const h = createEnvironmentsHandler({ root, runsRoot: runs }); const cand = await saveEnvironment(root, fixed(), { createdBy: "agent" });
    expect((await (await call(h, `/api/environments/${cand.id}/approve`, {})).json()).environment.status).toBe("approved");
    await mkdir(join(runs, "run-20261103000000-abcd")); await writeFile(join(runs, "run-20261103000000-abcd", "run.json"), JSON.stringify({ environments: [{ id: cand.id }] }));
    const del = await call(h, `/api/environments/${cand.id}`, undefined, "DELETE"); expect(del.status).toBe(400); expect((await del.json()).error).toContain("used by 1 run");
    expect((await call(h, "/api/environments", fixed(), "POST", "https://other.site")).status).toBe(403); expect((await call(h, "/api/environments", { name: "x" })).status).toBe(400);
    expect((await call(h, "/api/environments/env-nope-0000")).status).toBe(404); expect((await call(h, "/api/environments/ENV..")).status).toBe(404);
    const free = await saveEnvironment(root, fixed({ name: "Free" }), { createdBy: "app" }); expect((await (await call(h, `/api/environments/${free.id}`, undefined, "DELETE")).json()).deleted).toBe(free.id);
  });
});
