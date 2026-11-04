// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSyncHandler } from "./knowledgeSync";
import { itemDocument, saveToWiki, type WikiDeps } from "./wiki";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const DESC = "desc-20261104100000-aaaa", RUN = "run-20261104020213-fd1e", origin = "http://localhost:5173";
const descend = { id: DESC, runId: RUN, paperId: "paper-0001", title: "Global and local path planning", goal: "Can ACO go to the real world?", model: "m", status: "done", online: true, repos: [], scoutQueries: [], replication: { rating: "Early attempt", verified: 0, total: 17, coveragePercent: 69 }, tokens: { used: 1, cap: 2 }, findings: [], verdict: "feasible_with_changes", report: "# Feasibility study: ACO\n\n**Goal:** g\n\nPossible with [sensing](https://example.org/x).\n", nextSteps: [], events: [], createdAt: "2026-11-04T03:00:00.000Z", updatedAt: "2026-11-04T03:00:00.000Z" };
async function setup(status = "done") {
  const base = await mkdtemp(join(tmpdir(), "sync-")); dirs.push(base);
  const deps: WikiDeps = { root: join(base, "wiki"), runsRoot: join(base, "runs"), descendRoot: join(base, "desc"), workshopRoot: join(base, "ws"), now: () => new Date("2026-11-04T04:00:00.000Z") };
  await mkdir(join(deps.descendRoot, DESC), { recursive: true }); await writeFile(join(deps.descendRoot, DESC, "descend.json"), JSON.stringify({ ...descend, status }));
  return deps;
}
function knowledge(entries: unknown[] = [], ingest: () => Response = () => Response.json({ entry: { id: "new-entry", status: "stored", title: "t", origin: { kind: "exploration", id: DESC, paperId: "paper-0001" } } })) {
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  // Like the real knowledge base, a delete only works when it carries confirmed: true.
  const handle = async (req: Request) => { const path = new URL(req.url).pathname, body = req.method === "GET" ? undefined : await req.json().catch(() => undefined); calls.push({ method: req.method, path, ...(body ? { body } : {}) }); if (path === "/api/knowledge/ingest") return ingest(); if (path === "/api/knowledge" && req.method === "GET") return Response.json({ entries }); if (req.method === "DELETE") return body?.confirmed === true ? Response.json({ deleted: true }) : Response.json({ error: "Confirm paper deletion first." }, { status: 400 }); return Response.json({ error: "unexpected" }, { status: 404 }); };
  return { calls, handle };
}
const post = (h: (r: Request) => Promise<Response>, body: unknown, from = origin) => h(new Request(`${origin}/api/graph-sync/graph`, { method: "POST", headers: { origin: from, "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("knowledge sync", () => {
  it("turns an item into plain text that says it is app-made, unverified and not a paper", async () => {
    const d = await setup(), doc = await itemDocument(d, "exploration", DESC);
    expect(doc.title).toBe("Exploration: Can ACO go to the real world?"); expect(doc.paperId).toBe("paper-0001");
    expect(doc.text.startsWith("APP-MADE ENTRY, NOT A PAPER. This is a exploration from the GeoScienceAI Lab app, last changed 2026-11-04 03:00.")).toBe(true); expect(doc.text).toContain("none of it is verified unless it says so"); expect(doc.text).toMatch(/treat the method as unverified/i);
    expect(doc.text).not.toContain("---"); expect(doc.text).not.toContain("]("); expect(doc.text).toContain("Possible with sensing."); expect(doc.text).toContain("Feasibility study: ACO");
  });
  it("gives identical text for an unchanged item whenever it is read, so the graph can recognise it", async () => {
    const d = await setup(), later = { ...d, now: () => new Date("2027-01-01T00:00:00.000Z") };
    expect((await itemDocument(later, "exploration", DESC)).text).toBe((await itemDocument(d, "exploration", DESC)).text);
  });
  it("sends the text to the knowledge ingest with the origin and the user's confirmation, and returns the entry", async () => {
    const d = await setup(), k = knowledge(), handle = createSyncHandler({ ...d, knowledge: k.handle });
    const res = await post(handle, { kind: "exploration", id: DESC, confirmed: true }); expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ entry: { id: "new-entry" }, duplicate: false, replaced: 0 });
    const sent = k.calls.find(c => c.path === "/api/knowledge/ingest")!.body!; expect(sent).toMatchObject({ confirmed: true, model: "muse-wonder-1.0", title: "Exploration: Can ACO go to the real world?", origin: { kind: "exploration", id: DESC, paperId: "paper-0001" } }); expect(String(sent.text)).toContain("APP-MADE ENTRY");
  });
  it("replaces the item's earlier entry only after the new one is stored, and leaves other entries alone", async () => {
    const d = await setup(), entries = [{ id: "old-entry", status: "stored", origin: { kind: "exploration", id: DESC, paperId: "p" } }, { id: "other-item", status: "stored", origin: { kind: "exploration", id: "desc-20261104000000-bbbb", paperId: "p" } }, { id: "a-paper", status: "stored" }, { id: "new-entry", status: "stored", origin: { kind: "exploration", id: DESC, paperId: "p" } }];
    const k = knowledge(entries), handle = createSyncHandler({ ...d, knowledge: k.handle }), out = await (await post(handle, { kind: "exploration", id: DESC, confirmed: true })).json();
    expect(out.replaced).toBe(1); expect(k.calls.filter(c => c.method === "DELETE").map(c => [c.path, c.body])).toEqual([["/api/knowledge/old-entry", { confirmed: true }]]);
    const failing = knowledge(entries, () => Response.json({ error: "Muse extraction failed" }, { status: 502 })), res = await post(createSyncHandler({ ...d, knowledge: failing.handle }), { kind: "exploration", id: DESC, confirmed: true });
    expect(res.status).toBe(502); expect((await res.json()).error).toBe("Muse extraction failed"); expect(failing.calls.some(c => c.method === "DELETE")).toBe(false);
  });
  it("clears failed attempts at the same item, before a retry and after a failure, and leaves other entries alone", async () => {
    const d = await setup(), entries = [{ id: "failed-same", status: "failed", origin: { kind: "exploration", id: DESC, paperId: "p" } }, { id: "failed-other", status: "failed", origin: { kind: "exploration", id: "desc-20261104000000-bbbb", paperId: "p" } }, { id: "failed-paper", status: "failed" }];
    const k = knowledge(entries, () => Response.json({ error: "Muse ran out of output space" }, { status: 400 })), res = await post(createSyncHandler({ ...d, knowledge: k.handle }), { kind: "exploration", id: DESC, confirmed: true });
    expect(res.status).toBe(400); expect(k.calls.filter(c => c.method === "DELETE").map(c => c.path)).toEqual(["/api/knowledge/failed-same", "/api/knowledge/failed-same"]);
    const ok = knowledge(entries), out = await post(createSyncHandler({ ...d, knowledge: ok.handle }), { kind: "exploration", id: DESC, confirmed: true }); expect(out.status).toBe(200); expect(ok.calls.filter(c => c.method === "DELETE").map(c => c.path)).toEqual(["/api/knowledge/failed-same"]);
  });
  it("says where an item stands, and flags a copy as behind only when the item changed after that copy was made", async () => {
    const d = await setup(), get = (h: (r: Request) => Promise<Response>, query: string) => h(new Request(`${origin}/api/graph-sync/status?${query}`));
    const entry = (addedAt: string, status = "stored", id = DESC) => ({ id: `e-${addedAt}`, status, addedAt, origin: { kind: "exploration", id, paperId: "p" } });
    const h0 = createSyncHandler({ ...d, knowledge: knowledge([]).handle });
    expect(await (await get(h0, `kind=exploration&id=${DESC}`)).json()).toEqual({ changedAt: "2026-11-04T03:00:00.000Z", wiki: { saved: false, stale: false }, graph: { saved: false, stale: false } });
    await saveToWiki(d, "exploration", DESC); // the page is written now, which is after the item last changed
    const current = await (await get(createSyncHandler({ ...d, knowledge: knowledge([entry("2026-11-04T03:30:00.000Z")]).handle }), `kind=exploration&id=${DESC}`)).json();
    expect(current.wiki).toMatchObject({ saved: true, stale: false }); expect(current.graph).toEqual({ saved: true, addedAt: "2026-11-04T03:30:00.000Z", stale: false });
    const behind = await (await get(createSyncHandler({ ...d, knowledge: knowledge([entry("2026-11-04T02:00:00.000Z"), entry("2026-11-04T02:30:00.000Z"), entry("2026-11-04T09:00:00.000Z", "failed"), entry("2099-01-01T00:00:00.000Z", "stored", "desc-20261104000000-bbbb")]).handle }), `kind=exploration&id=${DESC}`)).json();
    expect(behind.graph).toEqual({ saved: true, addedAt: "2026-11-04T02:30:00.000Z", stale: true }); // the newest stored copy for this item; a failed or other item's entry does not count
    await writeFile(join(d.descendRoot, DESC, "descend.json"), JSON.stringify({ ...descend, updatedAt: "2099-01-01T00:00:00.000Z" }));
    const changed = await (await get(createSyncHandler({ ...d, knowledge: knowledge([entry("2026-11-04T03:30:00.000Z")]).handle }), `kind=exploration&id=${DESC}`)).json();
    expect(changed).toMatchObject({ changedAt: "2099-01-01T00:00:00.000Z", wiki: { saved: true, stale: true }, graph: { saved: true, stale: true } });
    expect((await get(h0, "kind=paper&id=x")).status).toBe(400); expect((await get(h0, "kind=exploration")).status).toBe(400); expect((await get(h0, "kind=exploration&id=desc-20261104000000-cccc")).status).toBe(400); expect((await get(h0, "kind=exploration&id=../x")).status).toBe(400);
  });
  it("reports an unchanged item as already there", async () => {
    const d = await setup(), k = knowledge([], () => Response.json({ entry: { id: "same", status: "stored" }, duplicate: true })); expect(await (await post(createSyncHandler({ ...d, knowledge: k.handle }), { kind: "exploration", id: DESC, confirmed: true })).json()).toMatchObject({ duplicate: true, replaced: 0 });
  });
  it("needs the confirmation, refuses unfinished items, other origins and bad requests, and calls nothing", async () => {
    const d = await setup(), k = knowledge(), handle = createSyncHandler({ ...d, knowledge: k.handle });
    expect((await post(handle, { kind: "exploration", id: DESC })).status).toBe(400); expect((await post(handle, { kind: "exploration", id: DESC, confirmed: true }, "http://evil.example")).status).toBe(403);
    expect((await post(handle, { kind: "paper", id: DESC, confirmed: true })).status).toBe(400); expect((await post(handle, { kind: "exploration", id: "../x", confirmed: true })).status).toBe(400); expect((await post(handle, { kind: "exploration", id: DESC, confirmed: true, model: "gpt" })).status).toBe(400);
    const early = await setup("researching"), k2 = knowledge(), res = await post(createSyncHandler({ ...early, knowledge: k2.handle }), { kind: "exploration", id: DESC, confirmed: true }); expect(res.status).toBe(400); expect((await res.json()).error).toMatch(/no finished report/);
    expect(k.calls).toEqual([]); expect(k2.calls).toEqual([]);
    expect((await handle(new Request(`${origin}/api/graph-sync/nope`, { method: "POST", headers: { origin } }))).status).toBe(404);
  });
});
