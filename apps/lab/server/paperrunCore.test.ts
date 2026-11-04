// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { environmentsBlock, codeFolderSizes, detachEnvironment, linkSharedCode, migrateSharedCode, sharedCodeDir, attachEnvironment, compareResults, createRun, listCodeFiles, listRuns, numberIn, readCodeFile, readEvents, readRun, runTests, summarise, updateRun, validRunId, writeCodeFile, codePath, setStage } from "./paperrunCore";
import { validateReplicationSpec } from "./knowledgeReplication";
import { saveEnvironment } from "./environments";
const python = resolve(__dirname, "../paperruns/.venv/bin/python");
const sandboxed = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && existsSync(python);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const paper = "We set the colony size to 50 ants. In a 20*20 grid map the improved strategy converged in the 23rd iteration. Path accuracy was 94.64%.";
const spec = validateReplicationSpec({ goal: "g", steps: [{ name: "s", description: "d", quote: "colony size to 50 ants" }], parameters: [{ name: "ants", value: "50", quote: "colony size to 50 ants" }], reportedResults: [{ description: "iterations", value: "23rd iteration", condition: "20*20", quote: "converged in the 23rd iteration" }, { description: "accuracy", value: "94.64%", condition: "", quote: "Path accuracy was 94.64%" }, { description: "layout", value: "see Fig. 3", condition: "", quote: "" }], gaps: [{ kind: "randomness", description: "seeds", impact: "low", assumption: { proposal: "0-29", rationale: "" } }] }, paper);
const meta = { title: "ACO study", model: "muse-wonder-1.0", builtAt: "2026-11-03T10:00:00.000Z" };
const make = async (mode: "muse" | "external" = "muse") => { const root = await mkdtemp(join(tmpdir(), "paperruns-")); dirs.push(root); const run = await createRun(root, { paperId: "paper-0001", title: "ACO study", mode, model: "muse-wonder-1.0", maxRounds: 4, tokenCap: 400000, spec, meta }); return { root, run }; };

describe("run store", () => {
  it("creates a run folder with the spec, a brief for external agents, and an event log", async () => {
    const { root, run } = await make();
    expect(validRunId(run.id)).toBe(true); expect(run).toMatchObject({ status: "queued", rounds: { max: 4, used: 0 }, tokens: { cap: 400000, used: 0 }, mode: "muse" });
    expect(run.stages.map(s => s.name)).toEqual(["Spec and assumptions", "Write code", "Run tests", "Repair", "Review", "Report"]);
    expect(run.assumptions).toEqual([{ gapId: "G1", decision: "accepted", proposal: "0-29" }]);
    const brief = await readFile(join(root, run.id, "brief.md"), "utf8"); expect(brief).toContain("TASK: Re-implement"); expect(brief).toContain("RESULTS CONTRACT"); expect(brief).toContain("Never write a reported value in as a reproduced one");
    expect((await readEvents(root, run.id))[0]).toMatchObject({ kind: "created" });
    expect((await make("external")).run.status).toBe("waiting_external");
  });
  it("clamps rounds and token cap, lists newest first, and serialises concurrent updates", async () => {
    const { root, run } = await make();
    const wild = await createRun(root, { paperId: "p", title: "t", mode: "muse", model: "m", maxRounds: 99, tokenCap: 5, spec, meta }, new Date(Date.now() + 5000)); expect(wild.rounds.max).toBe(6); expect(wild.tokens.cap).toBe(50000);
    expect((await listRuns(root)).map(r => r.id)).toEqual([wild.id, run.id]);
    await Promise.all(Array.from({ length: 20 }, () => updateRun(root, run.id, r => { r.tokens.used += 1; })));
    expect((await readRun(root, run.id)).tokens.used).toBe(20);
    await setStage(root, run.id, "Write code", "running"); await setStage(root, run.id, "Write code", "done", "ok");
    expect((await readRun(root, run.id)).stages[1]).toMatchObject({ status: "done", note: "ok" });
    await expect(readRun(root, "../etc")).rejects.toThrow("Invalid run id");
  });
});
describe("code files", () => {
  it("writes, lists and reads files inside the code folder only", async () => {
    const { root, run } = await make();
    await writeCodeFile(root, run.id, "impl.py", "x = 1\n"); await writeCodeFile(root, run.id, "pkg/util.py", "y = 2\n");
    expect(await listCodeFiles(root, run.id)).toEqual([{ path: "impl.py", bytes: 6 }, { path: "pkg/util.py", bytes: 6 }]);
    expect(await readCodeFile(root, run.id, "pkg/util.py")).toBe("y = 2\n");
    for (const bad of ["../x.py", "/etc/x.py", "a/../../x.py", ".hidden.py", "sub/.x.py", "x.sh", "noext", "a\\b.py", "", "x".repeat(130) + ".py"]) expect(() => codePath(root, run.id, bad)).toThrow();
    await expect(writeCodeFile(root, run.id, "big.py", "x".repeat(200001))).rejects.toThrow("at most");
    await expect(writeCodeFile(root, run.id, "results.json", "{}")).rejects.toThrow("written by run_tests.py");
    for (let i = 0; i < 38; i++) await writeCodeFile(root, run.id, `f${i}.py`, "#");
    await expect(writeCodeFile(root, run.id, "one-too-many.py", "#")).rejects.toThrow("at most 40 files");
    await writeCodeFile(root, run.id, "impl.py", "x = 3\n");
  });
});
describe("results contract", () => {
  it("reads the first number from printed values", () => {
    expect([numberIn("23rd iteration"), numberIn("94.64%"), numberIn("1,200 m"), numberIn(7), numberIn("see Fig. 3"), numberIn("none"), numberIn(Number.NaN), numberIn(null)]).toEqual([23, 94.64, 1200, 7, 3, undefined, undefined, undefined]);
  });
  it("decides match, within tolerance, mismatch, not comparable and not run itself, never from the model's claim", () => {
    const rows = compareResults(spec.reportedResults, { results: [{ id: "r1", reproduced: 23, tolerance: 0.1 }, { id: "R2", reproduced: 90, unit: "%", tolerance: 0.1, note: "mean of 30 seeds", status: "match" }, { id: "R3", reproduced: "a grid", tolerance: 9 }] });
    expect(rows.map(r => [r.id, r.status])).toEqual([["R1", "match"], ["R2", "within_tolerance"], ["R3", "not_comparable"]]);
    expect(rows[1]).toMatchObject({ reproduced: "90 %", relError: 0.049, tolerance: 0.1, note: "mean of 30 seeds" }); expect(rows[2]!.tolerance).toBe(0.1);
    expect(compareResults(spec.reportedResults, { results: [{ id: "R1", reproduced: 40, tolerance: 0.1 }] }).map(r => r.status)).toEqual(["mismatch", "not_run", "not_run"]);
    expect(compareResults(spec.reportedResults, null).every(r => r.status === "not_run")).toBe(true);
    expect(compareResults(spec.reportedResults, { results: [{ id: "R1", reproduced: 23 }, { id: "R1", reproduced: 99 }] })[0]!.reproduced).toBe("99");
    expect(summarise(rows)).toEqual({ match: 1, within_tolerance: 1, mismatch: 0, not_comparable: 1, not_run: 0 });
  });
});
describe("tolerance and comparability are decided by the app", () => {
  const reported = [{ description: "iterations", value: "100" }];
  const row = (entry: Record<string, unknown>) => compareResults(reported, { results: [{ id: "R1", ...entry }] })[0]!;
  it("caps a declared tolerance at 10%, so a loose claim cannot turn a 30% error into a pass", () => {
    const loose = row({ reproduced: 70, tolerance: 0.5, note: "close enough" }); expect(loose).toMatchObject({ status: "mismatch", tolerance: 0.1, relError: 0.3 }); expect(loose.note).toContain("declared tolerance 0.5 capped to 0.1");
    expect(row({ reproduced: 92 }).status).toBe("within_tolerance"); expect(row({ reproduced: 100.5 }).status).toBe("match"); expect(row({ reproduced: 88 }).status).toBe("mismatch");
  });
  it("lets code ask for a stricter tolerance but never a looser one", () => {
    expect(row({ reproduced: 95, tolerance: 0.03 }).status).toBe("mismatch"); expect(row({ reproduced: 97, tolerance: 0.05 }).status).toBe("within_tolerance"); expect(row({ reproduced: 97, tolerance: 0 }).status).toBe("mismatch");
  });
  it("reports a result as not comparable when the code says it used different data, whatever the numbers", () => {
    const flagged = row({ reproduced: 100, comparable: false, note: "representative map, the paper's map is a figure" });
    expect(flagged).toMatchObject({ status: "not_comparable", relError: 0 }); expect(flagged.note).toContain("different data or settings"); expect(flagged.note).toContain("representative map");
    expect(row({ reproduced: 100, comparable: true }).status).toBe("match"); expect(row({ reproduced: 100 }).status).toBe("match");
  });
});
describe.runIf(sandboxed)("running tests in the sandbox", () => {
  it("runs run_tests.py, stores the round, and compares the numbers it computed", async () => {
    const { root, run } = await make();
    await writeCodeFile(root, run.id, "impl.py", "import numpy as np\ndef iterations(seed):\n    rng = np.random.default_rng(seed)\n    return 20 + int(rng.integers(3, 6))\n");
    await writeCodeFile(root, run.id, "run_tests.py", "import json\nfrom impl import iterations\nvalues = [iterations(s) for s in range(30)]\njson.dump({'results': [{'id': 'R1', 'reproduced': sum(values)/len(values), 'tolerance': 0.2, 'note': 'mean over seeds 0-29'}]}, open('results.json', 'w'))\n");
    const outcome = await runTests(root, run.id, 1, python); expect(outcome).toMatchObject({ ranTests: true, code: 0, timedOut: false });
    expect(outcome.rows.map(r => r.status)).toEqual(["within_tolerance", "not_run", "not_run"]); expect(outcome.rows[0]!.reproduced).toMatch(/^2[34]/);
    const stored = await readRun(root, run.id); expect(stored.rounds.used).toBe(1); expect(stored.results?.[0]?.id).toBe("R1");
    expect(JSON.parse(await readFile(join(root, run.id, "rounds/1/compared.json"), "utf8"))[0].id).toBe("R1");
    expect((await readEvents(root, run.id)).at(-1)!.message).toMatch(/^Round 1: 1 within tolerance, 2 not run/);
  });
  it("reports a missing test script, a crash and a timeout clearly", async () => {
    const { root, run } = await make();
    expect(await runTests(root, run.id, 1, python)).toMatchObject({ ranTests: false, error: "run_tests.py was not written." });
    await writeCodeFile(root, run.id, "run_tests.py", "raise RuntimeError('broken')\n");
    const crash = await runTests(root, run.id, 2, python); expect(crash.error).toContain("exited with code 1 without writing results.json"); expect(crash.stderr).toContain("RuntimeError: broken");
    await writeCodeFile(root, run.id, "run_tests.py", "import time\ntime.sleep(60)\n");
    const slow = await runTests(root, run.id, 3, python, undefined, 1000); expect(slow).toMatchObject({ timedOut: true }); expect(slow.error).toContain("time limit");
  });
  it("refreshes the summary and flags the report as out of date when a finished run is tested again", async () => {
    const { root, run } = await make();
    await updateRun(root, run.id, r => { r.status = "done"; r.summary = "old summary"; }); await writeFile(join(root, run.id, "report.md"), "# PaperRun report: ACO study\n\nBody text.\n");
    await writeCodeFile(root, run.id, "run_tests.py", "import json\njson.dump({'results': [{'id': 'R1', 'reproduced': 23}]}, open('results.json', 'w'))\n");
    await runTests(root, run.id, 2, python); await runTests(root, run.id, 3, python);
    expect((await readRun(root, run.id)).summary).toBe("1 match, 2 not run. Re-tested in round 3.");
    const report = await readFile(join(root, run.id, "report.md"), "utf8"); expect(report.startsWith("# PaperRun report: ACO study\n\n> ⚠ The tests were run again in round 3")).toBe(true); expect(report.match(/tests were run again/g)).toHaveLength(1); expect(report).toContain("Body text.");
  });
  it("cannot be tricked into reading a stale results file from an earlier round", async () => {
    const { root, run } = await make();
    await writeCodeFile(root, run.id, "run_tests.py", "import json\njson.dump({'results': [{'id': 'R1', 'reproduced': 23}]}, open('results.json', 'w'))\n");
    expect((await runTests(root, run.id, 1, python)).rows[0]!.status).toBe("match");
    await writeCodeFile(root, run.id, "run_tests.py", "print('no results this time')\n");
    expect((await runTests(root, run.id, 2, python)).rows[0]!.status).toBe("not_run");
  });
});

describe("attaching environments", () => {
  const map = (name: string, over: Record<string, unknown> = {}) => ({ name, description: "", origin: "digitised", source: { note: "Fig. 9a", paperTitle: "ACO paper" }, grid: { rows: 4, cols: 4, ascii: ["....", ".##.", "....", "...."] }, start: [0, 0], goal: [3, 3], ...over });
  it("copies a fixed map into the run, records the version, and writes the brief section once", async () => {
    const { root, run } = await make(); const envRoot = join(root, "..", "envs"); const env = await saveEnvironment(envRoot, map("Open four"), { createdBy: "app" });
    const entry = await attachEnvironment(root, run.id, envRoot, env.id); await attachEnvironment(root, run.id, envRoot, env.id);
    expect(entry).toMatchObject({ id: env.id, version: 1, hash: env.hash, status: "approved", kind: "fixed", rows: 4, cols: 4, file: `environments/${env.id}.json` });
    const file = JSON.parse(await readFile(join(root, run.id, "code", entry.file), "utf8")); expect(file).toMatchObject({ id: env.id, kind: "fixed", ascii: ["....", ".##.", "....", "...."], start: [0, 0], goal: [3, 3], source: { paperTitle: "ACO paper", note: "Fig. 9a" } });
    expect((await readRun(root, run.id)).environments).toHaveLength(1); expect((await listCodeFiles(root, run.id)).map(f => f.path)).toContain(`environments/${env.id}.json`);
    const brief = await readFile(join(root, run.id, "brief.md"), "utf8"); expect(brief).toContain("ENVIRONMENTS ATTACHED"); expect(brief.match(/<!-- environments -->/g)).toHaveLength(1); expect(brief).toContain(`Open four (${env.id}, version 1, approved)`); expect(brief).toContain("must be marked \"comparable\": false"); expect(brief).toContain("RESULTS CONTRACT");
    expect((await readEvents(root, run.id)).filter(e => e.kind === "environment")).toHaveLength(2);
  });
  it("writes a generator out as numbered instances, and says a candidate is a candidate", async () => {
    const { root, run } = await make(); const envRoot = join(root, "..", "envs");
    const env = await saveEnvironment(envRoot, { name: "Random 12", description: "", origin: "generated-from-parameters", source: { note: "20 percent stated" }, generator: { type: "random-obstacles", rows: 12, cols: 12, density: 0.1, seedBase: 5, instances: 4 } }, { createdBy: "agent" });
    const entry = await attachEnvironment(root, run.id, envRoot, env.id); expect(entry).toMatchObject({ kind: "instances", instances: 4, status: "candidate" });
    const file = JSON.parse(await readFile(join(root, run.id, "code", entry.file), "utf8")); expect(file.instances.map((i: { seed: number }) => i.seed)).toEqual([5, 6, 7, 8]); expect(file.instances[0].ascii).toHaveLength(12);
    expect(await readFile(join(root, run.id, "brief.md"), "utf8")).toContain("4 pre-generated 12x12 random maps");
  });
  it("replaces an attached environment of the same id and refuses an unknown one", async () => {
    const { root, run } = await make(); const envRoot = join(root, "..", "envs"); const a = await saveEnvironment(envRoot, map("A"), { createdBy: "app" }), b = await saveEnvironment(envRoot, map("B"), { createdBy: "app" });
    await attachEnvironment(root, run.id, envRoot, a.id); await attachEnvironment(root, run.id, envRoot, b.id);
    expect((await readRun(root, run.id)).environments!.map(e => e.name)).toEqual(["A", "B"]); await expect(attachEnvironment(root, run.id, envRoot, "env-missing-0000")).rejects.toThrow("Unknown environment");
  });
});

describe("one code folder per paper for external runs", () => {
  const external = async (root: string, paperId = "paper-0001") => createRun(root, { paperId, title: "ACO study", mode: "external", model: "m", maxRounds: 0, tokenCap: 50000, spec, meta });
  it("gives every external run of a paper the same code folder, while each keeps its own history", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperruns-")); dirs.push(root);
    const a = await external(root), b = await external(root), other = await external(root, "paper-0002");
    expect((await lstat(join(root, a.id, "code"))).isSymbolicLink()).toBe(true); expect(await readlink(join(root, a.id, "code"))).toBe(`../_code/paper-0001`);
    await writeCodeFile(root, a.id, "impl.py", "x = 1\n"); expect(await readCodeFile(root, b.id, "impl.py")).toBe("x = 1\n"); expect((await listCodeFiles(root, b.id)).map(f => f.path)).toEqual(["impl.py"]);
    await writeCodeFile(root, b.id, "impl.py", "x = 2\n"); expect(await readCodeFile(root, a.id, "impl.py")).toBe("x = 2\n"); expect(await listCodeFiles(root, other.id)).toEqual([]);
    await updateRun(root, a.id, r => { r.summary = "first run"; }); expect((await readRun(root, b.id)).summary).toBeUndefined(); expect(await readEvents(root, b.id)).not.toEqual(await readEvents(root, a.id));
    const museA = await createRun(root, { paperId: "paper-0001", title: "ACO study", mode: "muse", model: "m", maxRounds: 4, tokenCap: 400000, spec, meta }), museB = await createRun(root, { paperId: "paper-0001", title: "ACO study", mode: "muse", model: "m", maxRounds: 4, tokenCap: 400000, spec, meta });
    expect(await readlink(join(root, museA.id, "code"))).toBe("../_code-muse/paper-0001"); await writeCodeFile(root, museA.id, "muse_impl.py", "m = 1\n"); expect(await readCodeFile(root, museB.id, "muse_impl.py")).toBe("m = 1\n"); expect((await listCodeFiles(root, a.id)).map(f => f.path)).toEqual(["impl.py"]); // two folders at most: one for Muse, one for external agents
    expect(await codeFolderSizes(root, "paper-0001")).toEqual({ muse: 1, external: 1 });
    expect((await listRuns(root)).map(r => r.id).sort()).toEqual([a.id, b.id, other.id, museA.id, museB.id].sort()); expect(sharedCodeDir(root, "paper-0001")).toBe(join(root, "_code", "paper-0001"));
    expect(() => sharedCodeDir(root, "../x")).toThrow("Invalid paper id");
  });
  it("moves runs made before the shared folder into it: the newest keeps its code as the shared folder, older code is kept aside", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperruns-")); dirs.push(root);
    const old = await external(root), recent = await external(root); // start as shared, then rebuild the old layout by hand
    for (const r of [old, recent]) { await rm(join(root, r.id, "code")); await mkdir(join(root, r.id, "code"), { recursive: true }); }
    await rm(join(root, "_code"), { recursive: true, force: true });
    await writeFile(join(root, old.id, "code", "impl.py"), "old\n"); await writeFile(join(root, recent.id, "code", "impl.py"), "new\n"); await writeFile(join(root, recent.id, "code", "extra.py"), "extra\n");
    await updateRun(root, old.id, r => { r.createdAt = "2026-11-03T01:00:00.000Z"; }); await updateRun(root, recent.id, r => { r.createdAt = "2026-11-03T02:00:00.000Z"; });
    await migrateSharedCode(root);
    expect((await readdir(sharedCodeDir(root, "paper-0001"))).sort()).toEqual(["extra.py", "impl.py"]); expect(await readCodeFile(root, old.id, "impl.py")).toBe("new\n");
    expect(await readFile(join(root, old.id, "code-before-shared", "impl.py"), "utf8")).toBe("old\n"); expect((await lstat(join(root, recent.id, "code"))).isSymbolicLink()).toBe(true);
    expect((await readEvents(root, old.id)).at(-1)?.message).toContain("code-before-shared");
    await migrateSharedCode(root); expect(await readCodeFile(root, recent.id, "extra.py")).toBe("extra\n"); // running it again changes nothing
  });
  it("keeps an environment file in the shared folder while another run of the paper still lists it", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperruns-")); dirs.push(root); const envRoot = join(root, "..", `lib-${Math.random().toString(16).slice(2, 6)}`); dirs.push(envRoot);
    const env = await saveEnvironment(envRoot, { name: "Four", description: "", origin: "digitised", source: { note: "Fig. 9a" }, grid: { rows: 4, cols: 4, ascii: ["....", ".##.", "....", "...."] }, start: [0, 0], goal: [3, 3] }, { createdBy: "app" });
    const a = await external(root), b = await external(root); await attachEnvironment(root, a.id, envRoot, env.id); await attachEnvironment(root, b.id, envRoot, env.id);
    await detachEnvironment(root, a.id, env.id); expect((await listCodeFiles(root, b.id)).map(f => f.path)).toContain(`environments/${env.id}.json`);
    await detachEnvironment(root, b.id, env.id); expect((await listCodeFiles(root, b.id)).map(f => f.path)).not.toContain(`environments/${env.id}.json`);
  });
  it.skipIf(!sandboxed)("runs the shared code in the sandbox for each run and keeps each run's results separate", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperruns-")); dirs.push(root); const a = await external(root), b = await external(root);
    await writeCodeFile(root, a.id, "run_tests.py", "import json\njson.dump({'results': [{'id': 'R1', 'reproduced': 23, 'tolerance': 0.2, 'note': 'x'}]}, open('results.json', 'w'))\n");
    expect(await runTests(root, a.id, 1, python)).toMatchObject({ ranTests: true, code: 0 }); expect((await readRun(root, a.id)).results?.[0]).toMatchObject({ id: "R1", status: "match" }); expect((await readRun(root, b.id)).results).toBeUndefined();
    await writeCodeFile(root, b.id, "run_tests.py", "import json\njson.dump({'results': [{'id': 'R1', 'reproduced': 40, 'tolerance': 0.2, 'note': 'y'}]}, open('results.json', 'w'))\n");
    expect(await runTests(root, b.id, 1, python)).toMatchObject({ ranTests: true, code: 0 }); expect((await readRun(root, b.id)).results?.[0]?.status).toBe("mismatch"); expect((await readRun(root, a.id)).results?.[0]?.status).toBe("match");
    expect(JSON.parse(await readFile(join(root, a.id, "rounds/1/compared.json"), "utf8"))[0].status).toBe("match");
  });
  it("links a fresh folder when asked", async () => { const root = await mkdtemp(join(tmpdir(), "paperruns-")); dirs.push(root); const a = await external(root); await rm(join(root, a.id, "code")); await linkSharedCode(root, a.id, "paper-0001"); expect(await readlink(join(root, a.id, "code"))).toBe("../_code/paper-0001"); });
});

describe("the brief's rules about maps", () => {
  const env = (status: "candidate" | "approved") => ({ id: "env-a-1111", name: "Fig 9 simple", version: 1, hash: "h", status, origin: "digitised", kind: "fixed" as const, rows: 4, cols: 4, source: "Fig. 9", file: "environments/env-a-1111.json" });
  it("says in what order to choose a map, that unshown maps are not comparable, and that a candidate cannot be marked comparable", () => {
    const text = environmentsBlock([env("candidate")], { pick: true, create: true });
    expect(text).toContain("HOW TO CHOOSE A MAP, IN THIS ORDER"); expect(text.indexOf("1. Use the attached maps")).toBeLessThan(text.indexOf("2. If none of them fits")); expect(text.indexOf("2. If none of them fits")).toBeLessThan(text.indexOf("3. Create or extend"));
    expect(text).toContain("Results on a map the paper does not show"); expect(text).toContain("must be marked \"comparable\": false until the user approves it"); expect(text).toContain("Do not mark your own digitisation as comparable");
    const approved = environmentsBlock([env("approved")]); expect(approved).toContain("HOW TO CHOOSE A MAP"); expect(approved).not.toContain("are not approved by the user yet");
    expect(environmentsBlock([])).toBe(""); expect(environmentsBlock([], { pick: false, create: false })).toBe("");
  });
  it("tells a run to work in its own code folder, not in a new one, while the Papers tab prompt keeps its wording", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperruns-")); dirs.push(root);
    const run = await createRun(root, { paperId: "paper-0001", title: "ACO study", mode: "external", model: "m", maxRounds: 0, tokenCap: 50000, spec, meta });
    const brief = await readFile(join(root, run.id, "brief.md"), "utf8"); expect(brief).toContain("Work only inside this run's code folder"); expect(brief).not.toContain("Work in a new folder");
    const { codexPrompt } = await import("./knowledgeReplication"); expect(codexPrompt(spec, meta)).toContain("Work in a new folder");
  });
});
