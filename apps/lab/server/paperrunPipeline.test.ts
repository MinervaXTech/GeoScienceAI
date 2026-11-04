// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { codeFingerprint, createRun, currentCoverage, listCodeFiles, writeCodeFile, readCodeFile, readEvents, readRun, updateRun } from "./paperrunCore";
import { addPriorWork, chooseEnvironments, continuationText, codegenInstructions, envChoiceInstructions, continueRun, findHardcodedResults, forkForExternal, guidanceFor, handoverText, repairInstructions, reviewInstructions, runPipeline, runReport, settled, specForModel } from "./paperrunPipeline";
import { validateReplicationSpec } from "./knowledgeReplication";
import { listEnvironments, saveEnvironment } from "./environments";
import { setEnvPolicy } from "./paperrunCore";
const python = resolve(__dirname, "../paperruns/.venv/bin/python");
const available = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && existsSync(python);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const paper = "We set the colony size to 50 ants. In a 20*20 grid map the improved strategy converged in the 23rd iteration. Path accuracy was 94.64%.";
const spec = validateReplicationSpec({ goal: "Reproduce the improved ACO.", steps: [{ name: "Init", description: "Set ants.", quote: "colony size to 50 ants" }], equations: [{ label: "Eq. (1)", latex: "x", text: "x" }], parameters: [{ name: "ants", value: "50", quote: "colony size to 50 ants" }], reportedResults: [{ description: "iterations", value: "23rd iteration", condition: "20*20", quote: "converged in the 23rd iteration" }, { description: "accuracy", value: "94.64%", condition: "", quote: "Path accuracy was 94.64%" }], gaps: [{ kind: "randomness", description: "seeds", impact: "low", assumption: { proposal: "0-29", rationale: "common" } }] }, paper);
const meta = { title: "ACO study", model: "muse-wonder-1.0", builtAt: "2026-11-03T10:00:00.000Z" };
const good = { files: [{ path: "impl.py", content: "import numpy as np\ndef run(seed):\n    rng = np.random.default_rng(seed)\n    return 23 + float(rng.normal(0, 0.1)), 94.5 + float(rng.normal(0, 0.1))\n" }, { path: "run_tests.py", content: "import json\nimport numpy as np\nfrom impl import run\nvals = np.array([run(s) for s in range(30)])\njson.dump({'results': [{'id': 'R1', 'reproduced': float(vals[:,0].mean()), 'tolerance': 0.1, 'note': 'mean of seeds 0-29'}, {'id': 'R2', 'reproduced': float(vals[:,1].mean()), 'unit': '%', 'tolerance': 0.1, 'note': 'mean of seeds 0-29'}]}, open('results.json', 'w'))\n" }], notes: "Built it." };
const crashing = { files: [{ path: "run_tests.py", content: "print(undefined_name)\n" }], notes: "First try." };
const fixed = { files: [good.files[1]!, good.files[0]!], giveUp: false, notes: "Defined the missing implementation." };
const wrong = { files: [{ path: "run_tests.py", content: "import json\njson.dump({'results': [{'id': 'R1', 'reproduced': 40, 'tolerance': 0.1}, {'id': 'R2', 'reproduced': 94.6}]}, open('results.json', 'w'))\n" }], notes: "Approximate." };
type Script = { codegen: unknown; repair?: unknown[]; review?: unknown; tokens?: number; hang?: boolean };
const repairPrompts: string[] = [];
const setup = async (script: Script, options: { maxRounds?: number; tokenCap?: number } = {}) => {
  const root = await mkdtemp(join(tmpdir(), "paperrun-pipe-")); dirs.push(root);
  const run = await createRun(root, { paperId: "p1", title: "ACO study", mode: "muse", model: "muse-wonder-1.0", maxRounds: options.maxRounds ?? 4, tokenCap: options.tokenCap ?? 400000, spec, meta });
  const seen: string[] = []; let repairs = 0;
  const send = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string), system = body.messages[0].content as string;
    if (script.hang) await new Promise((_r, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    let content: unknown;
    if (system === codegenInstructions) { seen.push("codegen"); content = script.codegen; }
    else if (system === repairInstructions) { seen.push("repair"); repairPrompts.push(body.messages[1].content); content = script.repair?.[repairs++] ?? { files: [], giveUp: true, reason: "nothing more to try" }; }
    else if (system === reviewInstructions) { seen.push("review"); content = script.review ?? { verdict: "clean", concerns: [] }; }
    else throw new Error("unexpected prompt");
    return Response.json({ model: "muse-wonder-1.0", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { total_tokens: script.tokens ?? 10000 } });
  });
  return { root, run, send, seen, go: (signal = new AbortController().signal) => runPipeline({ root, key: "fixture-secret", send, python }, run.id, signal) };
};
describe("pure helpers", () => {
  it("tells Muse what code the paper states, that it cannot fetch it, and notes the authors' code in the report", () => {
    const codeSources = { status: "link" as const, links: [{ url: "https://github.com/lab/aco", host: "github.com", kind: "repository" as const, ownCode: true, inReferences: false, quote: "Our code is at https://github.com/lab/aco.", page: 3 }], statements: [] };
    const data = JSON.parse(specForModel(spec, [], [], codeSources)); expect(data.codeStatedInThePaper.join("\n")).toContain("https://github.com/lab/aco"); expect(data.codeStatedInThePaper.join("\n")).toContain("cannot fetch it");
    expect(JSON.parse(specForModel(spec, [])).codeStatedInThePaper).toBeUndefined();
    const base = { title: "ACO", model: "m", rows: [], assumptions: [], spec, notes: [], concerns: [], roundsUsed: 1, maxRounds: 1, tokens: { used: 1, cap: 2 }, stopReason: "x", files: [] };
    expect(runReport({ ...base, codeSources })).toContain("Code the paper states: https://github.com/lab/aco (link)."); expect(runReport({ ...base, codeSources })).toContain("not that the method was independently re-implemented");
    expect(runReport({ ...base, codeSources: { status: "none", links: [], statements: [] } })).toContain("Code the paper states: none (none)."); expect(runReport(base)).not.toContain("Code the paper states");
  });
  it("gives Muse the spec with result ids and the assumption chosen for each gap", () => {
    const data = JSON.parse(specForModel(spec, [{ gapId: "G1", proposal: "use seeds 5-9" }]));
    expect(data.reportedResults.map((r: { id: string }) => r.id)).toEqual(["R1", "R2"]); expect(data.gaps[0].assumptionToUse).toBe("use seeds 5-9"); expect(data.parameters[0]).toMatchObject({ name: "ants", value: "50" });
    expect(JSON.parse(specForModel(spec, [])).gaps[0].assumptionToUse).toBe("0-29");
  });
  it("flags a result written as a literal that equals the paper's value", () => {
    const flagged = findHardcodedResults([{ path: "run_tests.py", content: "json.dump({'results': [{'id': 'R1', 'reproduced': 23, 'tolerance': 0.1}, {\"reproduced\": 94.64}, {'reproduced': 7}, {'reproduced': 23 * 2}]})" }], spec.reportedResults);
    expect(flagged).toHaveLength(2); expect(flagged[0]).toContain("R1"); expect(flagged[1]).toContain("R2");
    expect(findHardcodedResults([{ path: "x.py", content: "'reproduced': float(mean)" }], spec.reportedResults)).toEqual([]);
  });
  it("treats comparable and matching results as settled but not mismatches or missing ones", () => {
    const row = (status: string) => ({ id: "R1", description: "", reported: "", reproduced: "", tolerance: 0, status, note: "" }) as never;
    expect(settled([row("match"), row("within_tolerance"), row("not_comparable")])).toBe(true);
    expect(settled([row("match"), row("mismatch")])).toBe(false); expect(settled([row("not_run")])).toBe(false); expect(settled([])).toBe(false);
  });
  it("tells Muse to measure, not copy, and says statuses come from the app", () => {
    expect(codegenInstructions).toMatch(/NEVER write a reported value in as a reproduced value/); expect(repairInstructions).toMatch(/Honest mismatches are acceptable; faked matches are not/);
    const report = runReport({ title: "ACO", model: "m", rows: [{ id: "R1", description: "iter", reported: "23", reproduced: "22.9", relError: 0.0043, tolerance: 0.1, status: "match", note: "mean" }], assumptions: [], spec, notes: ["note"], concerns: ["[low] x"], roundsUsed: 1, maxRounds: 4, tokens: { used: 1234, cap: 5000 }, stopReason: "All results settled.", files: ["impl.py"] });
    expect(report).toContain("# PaperRun report: ACO"); expect(report).not.toContain("honesty review raised"); expect(report).toContain("within 2% is a match, within 10% is within tolerance");
    const warned = runReport({ title: "ACO", model: "m", rows: [], assumptions: [], spec, notes: [], concerns: ["[high] one", "[low] two", "[high] three"], roundsUsed: 1, maxRounds: 1, tokens: { used: 1, cap: 2 }, stopReason: "x", files: [] });
    expect(warned).toContain("⚠ The honesty review raised 2 high-severity concern(s)"); expect(warned.indexOf("honesty review raised")).toBeLessThan(warned.indexOf("Statuses are computed"));
    expect(report).toContain("1 match, 0 within tolerance"); expect(report).toContain("Statuses are computed by the app"); expect(report).toContain("| R1 | iter | 23 | 22.9 | 0.4% | match | mean |"); expect(report).toContain("1,234 of 5,000 tokens"); expect(report).toContain("- code/impl.py");
  });
});
describe.runIf(available)("the Muse pipeline", () => {
  it("writes code, runs it, reviews it and reports, using no repair when everything settles", async () => {
    const t = await setup({ codegen: good }); await t.go();
    const run = await readRun(t.root, t.run.id);
    expect(run).toMatchObject({ status: "done", rounds: { used: 1 }, tokens: { used: 20000 } }); expect(t.seen).toEqual(["codegen", "review"]);
    expect(run.stages.map(s => [s.name, s.status])).toEqual([["Spec and assumptions", "done"], ["Write code", "done"], ["Run tests", "done"], ["Repair", "skipped"], ["Review", "done"], ["Report", "done"]]);
    expect(run.results?.map(r => r.status)).toEqual(["match", "match"]); expect(run.summary).toContain("2 match");
    const report = await readFile(join(t.root, t.run.id, "report.md"), "utf8"); expect(report).toContain("2 match, 0 within tolerance, 0 mismatch"); expect(report).toContain("**G1** [low] seeds"); expect(report).toContain("No concerns were raised"); expect(report).toContain("code/impl.py");
    const body = JSON.stringify(send(t)); expect(body).not.toContain("fixture-secret");
  });
  it("puts a replication summary with method coverage in the report and on the run", async () => {
    const t = await setup({ codegen: wrong, review: { verdict: "clean", concerns: [], stepCoverage: [{ n: 1, status: "partial", note: "Simplified to a single colony." }, { n: 7, status: "implemented", note: "bad step number" }] } }, { maxRounds: 0 }); await t.go();
    const run = await readRun(t.root, t.run.id); expect(run.stepCount).toBe(1); expect(run.stepCoverage).toEqual([{ n: 1, status: "partial", note: "Simplified to a single colony." }]);
    const report = await readFile(join(t.root, t.run.id, "report.md"), "utf8");
    expect(report).toContain("## Replication summary"); expect(report).toContain("1 of 2 reported results (50%) are within 10% of the paper's numbers"); expect(report).toContain("Of the 2 that could be compared, 1 (50%) are near the paper's value and 1 are not."); expect(report).toContain("0 of 1 method steps are implemented, 1 partly (about 50% of the method)");
    expect(report.indexOf("## Replication summary")).toBeLessThan(report.indexOf("## Outcome"));
    const plain = await setup({ codegen: good }); await plain.go(); expect(await readFile(join(plain.root, plain.run.id, "report.md"), "utf8")).toContain("Method coverage has not been assessed (1 steps in the spec).");
  });
  it("puts a verdict and prioritised next steps in the report, and the summary line", async () => {
    const t = await setup({ codegen: wrong, review: { verdict: "concerns", concerns: [{ severity: "high", description: "R1 is hardcoded." }], stepCoverage: [{ n: 1, status: "partial", note: "Single colony." }] } }, { maxRounds: 0 }); await t.go();
    const report = await readFile(join(t.root, t.run.id, "report.md"), "utf8");
    expect(report).toMatch(/## Assessment: (Early attempt|Partial replication)/); expect(report).toContain("## What to do next"); expect(report).toContain("**high** (code): Fix 1 step that is only partly implemented or missing (steps 1)."); expect(report).toContain("**high** (honesty): Resolve this review concern: R1 is hardcoded.");
    expect(report.indexOf("## Replication summary")).toBeLessThan(report.indexOf("## Assessment")); expect(report.indexOf("## What to do next")).toBeLessThan(report.indexOf("## Outcome"));
    expect((await readRun(t.root, t.run.id)).summary).toContain("1 high-severity review concern(s).");
  });
  it("continues a finished run: more rounds and tokens, repair guided by the review, then a fresh review and report", async () => {
    const t = await setup({ codegen: wrong, repair: [fixed], review: { verdict: "concerns", concerns: [{ severity: "high", description: "Step 1 is simplified." }], stepCoverage: [{ n: 1, status: "partial", note: "Single colony." }] } }, { maxRounds: 0 }); await t.go();
    const before = await readRun(t.root, t.run.id); expect(before).toMatchObject({ status: "done", rounds: { max: 0, used: 1 }, tokens: { cap: 400000 } }); expect(before.results?.map(r => r.status)).toEqual(["mismatch", "match"]);
    t.seen.length = 0; repairPrompts.length = 0;
    await continueRun({ root: t.root, key: "fixture-secret", send: t.send, python }, t.run.id, { rounds: 2, addTokens: 100000, guidance: guidanceFor(before, spec) }, new AbortController().signal);
    const after = await readRun(t.root, t.run.id);
    expect(after).toMatchObject({ status: "done", rounds: { max: 2, used: 3, repairs: 1 }, tokens: { cap: 500000 } }); expect(after.results?.map(r => r.status)).toEqual(["match", "match"]); expect(t.seen).toEqual(["repair", "review"]);
    expect(repairPrompts[0]).toContain("What a reviewer found that still needs fixing (data):"); expect(repairPrompts[0]).toContain("Resolve this review concern: Step 1 is simplified."); expect(repairPrompts[0]).toContain("Step 1 (partial): Single colony.");
    expect(after.stages.every(s => s.status === "done" || s.status === "skipped")).toBe(true); expect((await readEvents(t.root, t.run.id)).map(e => e.kind)).toContain("continue");
    expect(await readFile(join(t.root, t.run.id, "report.md"), "utf8")).toContain("2 match, 0 within tolerance, 0 mismatch"); expect(after.summary).toContain("2 match");
  });
  it("continues with nothing to repair when everything already settles, and fails clearly without code", async () => {
    const t = await setup({ codegen: good }); await t.go(); t.seen.length = 0;
    await continueRun({ root: t.root, key: "k", send: t.send, python }, t.run.id, { rounds: 1, addTokens: 0, guidance: "" }, new AbortController().signal);
    expect(t.seen).toEqual(["review"]); expect((await readRun(t.root, t.run.id)).stages[3]).toMatchObject({ name: "Repair", status: "skipped", note: "nothing to repair" });
    const empty = await setup({ codegen: good }); await continueRun({ root: empty.root, key: "k", send: empty.send, python }, empty.run.id, { rounds: 1, addTokens: 0, guidance: "" }, new AbortController().signal);
    expect(await readRun(empty.root, empty.run.id)).toMatchObject({ status: "failed", error: "There is no code to continue from." });
  });
  it("hands a finished Muse run to an external agent as a new run with the code, results and next steps carried over", async () => {
    const t = await setup({ codegen: wrong, review: { verdict: "concerns", concerns: [{ severity: "high", description: "R1 is simplified." }], stepCoverage: [{ n: 1, status: "partial", note: "Single colony." }] } }, { maxRounds: 0 }); await t.go();
    const parent = await readRun(t.root, t.run.id), knowledgeRoot = join(t.root, "..", "knowledge-x");
    const childId = await forkForExternal(t.root, t.run.id, knowledgeRoot); const child = await readRun(t.root, childId);
    expect(childId).not.toBe(t.run.id); expect(child).toMatchObject({ mode: "external", status: "waiting_external", parentId: t.run.id, paperId: parent.paperId, stepCount: 1, results: parent.results, review: parent.review, stepCoverage: [{ n: 1, status: "partial" }] });
    expect(child.stages.slice(0, 2).map(s => [s.status, s.note])).toEqual([["done", "carried over"], ["done", `1 file(s) copied from ${t.run.id}`]]);
    expect(await listCodeFiles(t.root, childId)).toEqual((await listCodeFiles(t.root, t.run.id)).filter(f => f.path !== "results.json")); expect((await listCodeFiles(t.root, t.run.id)).some(f => f.path === "results.json")).toBe(true); expect(await readCodeFile(t.root, childId, "run_tests.py")).toBe(await readCodeFile(t.root, t.run.id, "run_tests.py"));
    const brief = await readFile(join(t.root, childId, "brief.md"), "utf8");
    expect(brief.startsWith(`HANDOVER: continue PaperRun ${t.run.id}`)).toBe(true); expect(brief).toContain("Do NOT start from scratch"); expect(brief).toContain("WHERE IT STANDS:"); expect(brief).toContain("| R1 | iterations | 23rd iteration | 40"); expect(brief).toContain("- [high] R1 is simplified."); expect(brief).toContain("Step 1 (partial): Single colony.");
    expect(brief).toContain("paperrun_get_page_image"); expect(brief).toContain(join(knowledgeRoot, parent.paperId, "paper.pdf")); expect(brief).toContain("TASK: Re-implement"); expect(brief).toContain("RESULTS CONTRACT"); expect(brief.indexOf("HANDOVER")).toBeLessThan(brief.indexOf("TASK: Re-implement"));
    expect(await readFile(join(t.root, childId, "handover.md"), "utf8")).not.toContain("TASK: Re-implement");
    expect((await readEvents(t.root, childId)).map(e => e.kind)).toContain("handover"); expect((await readEvents(t.root, t.run.id)).at(-1)).toMatchObject({ kind: "handover", message: `Handed over to an external agent as ${childId}.` });
    expect(await readRun(t.root, t.run.id)).toMatchObject({ status: "done", mode: "muse" });
  });
  it("keeps a run's environments when it is handed to an external agent, and tells Muse about them", async () => {
    const { attachEnvironment } = await import("./paperrunCore"); const { saveEnvironment } = await import("./environments");
    const t = await setup({ codegen: good }); const envRoot = join(t.root, "..", "lib"); const env = await saveEnvironment(envRoot, { name: "Four", description: "", origin: "digitised", source: { note: "Fig. 9a", paperTitle: "T" }, grid: { rows: 4, cols: 4, ascii: ["....", ".##.", "....", "...."] }, start: [0, 0], goal: [3, 3] }, { createdBy: "app" });
    await attachEnvironment(t.root, t.run.id, envRoot, env.id); await t.go();
    const prompts = t.send.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string).messages[1].content as string); expect(prompts[0]).toContain('"environments"'); expect(prompts[0]).toContain(`"loadFrom":"environments/${env.id}.json"`); expect(prompts[0]).toContain("Fig. 9a");
    const child = await forkForExternal(t.root, t.run.id, "/k", envRoot); const kid = await readRun(t.root, child);
    expect(kid.environments).toEqual([expect.objectContaining({ id: env.id })]); expect((await listCodeFiles(t.root, child)).map(f => f.path)).toContain(`environments/${env.id}.json`); expect(await readFile(join(t.root, child, "brief.md"), "utf8")).toContain("ENVIRONMENTS ATTACHED");
  });
  it("carries method coverage into a continuation while the shared code is unchanged, and drops it once the code changes", async () => {
    const t = await setup({ codegen: good }), coverage = [{ n: 1, status: "partial" as const, note: "Single colony." }];
    const ext = await createRun(t.root, { paperId: "p", title: "t", mode: "external", model: "m", maxRounds: 0, tokenCap: 50000, spec, meta });
    await writeCodeFile(t.root, ext.id, "impl.py", "x = 1\n"); await writeCodeFile(t.root, ext.id, "NOTES.md", "first notes");
    const judged = await codeFingerprint(t.root, ext.id);
    await updateRun(t.root, ext.id, r => { r.status = "done"; r.stepCoverage = coverage; r.coverageCode = judged; r.coverageFrom = ext.id; });
    // Notes and audits are not the method, so they do not invalidate the coverage.
    await writeCodeFile(t.root, ext.id, "NOTES.md", "much longer notes"); expect(await codeFingerprint(t.root, ext.id)).toBe(judged);
    const same = await readRun(t.root, await forkForExternal(t.root, ext.id, "/k"));
    expect(same).toMatchObject({ stepCoverage: coverage, coverageFrom: ext.id }); expect(same.results ?? []).toEqual([]); expect(await currentCoverage(t.root, same)).toEqual(coverage);
    await writeCodeFile(t.root, ext.id, "impl.py", "x = 2\n"); // the next agent changes the method
    expect(await currentCoverage(t.root, same)).toBeUndefined(); expect(await currentCoverage(t.root, await readRun(t.root, ext.id))).toBeUndefined();
    const later = await readRun(t.root, await forkForExternal(t.root, ext.id, "/k")); expect(later.stepCoverage).toBeUndefined();
    expect(await readFile(join(t.root, later.id, "brief.md"), "utf8")).not.toContain("Step 1 (partial)");
  });
  it("tells a run prepared from scratch about the shared code and the memory of earlier runs", async () => {
    const t = await setup({ codegen: good }); await t.go();
    const blank = await createRun(t.root, { paperId: "other", title: "t", mode: "external", model: "m", maxRounds: 0, tokenCap: 50000, spec, meta });
    expect(await addPriorWork(t.root, blank.id)).toBe(false); expect(await readFile(join(t.root, blank.id, "brief.md"), "utf8")).not.toContain("PRIOR WORK");
    const again = await createRun(t.root, { paperId: (await readRun(t.root, t.run.id)).paperId, title: "t", mode: "external", model: "m", maxRounds: 0, tokenCap: 50000, spec, meta });
    await writeCodeFile(t.root, again.id, "impl.py", "x = 1\n");
    expect(await addPriorWork(t.root, again.id)).toBe(true);
    const brief = await readFile(join(t.root, again.id, "brief.md"), "utf8");
    expect(brief).toContain("PRIOR WORK ON THIS PAPER"); expect(brief).toContain("impl.py"); expect(brief).toContain("improve them in place"); expect(brief).toContain("REPLICATION MEMORY"); expect(brief.indexOf("TASK: Re-implement")).toBeLessThan(brief.indexOf("PRIOR WORK"));
  });
  it("refuses to hand over a run that is not a finished Muse run with code", async () => {
    const t = await setup({ codegen: good }); await expect(forkForExternal(t.root, t.run.id, "/k")).rejects.toThrow("Wait for the run to finish");
    await t.go(); const ext = await createRun(t.root, { paperId: "p", title: "t", mode: "external", model: "m", maxRounds: 0, tokenCap: 50000, spec, meta }); await expect(forkForExternal(t.root, ext.id, "/k")).rejects.toThrow("Wait for the run to finish");
    const empty = await setup({ codegen: good }); await updateRun(empty.root, empty.run.id, r => { r.status = "cancelled"; }); await expect(forkForExternal(empty.root, empty.run.id, "/k")).rejects.toThrow("no code to continue from");
  });
  it("writes a hand-over brief that stays short when Muse's notes are long and omits empty sections", () => {
    const text = handoverText({ parentId: "run-1", title: "T", run: {}, spec, files: [], report: `# R\n\n## Muse's notes\n1. ${"long note ".repeat(1000)}\n\n## Files\n- code/impl.py`, pdfPath: "/k/paper.pdf" });
    expect(text).toContain("more characters in the parent run's report.md"); expect(text.length).toBeLessThan(8000); expect(text).not.toContain("LATEST RESULTS"); expect(text).not.toContain("REVIEW CONCERNS"); expect(text).toContain("/k/paper.pdf"); expect(text).not.toContain("## Files");
  });
  it("repairs a crash, runs again, and records both rounds", async () => {
    const t = await setup({ codegen: crashing, repair: [fixed] }); await t.go();
    const run = await readRun(t.root, t.run.id);
    expect(run).toMatchObject({ status: "done", rounds: { used: 2, repairs: 1 } }); expect(t.seen).toEqual(["codegen", "repair", "review"]); expect(run.results?.map(r => r.status)).toEqual(["match", "match"]);
    expect(existsSync(join(t.root, t.run.id, "rounds/1/stderr.txt"))).toBe(true); expect(await readFile(join(t.root, t.run.id, "rounds/1/stderr.txt"), "utf8")).toContain("undefined_name");
    expect(await readFile(join(t.root, t.run.id, "report.md"), "utf8")).toContain("Round 1: Defined the missing implementation.");
  });
  it("stops honestly when Muse gives up instead of tuning toward the paper's numbers", async () => {
    const t = await setup({ codegen: wrong, repair: [{ files: [], giveUp: true, reason: "The obstacle map exists only as a figure." }] }); await t.go();
    const run = await readRun(t.root, t.run.id); expect(run.status).toBe("done"); expect(run.results?.map(r => r.status)).toEqual(["mismatch", "match"]);
    expect(run.summary).toContain("Muse stopped repairing: The obstacle map exists only as a figure."); expect(t.seen).toEqual(["codegen", "repair", "review"]);
    expect(await readFile(join(t.root, t.run.id, "report.md"), "utf8")).toContain("1 match, 0 within tolerance, 1 mismatch");
  });
  it("makes no repair attempts when rounds are set to zero, and stops at the round limit", async () => {
    const none = await setup({ codegen: wrong }, { maxRounds: 0 }); await none.go(); expect(none.seen).toEqual(["codegen", "review"]); expect((await readRun(none.root, none.run.id)).stages[3]).toMatchObject({ status: "skipped", note: "repair rounds set to 0" });
    const capped = await setup({ codegen: wrong, repair: [wrong, wrong, wrong] }, { maxRounds: 2 }); await capped.go();
    expect(capped.seen).toEqual(["codegen", "repair", "repair", "review"]); const run = await readRun(capped.root, capped.run.id); expect(run.rounds.used).toBe(3); expect(run.summary).toContain("Stopped after 2 repair round(s)");
  });
  it("stops cleanly at the token cap and still produces a report", async () => {
    const t = await setup({ codegen: wrong, tokens: 48000 }, { tokenCap: 50000 }); await t.go();
    const run = await readRun(t.root, t.run.id); expect(run.status).toBe("done"); expect(run.summary).toContain("the token cap was reached"); expect(t.seen).toEqual(["codegen"]);
    expect(await readFile(join(t.root, t.run.id, "report.md"), "utf8")).toContain("The model review did not run: The token cap for this run was reached.");
  });
  it("flags faked results in the report even when the model review is clean", async () => {
    const faked = { files: [{ path: "run_tests.py", content: "import json\njson.dump({'results': [{'id': 'R1', 'reproduced': 23, 'tolerance': 0.1}]}, open('results.json', 'w'))\n" }], notes: "" };
    const t = await setup({ codegen: faked }); await t.go();
    const run = await readRun(t.root, t.run.id); expect(run.review).toContain("writes the literal 23"); expect(await readFile(join(t.root, t.run.id, "report.md"), "utf8")).toContain("writes the literal 23");
  });
  it("includes the model reviewer's concerns", async () => {
    const t = await setup({ codegen: good, review: { verdict: "concerns", concerns: [{ severity: "high", description: "Step 4 is skipped." }, { severity: "odd", description: "Seeds are not disclosed." }, { nope: 1 }] } }); await t.go();
    expect((await readRun(t.root, t.run.id)).review).toBe("[high] Step 4 is skipped.\n[medium] Seeds are not disclosed.");
  });
  it("fails clearly on unusable files, incomplete replies, and cancels on request", async () => {
    const bad = await setup({ codegen: { files: [{ path: "../evil.py", content: "x" }, { path: "a.sh", content: "x" }, { path: "ok.py" }, 5] } }); await bad.go();
    expect(await readRun(bad.root, bad.run.id)).toMatchObject({ status: "failed", error: "Muse returned no usable files for code generation." }); expect((await readEvents(bad.root, bad.run.id)).filter(e => e.kind === "warning")).toHaveLength(2);
    const abort = new AbortController(), hang = await setup({ codegen: good, hang: true }); const running = hang.go(abort.signal); setTimeout(() => abort.abort(), 150); await running;
    expect(await readRun(hang.root, hang.run.id)).toMatchObject({ status: "cancelled", error: "Cancelled by the user." });
  });
});
const send = (t: { send: { mock: { calls: unknown[][] } } }) => t.send.mock.calls.map(c => (c[1] as RequestInit).body);

describe("letting Muse choose environments", () => {
  const grid = { rows: 4, cols: 4, ascii: ["....", ".##.", "....", "...."] };
  const newInput = (name: string) => ({ name, description: "A small map.", origin: "digitised" as const, source: { note: "Fig. 9a" }, grid, start: [0, 0] as [number, number], goal: [3, 3] as [number, number] });
  const prepare = async (policy: { pick: boolean; create: boolean } | null, answer: unknown) => {
    const root = await mkdtemp(join(tmpdir(), "paperrun-envchoice-")), envRoot = await mkdtemp(join(tmpdir(), "paperrun-envs-")); dirs.push(root, envRoot);
    const run = await createRun(root, { paperId: "p1", title: "ACO study", mode: "muse", model: "muse-wonder-1.0", maxRounds: 4, tokenCap: 400000, spec, meta });
    if (policy) await setEnvPolicy(root, run.id, policy);
    const approved = await saveEnvironment(envRoot, newInput("Approved map"), { createdBy: "app" }), candidate = await saveEnvironment(envRoot, newInput("Candidate map"), { createdBy: "agent" });
    const send = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string); expect(body.messages[0].content).toBe(envChoiceInstructions);
      const content = typeof answer === "function" ? (answer as (a: string, c: string) => unknown)(approved.id, candidate.id) : answer;
      return Response.json({ model: "muse-wonder-1.0", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { total_tokens: 5000 } });
    });
    return { root, envRoot, run, send, approved, candidate, go: () => chooseEnvironments({ root, key: "k", send, python, environmentsRoot: envRoot }, run.id, spec, [], new AbortController().signal) };
  };
  it("asks nothing when the user left nothing to Muse", async () => {
    const t = await prepare(null, {}); await t.go(); expect(t.send).not.toHaveBeenCalled(); expect((await readRun(t.root, t.run.id)).environments).toBeUndefined();
  });
  it("attaches only approved library environments when picking is allowed, and creates nothing when creating is not", async () => {
    const t = await prepare({ pick: true, create: false }, (a: string, c: string) => ({ use: [a, c, "env-missing-0000"], create: { ...newInput("Sneaky") }, reason: "Fig. 9a fits." })); await t.go();
    expect((await readRun(t.root, t.run.id)).environments!.map(e => e.id)).toEqual([t.approved.id]); expect((await listEnvironments(t.envRoot)).map(e => e.name).sort()).toEqual(["Approved map", "Candidate map"]);
    expect((await readEvents(t.root, t.run.id)).some(e => e.message.includes("Fig. 9a fits."))).toBe(true);
    expect(JSON.parse(t.send.mock.calls[0]![1]!.body as string).messages[1].content).not.toContain(t.candidate.id);
  });
  it("creates a candidate when allowed, never as digitised, attaches it and says so", async () => {
    const t = await prepare({ pick: false, create: true }, (a: string) => ({ use: [a], create: { name: "Made for the paper", description: "Random 20x20.", origin: "digitised", source: { note: "From the stated 20x20 grid" }, generator: { type: "random-obstacles", rows: 20, cols: 20, density: 0.1, seedBase: 1, instances: 3, start: [0, 0], goal: [19, 19] }, assumptions: ["density assumed 10%"] } })); await t.go();
    const attached = (await readRun(t.root, t.run.id)).environments!; expect(attached).toHaveLength(1); expect(attached[0]).toMatchObject({ name: "Made for the paper", status: "candidate", origin: "generated-from-description" });
    expect((await readEvents(t.root, t.run.id)).some(e => e.message.includes("as a candidate for you to approve"))).toBe(true);
  });
  it("never stops the run when the choice fails", async () => {
    const t = await prepare({ pick: true, create: true }, { create: { name: "", origin: "dream" } }); await t.go();
    expect((await readRun(t.root, t.run.id)).environments).toBeUndefined(); expect((await readEvents(t.root, t.run.id)).some(e => e.kind === "warning" && e.message.includes("builds its own"))).toBe(true);
  });
});

describe("continuing on the shared code with maps attached", () => {
  const maps = [{ name: "ACO corrected markers simple 24x24", status: "candidate" }, { name: "Fig 12 multi", status: "approved" }];
  const base = { parentId: "run-1", title: "T", spec, files: [{ path: "impl.py", bytes: 1 }, { path: "environments/env-a-1111.json", bytes: 1 }] };
  it("tells the agent the figure data is already digitised, drops the stale 'supply the data' step, and lists code files apart from maps", () => {
    const run = { results: [{ id: "R1", description: "x", reported: "1", reproduced: "2", tolerance: 0.1, status: "not_comparable" as const, note: "" }], environments: maps };
    const text = continuationText({ ...base, run });
    expect(text).toContain("MAPS ALREADY ATTACHED (2)"); expect(text).toContain("ACO corrected markers simple 24x24 (candidate)"); expect(text).toContain("Do not recreate or re-digitise a map unless you find an error");
    expect(text).not.toContain("Supply the missing data"); expect(text).toContain("Files already in the folder: impl.py."); expect(text).toContain("Use paperrun_get_page_image only to check an attached map");
    expect(text).not.toContain("Assess method coverage with Muse");
    const plain = continuationText({ ...base, run: { results: run.results } }); expect(plain).not.toContain("MAPS ALREADY ATTACHED"); expect(plain).toContain("Read the paper's figures with paperrun_get_page_image when a value is only shown there");
  });
});
