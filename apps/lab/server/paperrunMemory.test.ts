// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, readRun, updateRun } from "./paperrunCore";
import { backfillMemory, LEDGER_KEPT, MEMORY_MAX_CHARS, memoryText, readMemory, recordRunMemory } from "./paperrunMemory";
import { continuationText } from "./paperrunPipeline";
import { validateReplicationSpec } from "./knowledgeReplication";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const paper = "We set the colony size to 50 ants. In a 20*20 grid map the improved strategy converged in the 23rd iteration. Path accuracy was 94.64%.";
const spec = validateReplicationSpec({ goal: "g", steps: [{ name: "s", description: "d", quote: "colony size to 50 ants" }], parameters: [{ name: "ants", value: "50", quote: "colony size to 50 ants" }], reportedResults: [{ description: "iterations", value: "23rd iteration", quote: "23rd iteration" }], gaps: [{ kind: "missing_value", description: "seeds", impact: "high", assumption: { proposal: "0-29", rationale: "r" } }] }, paper);
const meta = { title: "ACO study", model: "m", builtAt: "2026-11-03T10:00:00.000Z" };
const finished = async (root: string, mode: "muse" | "external", n: number, summary = "") => {
  const run = await createRun(root, { paperId: "paper-0001", title: "ACO study", mode, model: "m", maxRounds: 0, tokenCap: 50000, spec, meta }, new Date(Date.UTC(2026, 10, 3, 1, n)));
  await updateRun(root, run.id, r => { r.status = "done"; r.updatedAt = new Date(Date.UTC(2026, 10, 3, 1, n)).toISOString(); r.finishNote = summary; r.review = "[high] R1 is simplified.\n[low] minor wording"; r.results = [{ id: "R1", description: "iterations", reported: "23", reproduced: "24", relError: 0.04, tolerance: 0.1, status: "within_tolerance", note: "" }]; });
  return run.id;
};
describe("replication memory", () => {
  it("records one ledger line per finished run, replaces a run's own line, and skips runs that are not finished", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperruns-")); dirs.push(root);
    const a = await finished(root, "muse", 1, "Muse built the first version."), pending = await createRun(root, { paperId: "paper-0001", title: "ACO study", mode: "external", model: "m", maxRounds: 0, tokenCap: 50000, spec, meta });
    expect(await recordRunMemory(root, pending.id)).toBeNull();
    await recordRunMemory(root, a); await recordRunMemory(root, a);
    const memory = (await readMemory(root, "paper-0001"))!; expect(memory.entries).toHaveLength(1); expect(memory.entries[0]).toMatchObject({ runId: a, mode: "muse", counts: { within_tolerance: 1 }, summary: "Muse built the first version." });
    expect(memory.decisions).toEqual(["G1: 0-29"]); expect(memory.open?.concerns[0]).toBe("[high] R1 is simplified.");
  });
  it("stays short however many runs there are, folding old runs into one line", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperruns-")); dirs.push(root);
    for (let n = 0; n < 15; n++) await recordRunMemory(root, await finished(root, n % 2 ? "external" : "muse", n, `Run ${n} changed ${"many things ".repeat(60)}`));
    const memory = (await readMemory(root, "paper-0001"))!, text = memoryText(memory);
    expect(memory.entries).toHaveLength(15); expect(text.length).toBeLessThanOrEqual(MEMORY_MAX_CHARS); expect(text).toContain("REPLICATION MEMORY (15 earlier runs"); expect(text).toContain(`Earlier: ${15 - LEDGER_KEPT} runs`);
    expect(text.split("\n").filter(l => /^- \d{4}-/.test(l))).toHaveLength(LEDGER_KEPT); expect(text).toContain("Open problems after the latest run");
    expect(memoryText(null)).toBe("");
  });
  it("builds the memory for runs made before memories existed, and leaves an existing memory alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperruns-")); dirs.push(root);
    const a = await finished(root, "muse", 1), b = await finished(root, "external", 2);
    await backfillMemory(root); expect((await readMemory(root, "paper-0001"))!.entries.map(e => e.runId)).toEqual([a, b]);
    await finished(root, "external", 3); await backfillMemory(root); expect((await readMemory(root, "paper-0001"))!.entries).toHaveLength(2);
  });
  it("can leave out its next steps, so a brief that lists them itself does not say them twice", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperruns-")); dirs.push(root); await recordRunMemory(root, await finished(root, "external", 1));
    const memory = await readMemory(root, "paper-0001"); expect(memoryText(memory)).toContain("Next steps:"); const short = memoryText(memory, { next: false }); expect(short).not.toContain("Next steps:"); expect(short).toContain("[high] R1 is simplified.");
  });
  it("puts the memory in what a continuing run is told", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperruns-")); dirs.push(root);
    const a = await finished(root, "external", 1, "Fixed the smoothness metric."); await recordRunMemory(root, a);
    const text = continuationText({ memory: memoryText(await readMemory(root, "paper-0001")), parentId: a, title: "ACO study", run: await readRun(root, a), spec, files: [{ path: "impl.py", bytes: 1 }] });
    expect(text).toContain("ONE CODE FOLDER PER PAPER"); expect(text).toContain("REPLICATION MEMORY"); expect(text).toContain("Fixed the smoothness metric.");
  });
});
