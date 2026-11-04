// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWikiHandler, listWikiPages, pagePath, PAGE_PATH, readSaved, saveToWiki, type WikiDeps } from "./wiki";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const RUN = "run-20261104020213-fd1e", DESC = "desc-20261104100000-aaaa", WS = "ws-20261104110000-bbbb", origin = "http://localhost:5173";
const t0 = new Date("2026-11-04T04:00:00.000Z");
const run = (over: Record<string, unknown> = {}) => ({ id: RUN, paperId: "paper-0001", title: "Global and local path planning | ACO [study]", mode: "external", status: "done", createdAt: "2026-11-04T02:02:00.000Z", updatedAt: "2026-11-04T02:10:00.000Z", model: "m", rounds: { max: 0, used: 1 }, tokens: { cap: 1, used: 0 }, stages: [], assumptions: [], stepCount: 13, results: [{ id: "R1", description: "iterations | grid", reported: "23rd iteration", reproduced: "39.7", tolerance: 0.1, status: "not_comparable", note: "" }, { id: "R13", description: "x", reported: "69", reproduced: "", tolerance: 0.1, status: "not_run", note: "" }], review: "[high] R1 is simplified.", environments: [{ id: "env-1", name: "ACO corrected markers simple 24x24", status: "approved" }], ...over });
const descend = (over: Record<string, unknown> = {}) => ({ id: DESC, runId: RUN, paperId: "paper-0001", title: "Global and local path planning", goal: "Can ACO go to the real world?", model: "m", status: "done", online: true, repos: [], scoutQueries: [], replication: { rating: "Early attempt", verified: 0, total: 17, coveragePercent: 69 }, tokens: { used: 1, cap: 2 }, findings: [], verdict: "feasible_with_changes", report: "# Feasibility study: ACO\n\n**Goal:** g\n\nPossible with sensing.\n", nextSteps: [], events: [], createdAt: "2026-11-04T03:00:00.000Z", updatedAt: "2026-11-04T03:00:00.000Z", ...over });
const workshop = (over: Record<string, unknown> = {}) => ({ id: WS, descendId: DESC, paperId: "paper-0001", title: "Global and local path planning", goal: "Can ACO go to the real world?", model: "m", status: "ready", createdAt: "2026-11-04T03:30:00.000Z", updatedAt: "2026-11-04T03:30:00.000Z", replication: { rating: "Early attempt", verified: 0, total: 17, coveragePercent: 69 }, summary: "s", report: "r", nextSteps: [], repos: [], hypotheses: [{ id: "H1", statement: "The planner copes with noise", test: "Add noise", success: ">80% supports", status: "refuted", evidence: ["E1"] }, { id: "H2", statement: "A map can be digitised", test: "", success: "", status: "untested", evidence: [] }], experiments: [{ id: "E1", hypothesisId: "H1", summary: "30 missions, 10% noise", metric: "completion", value: "9/30", by: "agent", at: "2026-11-04T03:40:00.000Z" }], log: [{ at: "2026-11-04T03:31:00.000Z", by: "agent", message: "Started the noise test" }], ...over });
async function setup(over: { run?: Record<string, unknown>; descend?: Record<string, unknown>; workshop?: Record<string, unknown> } = {}) {
  const base = await mkdtemp(join(tmpdir(), "wiki-")); dirs.push(base);
  const deps: WikiDeps = { root: join(base, "wiki"), runsRoot: join(base, "runs"), descendRoot: join(base, "desc"), workshopRoot: join(base, "ws"), now: () => t0 };
  await mkdir(join(deps.runsRoot, RUN), { recursive: true }); await writeFile(join(deps.runsRoot, RUN, "run.json"), JSON.stringify(run(over.run))); await writeFile(join(deps.runsRoot, RUN, "report.md"), "# PaperRun report: ACO\n\nIt did not match.\n");
  await mkdir(join(deps.descendRoot, DESC), { recursive: true }); await writeFile(join(deps.descendRoot, DESC, "descend.json"), JSON.stringify(descend(over.descend)));
  await mkdir(join(deps.workshopRoot, WS), { recursive: true }); await writeFile(join(deps.workshopRoot, WS, "workshop.json"), JSON.stringify(workshop(over.workshop)));
  return deps;
}
const read = (deps: WikiDeps, path: string) => readFile(join(deps.root, path), "utf8");

describe("wiki", () => {
  it("writes nothing until an item is saved, and only the saved item's pages afterwards", async () => {
    const d = await setup(); expect(await readdir(d.root).catch(() => [])).toEqual([]); expect(await readSaved(d.root)).toEqual([]);
    const out = await saveToWiki(d, "exploration", DESC);
    expect(out).toMatchObject({ folder: d.root, action: "saved", pages: ["explorations/" + DESC + ".md", "index.md", "papers/paper-0001.md"] });
    expect(await readdir(join(d.root))).not.toContain("workshops"); expect(await readdir(join(d.root))).not.toContain("replications");
  });
  it("labels every page with the baseline and says what was not checked", async () => {
    const d = await setup(); await saveToWiki(d, "replication", RUN); await saveToWiki(d, "exploration", DESC); await saveToWiki(d, "workshop", WS);
    for (const path of [pagePath("replication", RUN), pagePath("exploration", DESC), pagePath("workshop", WS)]) { const text = await read(d, path); expect(text).toContain("baseline: "); expect(text).toMatch(/treat the method as unverified/i); }
    const w = await read(d, pagePath("workshop", WS)); expect(w).toContain("### H1 (refuted): The planner copes with noise"); expect(w).toContain("Evidence: E1"); expect(w).toContain("No experiment recorded, so this is not a finding."); expect(w).toContain("have not been checked here"); expect(w).toContain("agent (reported)"); expect(w).toContain("completion: 9/30");
    expect(await read(d, pagePath("exploration", DESC))).toContain("None of it was run here."); expect(await read(d, pagePath("exploration", DESC))).toContain("## Feasibility study: ACO");
    const r = await read(d, pagePath("replication", RUN)); expect(r).toContain("| R1 | iterations / grid | 23rd iteration | 39.7 | not comparable |"); expect(r).toContain("Maps used:"); expect(r).toContain("- [high] R1 is simplified."); expect(r).toContain("### PaperRun report: ACO"); expect(r).toContain("# Replication (agent run 2026-11-04 02:02): Global and local path planning | ACO study"); expect(r).not.toContain("[study]");
  });
  it("links the pages to each other with relative links, and lists them on the paper page and the index", async () => {
    const d = await setup(); await saveToWiki(d, "replication", RUN); await saveToWiki(d, "exploration", DESC); await saveToWiki(d, "workshop", WS);
    expect(await read(d, pagePath("workshop", WS))).toContain(`(../explorations/${DESC}.md)`); expect(await read(d, pagePath("workshop", WS))).toContain("(../papers/paper-0001.md)"); expect(await read(d, pagePath("exploration", DESC))).toContain(`(../replications/${RUN}.md)`);
    const paper = await read(d, "papers/paper-0001.md"); expect(paper).toContain(`(../replications/${RUN}.md)`); expect(paper).toContain(`(../workshops/${WS}.md)`); expect(paper).toContain("## Explorations");
    const index = await read(d, "index.md"); expect(index).toContain("(papers/paper-0001.md): 1 replication(s), 1 exploration(s), 1 workshop(s)"); expect(index).toContain("(log.md)");
  });
  it("keeps the log append-only and refreshes a page when the item is saved again", async () => {
    const d = await setup(); await saveToWiki(d, "exploration", DESC);
    const { updateWorkshop } = await import("./workshop"); void updateWorkshop; await writeFile(join(d.descendRoot, DESC, "descend.json"), JSON.stringify(descend({ report: "# Feasibility study: ACO\n\nA changed conclusion.\n" })));
    const again = await saveToWiki(d, "exploration", DESC); expect(again.action).toBe("refreshed"); expect(await read(d, pagePath("exploration", DESC))).toContain("A changed conclusion.");
    await saveToWiki(d, "workshop", WS);
    expect(await read(d, "log.md")).toBe(`# Log\n\nWhat was saved to this wiki, oldest first. Lines are only ever added.\n\n- 2026-11-04 04:00 saved exploration ${DESC}\n- 2026-11-04 04:00 refreshed exploration ${DESC}\n- 2026-11-04 04:00 saved workshop ${WS}\n`);
    expect((await readSaved(d.root)).map(s => [s.kind, s.id, s.savedAt])).toEqual([["exploration", DESC, t0.toISOString()], ["workshop", WS, t0.toISOString()]]);
  });
  it("refuses unfinished items and leaves the wiki untouched", async () => {
    const early = await setup({ run: { status: "waiting_external" }, descend: { status: "researching" }, workshop: { status: "preparing" } });
    await expect(saveToWiki(early, "replication", RUN)).rejects.toThrow(/Finish the run/); await expect(saveToWiki(early, "exploration", DESC)).rejects.toThrow(/no finished report/); await expect(saveToWiki(early, "workshop", WS)).rejects.toThrow(/not ready/);
    expect(await readdir(early.root).catch(() => [])).toEqual([]);
    const d = await setup(); await expect(saveToWiki(d, "exploration", "desc-20261104000000-cccc")).rejects.toThrow(); expect(await readSaved(d.root)).toEqual([]);
  });
  it("rejects ids that could reach outside the wiki folder", async () => {
    const d = await setup(); for (const id of ["../x", "desc-1", "", "desc-20261104100000-aaaa/../../x"]) await expect(saveToWiki(d, "exploration", id)).rejects.toThrow(/Invalid id/);
    await expect(saveToWiki(d, "paper" as never, "x")).rejects.toThrow(); expect(() => pagePath("workshop", "../../etc")).toThrow();
  });
  it("serves the routes and refuses other origins and bad requests", async () => {
    const d = await setup(), handle = createWikiHandler({ root: d.root, runsRoot: d.runsRoot, descendRoot: d.descendRoot, workshopRoot: d.workshopRoot, now: d.now });
    const call = (path: string, body?: unknown, from = origin) => handle(new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: from, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    expect((await call("/api/wiki/save", { kind: "exploration", id: DESC }, "http://evil.example")).status).toBe(403); expect((await call("/api/wiki/save", { kind: "paper", id: DESC })).status).toBe(400); expect((await call("/api/wiki/save", { kind: "exploration", id: "../x" })).status).toBe(400);
    const saved = await call("/api/wiki/save", { kind: "workshop", id: WS }); expect(saved.status).toBe(200); expect(await saved.json()).toMatchObject({ folder: d.root, action: "saved" });
    expect(await (await call("/api/wiki")).json()).toEqual({ folder: d.root, saved: [{ kind: "workshop", id: WS, savedAt: t0.toISOString() }] }); expect((await call("/api/wiki/nope")).status).toBe(404);
  });
  it("lists the pages by group with their headings, and reads one", async () => {
    const d = await setup(); expect(await listWikiPages(d.root)).toEqual([]);
    await saveToWiki(d, "replication", RUN); await saveToWiki(d, "exploration", DESC); await saveToWiki(d, "workshop", WS);
    const pages = await listWikiPages(d.root); expect(pages.map(p => [p.group, p.path])).toEqual([["overview", "index.md"], ["overview", "log.md"], ["papers", "papers/paper-0001.md"], ["replications", `replications/${RUN}.md`], ["explorations", `explorations/${DESC}.md`], ["workshops", `workshops/${WS}.md`]]);
    expect(pages[0]!.title).toBe("Wiki"); expect(pages.find(p => p.group === "workshops")!.title).toBe("Workshop: Can ACO go to the real world?"); expect(pages.find(p => p.group === "replications")!.title).toBe("Replication (agent run 2026-11-04 02:02): Global and local path planning | ACO study");
    const handle = createWikiHandler({ root: d.root, runsRoot: d.runsRoot, descendRoot: d.descendRoot, workshopRoot: d.workshopRoot }), get = (path: string) => handle(new Request(`${origin}${path}`));
    expect((await (await get("/api/wiki/pages")).json()).pages).toHaveLength(6); const page = await (await get(`/api/wiki/page?path=${encodeURIComponent(`workshops/${WS}.md`)}`)).json(); expect(page.content).toContain("## Hypotheses");
  });
  it("lets the app read only the wiki's own pages, never another file", async () => {
    const d = await setup(); await saveToWiki(d, "exploration", DESC); await writeFile(join(d.root, "secret.md"), "secret"); await writeFile(join(d.root, "papers", "notes.txt"), "x");
    const handle = createWikiHandler({ root: d.root, runsRoot: d.runsRoot, descendRoot: d.descendRoot, workshopRoot: d.workshopRoot }), get = (path: string) => handle(new Request(`${origin}/api/wiki/page?path=${encodeURIComponent(path)}`));
    for (const bad of ["../x.md", "papers/../../x.md", "secret.md", ".saved.json", "papers/notes.txt", "/etc/hosts", "papers/a.md/..", "papers/a b.md", "", "papers/.md"]) expect((await get(bad)).status, bad).toBe(400);
    expect((await get("papers/missing.md")).status).toBe(404); expect((await get("index.md")).status).toBe(200); expect(PAGE_PATH.test("replications/run-1.md")).toBe(true);
    expect((await listWikiPages(d.root)).some(p => p.path === "secret.md" || p.path.endsWith("notes.txt"))).toBe(false);
  });
});
