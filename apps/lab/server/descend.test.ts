// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDescendHandler, createDescend, cutText, parsePlan, readDescend, renderReport, replicationLine, runDescend, searchCode, searchRepos, searchWorks, type DescendDeps } from "./descend";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const origin = "http://localhost:5173", RUN = "run-20261103071135-1dd1";
const run = (status: string) => ({ id: RUN, paperId: "paper-0001", title: "ACO study", mode: "muse", status, createdAt: "2026-11-03T07:11:35.000Z", updatedAt: "2026-11-03T08:00:00.000Z", model: "muse-wonder-1.0", rounds: { max: 4, used: 2 }, tokens: { cap: 1, used: 1 }, stages: [], assumptions: [], results: [{ id: "R1", description: "iterations", reported: "23", reproduced: "25", tolerance: 0.1, status: "within_tolerance", note: "" }] });
async function setup(status = "done") {
  const base = await mkdtemp(join(tmpdir(), "descend-")); dirs.push(base);
  const runsRoot = join(base, "runs"), root = join(base, "desc"); await mkdir(join(runsRoot, RUN), { recursive: true });
  await writeFile(join(runsRoot, RUN, "run.json"), JSON.stringify(run(status))); await writeFile(join(runsRoot, RUN, "report.md"), "# Report\nIterations 25 vs 23.");
  return { runsRoot, root };
}
const reply = (content: unknown, tokens = 100) => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { total_tokens: tokens } }));
function model(overrides: { failRole?: string } = {}) {
  const calls: string[] = [];
  const send = (async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body), system: string = body.messages[0].content; calls.push(system.slice(0, 40));
    if (system.includes("You coordinate")) return reply({ subquestions: [{ role: "feasibility", question: "Can it run on a real robot?", queries: ["ant colony optimization real robot deployment"], codeQueries: ["aco dynamic window tuning"] }, { role: "data", question: "What sensors?" }, { role: "feasibility", question: "duplicate role" }, { role: "magic", question: "bad role" }] });
    if (system.includes("look for open source code")) return reply({ queries: ["aco dwa ros"] });
    if (system.includes("merge subagent")) return reply({ verdict: "feasible_with_changes", summary: "Possible with sensing.", nextSteps: ["Build a field map"] });
    const role = /the (\w+) subagent/.exec(system)![1];
    if (role === overrides.failRole) return new Response("no", { status: 500 });
    return reply({ finding: `${role} answer`, evidence: ["R1 within tolerance"], assumptions: ["static terrain"], risks: ["noise"], confidence: "medium" });
  }) as unknown as typeof fetch;
  return { send, calls };
}
const work = { id: "https://openalex.org/W1", title: "Path planning by fusing ACO and dynamic window", publication_year: 2026, doi: "https://doi.org/10.1/x", cited_by_count: 3, abstract_inverted_index: { Robots: [0], plan: [1], paths: [2] } };
function search(overrides: { fail?: boolean; failHosts?: string[] } = {}) {
  const urls: string[] = [];
  const fetcher = (async (url: string) => {
    urls.push(url); const host = new URL(url).host;
    if (overrides.fail || overrides.failHosts?.includes(host)) return new Response("no", { status: 503 });
    if (host === "api.github.com") return Response.json({ items: [{ full_name: "me/aco-dwa", html_url: "https://github.com/me/aco-dwa", stargazers_count: 12, license: { spdx_id: "MIT" }, pushed_at: "2026-07-10T00:00:00Z", description: "ACO with DWA" }, { full_name: "evil/x", html_url: "javascript:alert(1)", stargazers_count: 1, license: null, pushed_at: "2026-01-01T00:00:00Z", description: "" }] });
    if (host === "api.stackexchange.com") return Response.json({ items: [{ title: "How to tune ACO &amp; DWA?", link: "https://stackoverflow.com/questions/123/tune", score: 5, is_answered: true }] });
    if (host === "hn.algolia.com") return Response.json({ hits: [{ objectID: "5460921", title: "Robotic ants", points: 7, num_comments: 2, created_at: "2013-03-29T00:00:00Z" }, { objectID: "x<script>", title: "bad id" }] });
    return Response.json({ results: [work, { ...work, title: "" }, { id: "https://openalex.org/W2", title: "No DOI paper", publication_year: null, doi: null, cited_by_count: 0, abstract_inverted_index: null }] });
  }) as unknown as typeof fetch;
  return { fetcher, urls };
}
const deps = (t: { runsRoot: string; root: string }, send: typeof fetch, found: typeof fetch = search().fetcher): DescendDeps => ({ ...t, key: "k", send, search: found });

describe("Descendance", () => {
  it("keeps at most one subagent per role and drops unknown roles", () => {
    expect(parsePlan({ subquestions: [{ role: "data", question: "a" }, { role: "data", question: "b" }, { role: "x", question: "c" }, { role: "risks", question: "" }] })).toEqual([{ role: "data", question: "a", queries: [], codeQueries: [] }]);
    expect(() => parsePlan({})).toThrow(/no usable/);
  });
  it("plans, runs the subagents and writes a labelled report", async () => {
    const t = await setup(), m = model(), d = deps(t, m.send);
    const record = await createDescend(d, { paperId: "paper-0001", goal: "Can ACO go from simulation to the real world?", model: "muse-wonder-1.0" });
    await runDescend(d, record.id, new AbortController().signal);
    const done = await readDescend(t.root, record.id);
    expect(done.status).toBe("done"); expect(done.verdict).toBe("feasible_with_changes"); expect(done.findings.map(f => f.role)).toEqual(["feasibility", "data"]);
    expect(done.findings.every(f => f.status === "done")).toBe(true); expect(done.tokens.used).toBe(500);
    expect(done.report).toContain("Feasible with changes"); expect(done.report).toContain("not a measurement"); expect(done.report).toContain("1. Build a field map");
    expect(m.calls).toHaveLength(5);
  });
  it("finishes with the subagents that worked and says which one failed", async () => {
    const t = await setup(), d = deps(t, model({ failRole: "data" }).send);
    const record = await createDescend(d, { paperId: "paper-0001", goal: "Can ACO go from simulation to the real world?", model: "muse-wonder-1.0" });
    await runDescend(d, record.id, new AbortController().signal);
    const done = await readDescend(t.root, record.id);
    expect(done.status).toBe("done"); expect(done.findings.map(f => f.status)).toEqual(["done", "failed"]); expect(done.report).toContain("did not finish");
  });
  it("stops at the token cap instead of spending more", async () => {
    const t = await setup(), d = deps(t, model().send);
    const record = await createDescend(d, { paperId: "paper-0001", goal: "Can ACO go from simulation to the real world?", model: "muse-wonder-1.0", tokenCap: 2500 });
    await runDescend(d, record.id, new AbortController().signal);
    const done = await readDescend(t.root, record.id);
    expect(done.status).toBe("failed"); expect(done.error).toMatch(/token cap/);
  });
  it("records a cancelled exploration", async () => {
    const t = await setup(), d = deps(t, model().send), controller = new AbortController(); controller.abort();
    const record = await createDescend(d, { paperId: "paper-0001", goal: "Can ACO go from simulation to the real world?", model: "muse-wonder-1.0" });
    await runDescend(d, record.id, controller.signal);
    expect((await readDescend(t.root, record.id)).status).toBe("cancelled");
  });
  it("only starts when the latest run of the paper is finished", async () => {
    const t = await setup("coding");
    await expect(createDescend(deps(t, model().send), { paperId: "paper-0001", goal: "Can ACO go from simulation to the real world?", model: "muse-wonder-1.0" })).rejects.toThrow(/latest run of this paper .* is coding/);
  });
  it("searches online for the questions that ask for it, gives the model only what came back, and lists the sources in the report", async () => {
    const t = await setup(), s2 = search(), seen: string[] = [], m = model();
    const d = deps(t, (async (u: unknown, init: { body: string }) => { seen.push(JSON.parse(init.body).messages[1].content); return (m.send as unknown as (u: unknown, i: unknown) => Promise<Response>)(u, init); }) as unknown as typeof fetch, s2.fetcher);
    const record = await createDescend(d, { paperId: "paper-0001", goal: "Can ACO go from simulation to the real world?", model: "muse-wonder-1.0" });
    await runDescend(d, record.id, new AbortController().signal);
    const done = await readDescend(t.root, record.id);
    expect(s2.urls.map(u => new URL(u).host)).toEqual(["api.openalex.org", "api.stackexchange.com", "hn.algolia.com", "api.github.com"]); expect(s2.urls[0]).toContain("search=ant%20colony%20optimization%20real%20robot%20deployment"); expect(s2.urls[1]).toContain("q=aco%20dynamic%20window%20tuning");
    expect(s2.urls[3]).toContain("q=aco%20dwa%20ros"); expect(s2.urls[3]).toContain("per_page=3"); // GitHub is searched once, at the end, with the query written from the findings
    expect(done.findings[0]!.sources.map(x => [x.kind, x.title])).toEqual([["paper", "Path planning by fusing ACO and dynamic window"], ["paper", "No DOI paper"], ["qa", "How to tune ACO & DWA?"], ["hn", "Robotic ants"]]); expect(done.repos).toEqual([expect.objectContaining({ kind: "repo", url: "https://github.com/me/aco-dwa", meta: "12 stars, licence MIT, last push 2026-07-10" })]); expect(done.scoutQueries).toEqual(["aco dwa ros"]); expect(done.findings[0]!.sources[3]).toMatchObject({ url: "https://news.ycombinator.com/item?id=5460921", meta: "7 points, 2 comments, 2013-03-29" }); expect(done.findings[0]!.sources[0]).toMatchObject({ url: "https://doi.org/10.1/x", snippet: "Robots plan paths", year: 2026 }); expect(done.findings[0]!.sources[1]!.url).toBe("https://openalex.org/W2");
    expect(seen.some(x => x.includes("SEARCH RESULTS") && x.includes("[1] (paper) Path planning by fusing ACO") && !x.includes("me/aco-dwa") && x.includes("(Hacker News discussion) Robotic ants"))).toBe(true); expect(seen.at(-1)).toContain("CODE LEADS"); expect(seen.at(-1)).toContain("[1] me/aco-dwa, 12 stars"); expect(seen[0]).not.toContain("SEARCH RESULTS");
    expect(done.report).toContain("Found online (leads only"); expect(done.report).toContain("Paper: [Path planning by fusing ACO and dynamic window](https://doi.org/10.1/x) (2026)"); expect(done.report).toContain("## Code to start from"); expect(done.report).toContain("Found by searching GitHub for: aco dwa ros"); expect(done.report).toContain("[me/aco-dwa](https://github.com/me/aco-dwa) (12 stars"); expect(done.report).toContain("Discussion: [Robotic ants]"); expect(done.report!.indexOf("## Code to start from")).toBeLessThan(done.report!.indexOf("## Next steps"));
  });
  it("carries on without sources when the online search fails, and does not search when switched off", async () => {
    const t = await setup(), bad = search({ fail: true }), d = deps(t, model().send, bad.fetcher);
    const a = await createDescend(d, { paperId: "paper-0001", goal: "Can ACO go from simulation to the real world?", model: "muse-wonder-1.0" });
    await runDescend(d, a.id, new AbortController().signal); const done = await readDescend(t.root, a.id);
    expect(done.status).toBe("done"); expect(done.findings[0]!.sources).toEqual([]); expect(done.findings[0]!.risks.join(" ")).toContain("search for papers was unavailable"); expect(done.findings[0]!.risks.join(" ")).toContain("technical answers and discussion was unavailable"); expect(done.repos).toEqual([]); expect(done.report).not.toContain("Code to start from");
    const off = search(), d2 = deps(t, model().send, off.fetcher), b = await createDescend(d2, { paperId: "paper-0001", goal: "Which sensors would the real robot need?", model: "muse-wonder-1.0", online: false });
    await runDescend(d2, b.id, new AbortController().signal); expect(off.urls).toHaveLength(0); expect((await readDescend(t.root, b.id)).online).toBe(false);
  });
  it("reads only the fields it needs from the search index and drops malformed entries", async () => {
    const odd = (async () => Response.json({ results: [{ id: "https://openalex.org/W9", title: "Odd", publication_year: "2020", doi: "javascript:alert(1)", cited_by_count: "many", abstract_inverted_index: { a: [0, 9999, -1, 1.5], b: ["x"] } }, null, { title: "no id" }] })) as unknown as typeof fetch;
    expect(await searchWorks(odd, ["q"], new AbortController().signal)).toEqual([{ kind: "paper", title: "Odd", year: null, url: "https://openalex.org/W9", cites: 0, snippet: "a" }]);
  });
  it("keeps the technical sources that answer when one is down, and refuses unsafe links and ids", async () => {
    const signal = new AbortController().signal;
    expect((await searchCode(search({ failHosts: ["api.stackexchange.com"] }).fetcher, "q", signal)).map(x => x.kind)).toEqual(["hn"]);
    const all = await searchCode(search().fetcher, "q", signal); expect(all.map(x => x.url)).toEqual(["https://stackoverflow.com/questions/123/tune", "https://news.ycombinator.com/item?id=5460921"]);
    await expect(searchCode(search({ fail: true }).fetcher, "q", signal)).rejects.toThrow(/Stack Overflow search failed.*Hacker News search failed/);
  });
  it("lists repositories with their licence and last push, drops unsafe links, and reports a failed search", async () => {
    const signal = new AbortController().signal, repos = await searchRepos(search().fetcher, "q", signal);
    expect(repos).toEqual([{ kind: "repo", title: "me/aco-dwa", year: 2026, url: "https://github.com/me/aco-dwa", cites: 12, snippet: "ACO with DWA", meta: "12 stars, licence MIT, last push 2026-07-10" }]);
    await expect(searchRepos(search({ fail: true }).fetcher, "q", signal)).rejects.toThrow(/GitHub search failed \(HTTP 503\)/);
  });
  it("cuts long text at a word and marks the cut, never in the middle of a word", () => {
    expect(cutText("short enough", 40)).toBe("short enough");
    const cut = cutText("Build and document an imagery pipeline that orthorectifies imagery to a coordinate reference system", 60); expect(cut.endsWith("…")).toBe(true); expect(cut.length).toBeLessThanOrEqual(60); expect(cut.slice(0, -1).split(" ").every(w => "Build and document an imagery pipeline that orthorectifies imagery to a coordinate reference system".split(" ").includes(w))).toBe(true);
    expect(cutText("x".repeat(100), 20)).toBe(`${"x".repeat(19)}…`); expect(cutText("one, two, three, four, five, six, seven", 18)).not.toMatch(/[,;:.]…$/);
  });
  it("lists a single star as a star", async () => {
    const one = (async () => Response.json({ items: [{ full_name: "a/b", html_url: "https://github.com/a/b", stargazers_count: 1, license: null, pushed_at: "2026-01-01T00:00:00Z", description: "" }] })) as unknown as typeof fetch;
    expect((await searchRepos(one, "q", new AbortController().signal))[0]!.meta).toBe("1 star, no licence stated, last push 2026-01-01");
  });
  it("tells every reader how far the run it builds on can be trusted", async () => {
    const t = await setup(), d = deps(t, model().send), record = await createDescend(d, { paperId: "paper-0001", goal: "Can ACO go from simulation to the real world?", model: "muse-wonder-1.0" });
    expect(record.replication).toMatchObject({ verified: 1, total: 1, coveragePercent: null }); expect(replicationLine(record.replication)).toContain("method coverage not assessed");
    const none = replicationLine({ rating: "Early attempt", verified: 0, total: 17, coveragePercent: 69 }); expect(none).toContain("treat the method as unverified"); expect(none).toContain("method coverage 69%");
    await runDescend(d, record.id, new AbortController().signal); expect((await readDescend(t.root, record.id)).report).toContain(`**Built on:** ${record.replication.rating}.`);
  });
  it("builds on the newest run of the paper and carries earlier conclusions forward", async () => {
    const t = await setup(); await mkdir(join(t.runsRoot, "run-20261104000000-aaaa"), { recursive: true });
    await writeFile(join(t.runsRoot, "run-20261104000000-aaaa", "run.json"), JSON.stringify({ ...run("done"), id: "run-20261104000000-aaaa", createdAt: "2026-11-04T00:00:00.000Z", title: "ACO study v2" }));
    const seen: string[] = [], first = model(), d = deps(t, (async (u: unknown, init: { body: string }) => { seen.push(JSON.parse(init.body).messages[1].content); return (first.send as unknown as (u: unknown, i: unknown) => Promise<Response>)(u, init); }) as unknown as typeof fetch);
    const a = await createDescend(d, { paperId: "paper-0001", goal: "Can ACO go from simulation to the real world?", model: "muse-wonder-1.0" });
    expect(a.runId).toBe("run-20261104000000-aaaa"); await runDescend(d, a.id, new AbortController().signal);
    expect(seen[0]).not.toContain("EARLIER EXPLORATIONS");
    const b = await createDescend(d, { paperId: "paper-0001", goal: "Which sensors would the real robot need?", model: "muse-wonder-1.0" });
    await runDescend(d, b.id, new AbortController().signal);
    expect(seen.at(-1)).toContain("EARLIER EXPLORATIONS"); expect(seen.at(-1)).toContain("Build a field map"); expect(seen.at(-1)).toContain("Verdict: feasible_with_changes");
  });
  it("serves the routes and refuses other origins and bad requests", async () => {
    const t = await setup(), handle = createDescendHandler("k", { ...t, send: model().send });
    const call = (path: string, body?: unknown, from = origin) => handle(new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: from, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    expect((await call("/api/descend/start", { paperId: "paper-0001", goal: "x long enough goal" }, "http://evil.example")).status).toBe(403);
    expect((await call("/api/descend/start", { paperId: "paper-0001", goal: "short" })).status).toBe(400);
    expect((await call("/api/descend/start", { paperId: "paper-0001", goal: "Can ACO go from simulation to the real world?", model: "gpt" })).status).toBe(400);
    const started = await call("/api/descend/start", { paperId: "paper-0001", goal: "Can ACO go from simulation to the real world?" }); expect(started.status).toBe(201);
    const { exploration } = await started.json();
    for (let i = 0; i < 300 && (await readDescend(t.root, exploration.id)).status !== "done"; i++) await new Promise(r => setTimeout(r, 50));
    const list = await (await call("/api/descend")).json(); expect(list.explorations[0].id).toBe(exploration.id); expect(list.explorations[0].report).toBeUndefined();
    expect((await (await call(`/api/descend/${exploration.id}`)).json()).exploration.status).toBe("done");
    expect((await call("/api/descend/desc-20261103000000-aaaa")).status).toBe(404);
  });
  it("renders a report without findings that failed", () => {
    expect(renderReport({ title: "T", goal: "G", verdict: "unclear", summary: "S", nextSteps: [], findings: [{ id: "F1", role: "risks", question: "Q", queries: [], codeQueries: [], sources: [], status: "failed", finding: "", evidence: [], assumptions: [], risks: [], confidence: "low", error: "boom" }] })).toContain("did not finish: boom");
  });
});
