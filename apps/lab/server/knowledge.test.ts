// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKnowledgeHandler, paperUrl } from "./knowledge";
import { entryDirectory, graphifyEnvironment, type ProcessResult, type ProcessRunner } from "./knowledgeGraphify";
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const paper = "Study\nAbstract\nSAM produces canopy masks.\nIntroduction\nReferences";
const extraction = { nodes: [{ id: "sam", label: "SAM", type: "method", description: "Segmentation" }, { id: "mask", label: "Mask", type: "result", description: "Canopy mask" }], edges: [{ source: "sam", target: "mask", relation: "produces", quote: "SAM produces canopy masks.", section: "Abstract" }] };
const request = (path: string, value: unknown, method = "POST", origin = "http://localhost:5173") => new Request(`http://localhost:5173/api/knowledge${path}`, { method, headers: { origin, "sec-fetch-site": "same-origin", "Content-Type": "application/json" }, body: JSON.stringify(value) });
const classification = { type: "method", title: "Canopy masks with SAM", year: 2025 };
const ingest = { confirmed: true, model: "muse-spark-1.3", title: "Canopy study", text: paper };
async function fixture(key = "fixture-secret", timeoutMs?: number) {
  const base = await mkdtemp(join(tmpdir(), "knowledge-test-")); directories.push(base); const root = join(base, "knowledge");
  let query: ProcessResult | null = null;
  const runner = vi.fn<ProcessRunner>().mockImplementation(async (_bin, args, cwd) => {
    if (args[0] === "--version") return { code: 0, stdout: "graphify 0.9.101\n", stderr: "" };
    if (args[0] === "query") { if (query) return query; const graph = JSON.parse(await readFile(args[args.indexOf("--graph") + 1]!, "utf8")); return { code: 0, stderr: "", stdout: graph.nodes.map((n: { label: string; source_file: string }) => `NODE ${n.label} [src=${n.source_file} loc=]`).join("\n") }; }
    if (args[0] === "merge-graphs") { const graphs = await Promise.all(args.slice(1, args.indexOf("--out")).map(async p => JSON.parse(await readFile(p, "utf8")))); await writeFile(args.at(-1)!, JSON.stringify({ ...graphs[0], nodes: graphs.flatMap(g => g.nodes), links: graphs.flatMap(g => g.links) })); }
    if (args[0] === "export") await writeFile(join(cwd, "graphify-out/graph.html"), "<html>graph</html>");
    return { code: 0, stdout: "ok", stderr: "" };
  });
  const send = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => { const system = JSON.parse(init!.body as string).messages[0].content as string; return Response.json({ model: "muse-spark-1.3", id: "response-a", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(system.startsWith("Identify this research paper") ? classification : extraction) } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }); });
  return { root, runner, send, setQuery: (v: ProcessResult) => { query = v; }, handle: createKnowledgeHandler(key, { root, runner, fetch: send, timeoutMs }) };
}
it("requires explicit confirmation, rejects wrong origins and stores nothing on rejected requests", async () => {
  const f = await fixture();
  expect((await f.handle(request("/ingest", { ...ingest, confirmed: false }))).status).toBe(400);
  expect((await f.handle(request("/ingest", ingest, "POST", "https://other.example"))).status).toBe(403);
  expect(f.send).not.toHaveBeenCalled(); await expect(access(f.root)).rejects.toThrow();
});
it("uses only Muse, persists its real usage, writes Graphify schema, merges and deduplicates by hash", async () => {
  const f = await fixture(); const response = await f.handle(request("/ingest", ingest)); const body = await response.json();
  expect(response.status).toBe(200); expect(body.entry).toMatchObject({ status: "stored", models: ["muse-spark-1.3"], paperType: "method", year: 2025, title: "Canopy masks with SAM", usage: [{ step: "paper identification" }, { usage: { total_tokens: 30 } }] });
  const graph = JSON.parse(await readFile(join(f.root, body.entry.id, "graphify-out/graph.json"), "utf8"));
  expect(graph.graph).toEqual({ schema_version: 1, graphify_version: "0.9.101" }); expect(graph.links[0].confidence).toBe("EXTRACTED"); expect(graph.nodes[0]).toMatchObject({ paper_type: "method", year: 2025 });
  expect(f.runner.mock.calls.some(c => c[1][0] === "merge-graphs")).toBe(true);
  for (const call of f.runner.mock.calls.filter(c => c[1][0] !== "--version")) expect(call[2]).toContain(f.root);
  expect(f.send.mock.calls[0]![0]).toBe("https://api.meta.ai/v1/chat/completions");
  expect(JSON.parse(f.send.mock.calls[0]![1]!.body as string)).toMatchObject({ model: "muse-spark-1.3", store: false, response_format: { type: "json_object" } });
  const again = await (await f.handle(request("/ingest", ingest))).json(); expect(again.duplicate).toBe(true); expect(f.send).toHaveBeenCalledTimes(2);
  const query = await (await f.handle(request("/query", { question: "SAM" }))).json(); expect(query).toMatchObject({ status: "answer", facts: [{ paper: "Canopy masks with SAM", classification: "EXTRACTED", quote: "SAM produces canopy masks." }] });
  expect(JSON.stringify(body)).not.toContain("fixture-secret");
});
it("maps Graphify ambiguity and no-match exit codes without a silent fallback", async () => {
  const f = await fixture(); await f.handle(request("/ingest", ingest));
  f.setQuery({ code: 3, stdout: "Ambiguous: SAM\n- SAM method\n- SAM dataset", stderr: "" });
  expect(await (await f.handle(request("/query", { question: "SAM" }))).json()).toMatchObject({ status: "ambiguous", candidates: expect.any(Array), facts: [] });
  f.setQuery({ code: 4, stdout: "No match", stderr: "" });
  expect(await (await f.handle(request("/query", { question: "Missing" }))).json()).toMatchObject({ status: "no_match", message: "not in the knowledge base" });
  f.setQuery({ code: 7, stdout: "", stderr: "real process error fixture-secret" });
  const failed = await f.handle(request("/query", { question: "SAM" })); expect(failed.status).toBe(502); expect(await failed.json()).toMatchObject({ exitCode: 7, stderr: "real process error [redacted]" });
});
it("confines entry paths, validates IDs and allowlists every URL redirect", async () => {
  const f = await fixture();
  for (const id of ["../escape", "ABC12345", "a", "merged/escape"]) expect(() => entryDirectory(f.root, id)).toThrow();
  for (const url of ["http://arxiv.org/pdf/2601.12345", "https://arxiv.org.evil/pdf/a", "https://doi.org@evil.example/a", "https://arxiv.org:8443/pdf/a", "https://127.0.0.1/paper.pdf"]) expect(() => paperUrl(url)).toThrow();
  expect(paperUrl("https://arxiv.org/abs/2601.12345").pathname).toBe("/pdf/2601.12345");
  f.send.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/paper.pdf" } }));
  const response = await f.handle(request("/ingest", { confirmed: true, model: "muse-spark-1.3", url: "https://doi.org/10.1234/paper" }));
  expect(response.status).toBe(400); expect(f.send).toHaveBeenCalledTimes(1); await expect(access(f.root)).rejects.toThrow();
  expect((await f.handle(request("/../../escape", { confirmed: true }, "DELETE"))).status).toBe(400);
});
it("reports missing key, missing Graphify and incompatible versions before any paper is stored", async () => {
  const noKey = await fixture(""); expect(await (await noKey.handle(request("/ingest", ingest))).json()).toMatchObject({ error: "Configure MODEL_API_KEY and restart the app." }); expect(noKey.send).not.toHaveBeenCalled();
  const base = await mkdtemp(join(tmpdir(), "knowledge-missing-")); directories.push(base);
  const runner = vi.fn<ProcessRunner>().mockRejectedValue(Object.assign(Error("missing"), { code: "ENOENT" }));
  const handler = createKnowledgeHandler("fixture", { root: join(base, "knowledge"), runner });
  expect(await (await handler(request("/ingest", ingest))).json()).toMatchObject({ error: expect.stringContaining("graphify not found") });
  const version = createKnowledgeHandler("fixture", { root: join(base, "other"), runner: async () => ({ code: 0, stdout: "graphify 99.0.0", stderr: "" }) });
  expect(await (await version(request("/ingest", ingest))).json()).toMatchObject({ error: expect.stringContaining("0.9.101 is required") });
});
it("permits only one job and aborts on the hard timeout", async () => {
  const f = await fixture("fixture", 40);
  f.send.mockImplementation(async (_url, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener("abort", () => reject(Error("aborted")), { once: true }); }));
  const pending = f.handle(request("/ingest", ingest));
  await new Promise(resolve => setTimeout(resolve, 10));
  expect((await f.handle(request("/ingest", ingest))).status).toBe(409);
  const response = await pending; expect(response.status).toBe(499); expect(await response.json()).toMatchObject({ error: expect.stringContaining("timed out") });
});
it("requires deletion confirmation and rebuilds the merged graph after deleting a paper", async () => {
  const f = await fixture(); const { entry } = await (await f.handle(request("/ingest", ingest))).json();
  expect((await f.handle(request(`/${entry.id}`, { confirmed: false }, "DELETE"))).status).toBe(400);
  expect((await f.handle(request(`/${entry.id}`, { confirmed: true }, "DELETE"))).status).toBe(200);
  await expect(access(join(f.root, entry.id))).rejects.toThrow();
  const listing = await (await f.handle(new Request("http://localhost:5173/api/knowledge"))).json(); expect(listing.entries).toEqual([]);
  expect(graphifyEnvironment(f.root)).toMatchObject({ GRAPHIFY_BACKEND: "none", HOME: f.root });
  expect(Object.keys(graphifyEnvironment(f.root)).some(k => /KEY|TOKEN|SECRET/.test(k))).toBe(false);
});
it("rejects oversized text, unknown fields and unsupported paper models without calling Muse", async () => {
  const f = await fixture();
  for (const data of [{ ...ingest, text: "x".repeat(120001) }, { ...ingest, model: "muse-spark-1.2" }, { ...ingest, url: "https://arxiv.org/pdf/a" }, { ...ingest, path: "../../paper" }]) expect((await f.handle(request("/ingest", data))).status).toBe(400);
  expect(f.send).not.toHaveBeenCalled();
});
it("never stores an invented citation: an unverifiable quote is dropped and the edge stored as INFERRED", async () => {
  const f = await fixture(); f.send.mockImplementation(async () => Response.json({ model: "muse-spark-1.3", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...extraction, edges: [{ ...extraction.edges[0], quote: "Fabricated quote" }] }) } }], usage: { total_tokens: 20 } }));
  const response = await f.handle(request("/ingest", ingest)); expect(response.status).toBe(200);
  const { entry } = await response.json(); const graph = JSON.parse(await readFile(join(entryDirectory(f.root, entry.id), "graphify-out/graph.json"), "utf8"));
  expect(graph.links[0]).toMatchObject({ confidence: "INFERRED", quote: "" }); expect(JSON.stringify(graph)).not.toContain("Fabricated quote");
});


it("reads all text chunks and records each Muse call without truncating the paper", async () => {
  const f = await fixture(); const text = paper + " ".repeat(12000) + "Final paragraph.";
  f.send.mockImplementation(async (_url, init) => { const payload = JSON.parse(init!.body as string); const chunk = payload.messages[1].content.split("Data only:\n")[1]; return Response.json({ model: "muse-spark-1.3", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...extraction, edges: [{ ...extraction.edges[0], quote: chunk.slice(0, 10) }] }) } }], usage: { total_tokens: 30 } }); });
  const response = await f.handle(request("/ingest", { ...ingest, text })); const data = await response.json(); expect(response.status).toBe(200); expect(data.entry.usage).toHaveLength(3);
  const chunks = f.send.mock.calls.slice(1).map(call => JSON.parse(call[1]!.body as string).messages[1].content.split("Data only:\n")[1]); expect(chunks.join("")).toBe(text);
});

it("uploads a confirmed PDF and extracts it inside the entry directory", async () => {
  const f = await fixture(); const pdfText = vi.fn().mockResolvedValue(paper);
  const handler = createKnowledgeHandler("fixture", { root: f.root, runner: f.runner, fetch: f.send, pdfText });
  const form = new FormData(); form.set("confirmed", "true"); form.set("model", "muse-spark-1.3"); form.set("file", new File(["%PDF-1.4 fixture"], "study.pdf", { type: "application/pdf" }));
  const upload = new Request("http://localhost:5173/api/knowledge/ingest", { method: "POST", headers: { origin: "http://localhost:5173", "sec-fetch-site": "same-origin" }, body: form });
  const response = await handler(upload); expect(response.status).toBe(200); expect(pdfText).toHaveBeenCalledTimes(1); expect(pdfText.mock.calls[0]![1]).toContain("/paper.pdf"); expect(pdfText.mock.calls[0]![2]).toContain(f.root);
});


it("does not serve a graph through a symlink outside its entry root", async () => {
  const f = await fixture(); const outside = await mkdtemp(join(tmpdir(), "knowledge-outside-")); directories.push(outside);
  await mkdir(join(outside, "graphify-out")); await writeFile(join(outside, "graphify-out/graph.html"), "private external content"); await mkdir(f.root, { recursive: true }); await symlink(outside, join(f.root, "escape-1234"));
  const response = await f.handle(new Request("http://localhost:5173/api/knowledge/escape-1234/graph.html")); expect(response.status).toBe(404); expect(await response.text()).not.toContain("private external");
});
it("reads a PDF's text for chat without storing anything, and cleans up", async () => {
  const base = await mkdtemp(join(tmpdir(), "knowledge-read-")); directories.push(base); const root = join(base, "knowledge");
  const pdfText = vi.fn().mockResolvedValue("Abstract ".concat("x".repeat(30000)));
  const handle = createKnowledgeHandler("fixture", { root, pdfText, fetch: vi.fn<typeof fetch>() });
  const post = (file: File | string, origin = "http://localhost:5173") => { const form = new FormData(); form.set("file", file); return handle(new Request("http://localhost:5173/api/knowledge/read-pdf", { method: "POST", headers: { origin, "sec-fetch-site": "same-origin" }, body: form })); };
  const ok = await (await post(new File(["%PDF-1.7 body"], "p.pdf", { type: "application/pdf" }))).json();
  expect(ok).toMatchObject({ truncated: true, chars: 30009 }); expect(ok.text).toHaveLength(22000);
  expect((await handle(new Request("http://localhost:5173/api/knowledge"))).status).toBe(200);
  const entries = await (await handle(new Request("http://localhost:5173/api/knowledge"))).json(); expect(entries.entries).toEqual([]);
  await expect(access(join(root, "index.json"))).rejects.toThrow();
  const { readdir } = await import("node:fs/promises"); expect((await readdir(root)).filter(n => n.startsWith(".read-"))).toEqual([]);
  expect((await post(new File(["not a pdf"], "p.pdf", { type: "application/pdf" }))).status).toBe(400);
  expect((await post(new File(["%PDF-1.7"], "p.txt", { type: "text/plain" }))).status).toBe(400);
  expect((await post(new File(["%PDF-1.7"], "p.pdf", { type: "application/pdf" }), "https://other.site")).status).toBe(403);
  expect(pdfText).toHaveBeenCalledTimes(1);
});
it("reports ingest progress by stage and chunk, then goes idle", async () => {
  const f = await fixture(); const seen: { running: boolean; stage: string; percent: number }[] = [];
  const long = `Study title\nAbstract\n${"SAM produces canopy masks. ".repeat(1200)}\nIntroduction\nReferences`;
  const send = vi.fn<typeof fetch>().mockImplementation(async () => { seen.push(await (await handle(new Request("http://localhost:5173/api/knowledge/progress"))).json()); return Response.json({ model: "muse-spark-1.3", id: "r", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ nodes: [], edges: [] }) } }], usage: { total_tokens: 30 } }); });
  const handle: ReturnType<typeof createKnowledgeHandler> = createKnowledgeHandler("fixture", { root: f.root, runner: f.runner, fetch: send });
  expect((await (await handle(new Request("http://localhost:5173/api/knowledge/progress"))).json())).toMatchObject({ running: false, stage: "idle", percent: 0 });
  await handle(request("/ingest", { confirmed: true, model: "muse-spark-1.3", title: "T", text: long }));
  expect(seen.length).toBeGreaterThan(1); expect(seen[0]).toMatchObject({ running: true, stage: "Identifying the paper" }); expect(seen.slice(1).every(s => s.running && s.stage.startsWith("Reading the "))).toBe(true);
  expect(seen.map(s => s.percent)).toEqual([...seen.map(s => s.percent)].sort((a, b) => a - b)); expect(seen[1]!.percent).toBeGreaterThanOrEqual(6);
  expect(await (await handle(new Request("http://localhost:5173/api/knowledge/progress"))).json()).toMatchObject({ running: false });
});

it("reads exact passages from a stored paper, reports ambiguity and misses, and refuses other origins and extra fields", async () => {
  const f = await fixture(); const text = `Canopy study\nAbstract\n${"filler line about nothing\n".repeat(80)}3 Experiments\nWe set alpha = 1.0 and beta = 5.0.\nReferences`;
  const stored = await (await f.handle(request("/ingest", { ...ingest, text }))).json(); expect(stored.entry.status).toBe("stored");
  const read = (value: unknown, origin?: string) => f.handle(request("/read", value, "POST", origin));
  const hit = await (await read({ paper: "canopy masks", query: "Experiments alpha beta" })).json();
  expect(hit).toMatchObject({ status: "passages", paper: { id: stored.entry.id, title: "Canopy masks with SAM", paperType: "method" } });
  expect(hit.passages[0].text).toContain("alpha = 1.0 and beta = 5.0"); expect(text.slice(hit.passages[0].from, hit.passages[0].to)).toBe(hit.passages[0].text);
  expect(await (await read({ paper: "no such paper", query: "alpha" })).json()).toMatchObject({ status: "not_found", papers: [{ title: "Canopy masks with SAM" }] });
  expect(await (await read({ paper: "canopy", query: "zebra quantum" })).json()).toMatchObject({ status: "no_match" });
  expect((await read({ paper: "canopy", query: "alpha", extra: 1 })).status).toBe(400);
  expect((await read({ paper: "canopy", query: "alpha", maxChars: 10 })).status).toBe(400);
  expect((await read({ paper: "canopy", query: "alpha" }, "https://other.site")).status).toBe(403);
});
it("tags papers with collections and scopes queries and reads to a collection", async () => {
  const f = await fixture();
  const a = (await (await f.handle(request("/ingest", { ...ingest, text: paper, collections: ["Canopy review", "canopy REVIEW", "Repro"] }))).json()).entry;
  expect(a.collections).toEqual(["Canopy review", "Repro"]);
  const other = `Other study\nAbstract\nNothing about masks here at all.\nIntroduction\nReferences`;
  const b = (await (await f.handle(request("/ingest", { ...ingest, title: "Other", text: other }))).json()).entry; expect(b.collections).toBeUndefined();
  const tag = (value: unknown) => f.handle(request("/collections", value));
  expect((await (await tag({ id: b.id, collections: [" Repro "] })).json()).entry.collections).toEqual(["Repro"]);
  expect((await tag({ id: "unknown-paper-id", collections: [] })).status).toBe(404);
  expect((await tag({ id: b.id, collections: ["x".repeat(61)] })).status).toBe(400);
  expect((await tag({ id: b.id, collections: ["ok"], extra: 1 })).status).toBe(400);
  expect((await tag({ id: "merged-graph", collections: [] })).status).toBe(400);
  expect((await (await f.handle(new Request("http://localhost:5173/api/knowledge"))).json()).entries.map((e: { collections?: string[] }) => e.collections)).toEqual([["Canopy review", "Repro"], ["Repro"]]);
  const scoped = await (await f.handle(request("/query", { question: "SAM", collection: "canopy review" }))).json();
  expect(scoped.status).toBe("answer"); expect(scoped.facts.every((x: { entryId: string }) => x.entryId === a.id)).toBe(true);
  const missing = await (await f.handle(request("/query", { question: "SAM", collection: "Nope" }))).json();
  expect(missing).toMatchObject({ status: "no_match", collections: ["Canopy review", "Repro"], facts: [] }); expect(missing.message).toContain("Nope");
  expect((await (await f.handle(request("/read", { paper: "canopy masks", query: "masks", collection: "repro" }))).json()).status).toBe("ambiguous");
  expect((await (await f.handle(request("/read", { paper: "canopy masks", query: "masks", collection: "Canopy review" }))).json()).paper.id).toBe(a.id);
  const again = await (await f.handle(request("/ingest", { ...ingest, text: paper, collections: ["New one"] }))).json();
  expect(again).toMatchObject({ duplicate: true, entry: { id: a.id, collections: ["Canopy review", "Repro", "New one"] } });
});

it("returns a read-only literature-review overview for all papers or one collection", async () => {
  const f = await fixture();
  const a = (await (await f.handle(request("/ingest", { ...ingest, text: paper, collections: ["Review A"] }))).json()).entry;
  const other = `Other study\nAbstract\nOther methods.\nIntroduction\nReferences`;
  await f.handle(request("/ingest", { ...ingest, title: "Other", text: other }));
  const overview = (value: unknown, origin?: string) => f.handle(request("/overview", value, "POST", origin));
  const all = await (await overview({})).json(); expect(all.status).toBe("overview"); expect(all.papers).toHaveLength(2); expect(all.papers[0]).toMatchObject({ paperType: "method", year: 2025 });
  expect(all.note).toContain("not the full papers");
  const scoped = await (await overview({ collection: "review a" })).json(); expect(scoped.papers.map((p: { id: string }) => p.id)).toEqual([a.id]); expect(scoped.collection).toBe("review a");
  expect(await (await overview({ collection: "Nope" })).json()).toMatchObject({ status: "no_match", collections: ["Review A"] });
  expect((await overview({ collection: "x", extra: 1 })).status).toBe(400);
  expect((await overview({}, "https://other.site")).status).toBe(403);
  expect((await (await f.handle(new Request("http://localhost:5173/api/knowledge"))).json()).entries).toHaveLength(2);
});

it("transcribes one PDF page with a vision model, caches it, and reports a missing renderer", async () => {
  const f = await fixture(); const base = f.root;
  const calls: string[] = [];
  const runner: ProcessRunner = async (command, args, cwd, signal, max) => {
    if (command === "pdftoppm") { calls.push(args.join(" ")); if (args.includes("9")) return { code: 1, stdout: "", stderr: "Wrong page number" }; await writeFile(join(cwd, "page-render.png"), Buffer.from("PNGDATA")); return { code: 0, stdout: "", stderr: "" }; }
    return f.runner(command, args, cwd, signal, max);
  };
  const send = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const payload = JSON.parse(init!.body as string), system = payload.messages[0].content as string;
    if (system.startsWith("Transcribe the mathematics")) return Response.json({ model: "muse-wonder-1.0", choices: [{ finish_reason: "stop", message: { content: "(1) $\\tau_0 = 0.09 \\frac{|x-y|}{len}$" } }], usage: { total_tokens: 5000 } });
    return Response.json({ model: "muse-spark-1.3", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(system.startsWith("Identify this research paper") ? classification : extraction) } }], usage: { total_tokens: 30 } });
  });
  const handle = createKnowledgeHandler("fixture", { root: base, runner, fetch: send, pdfText: async () => `${paper}\n\f\nPage two (1)` });
  const form = new FormData(); form.set("confirmed", "true"); form.set("model", "muse-spark-1.3"); form.set("file", new File(["%PDF-1.7 body"], "p.pdf", { type: "application/pdf" }));
  const stored = await (await handle(new Request("http://localhost:5173/api/knowledge/ingest", { method: "POST", headers: { origin: "http://localhost:5173", "sec-fetch-site": "same-origin" }, body: form }))).json();
  expect(stored.entry.status).toBe("stored");
  const transcribe = (value: unknown, origin?: string) => handle(request("/transcribe", value, "POST", origin));
  const first = await (await transcribe({ paper: "canopy masks", page: 2 })).json();
  expect(first).toMatchObject({ status: "transcribed", cached: false, page: 2, model: "muse-wonder-1.0" }); expect(first.text).toContain("tau_0"); expect(first.note).toContain("Check it against the PDF");
  expect(calls).toEqual(["-r 200 -f 2 -l 2 -png -singlefile paper.pdf page-render"]);
  const image = JSON.parse(send.mock.calls.at(-1)![1]!.body as string).messages[1].content[1].image_url.url as string; expect(image).toBe(`data:image/png;base64,${Buffer.from("PNGDATA").toString("base64")}`);
  const spent = send.mock.calls.length;
  expect(await (await transcribe({ paper: stored.entry.id, page: 2 })).json()).toMatchObject({ cached: true, text: first.text }); expect(send.mock.calls.length).toBe(spent);
  await expect(access(join(base, stored.entry.id, "page-render.png"))).rejects.toThrow();
  expect((await transcribe({ paper: "canopy masks", page: 9 })).status).toBe(400);
  expect(await (await transcribe({ paper: "nothing here", page: 1 })).json()).toMatchObject({ status: "not_found" });
  for (const bad of [{ paper: "p", page: 0 }, { paper: "p", page: 1.5 }, { paper: "p", page: 301 }, { paper: "p", page: 1, extra: 1 }]) expect((await transcribe(bad)).status).toBe(400);
  expect((await transcribe({ paper: "canopy masks", page: 2 }, "https://other.site")).status).toBe(403);
  const missing = createKnowledgeHandler("fixture", { root: base, runner: async () => { throw Object.assign(Error("spawn pdftoppm ENOENT"), { code: "ENOENT" }); }, fetch: send });
  expect((await (await missing(request("/transcribe", { paper: "canopy masks", page: 3 }))).json()).error).toContain("brew install poppler");
});
