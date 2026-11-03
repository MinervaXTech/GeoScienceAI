// @vitest-environment node
import { expect, it } from "vitest";
import { codexPrompt, replicationMarkdown, validateReplicationSpec, type SpecMeta } from "./knowledgeReplication";
const paper = ["Improved ACO", "We set the colony size to 50 ants and the evaporation rate to 0.15.", "\f", "In a 20*20 grid map, the improved strategy achieved convergence in the 23rd iteration.", "Eq. (1) tau0 = 0.09 * |x-y|"].join("\n");
const meta: SpecMeta = { title: "ACO study", year: 2025, doi: "10.1/x", model: "muse-wonder-1.0", builtAt: "2026-11-03T10:00:00.000Z" };
const raw = {
  goal: "Reproduce the improved ACO.",
  steps: [{ n: 9, name: "Initialise", description: "Set pheromones.", quote: "colony size to 50 ants" }, { name: "Search", description: "Ants search.", quote: "a quote that is not in the paper" }, { name: "", description: "" }],
  equations: [{ label: "Eq. (1)", latex: "\\tau_0 = 0.09", text: "tau0 = 0.09 * |x-y|", step: 1 }, { label: "Eq. (2)", latex: "x", text: "x", step: 99 }],
  parameters: [{ name: "colony size", value: "50 ants", unit: "", meaning: "number of ants", quote: "We set the colony size to 50 ants and the evaporation rate to 0.15." }, { name: "rate", value: "0.99", unit: "", meaning: "invented", quote: "the evaporation rate to 0.15" }, { name: "x", value: "7", quote: "no such quote" }, { name: "", value: "1" }],
  environment: [{ item: "map", value: "20*20 grid map", quote: "In a 20*20 grid map" }],
  evaluation: { metrics: [{ name: "path length", definition: "length" }, { name: "" }], baselines: ["basic ACO", ""], datasets: [{ name: "grid", description: "20 by 20" }], protocol: "30 runs" },
  reportedResults: [{ description: "convergence", value: "23rd iteration", condition: "20*20", quote: "achieved convergence in the 23rd iteration" }],
  gaps: [{ kind: "figure_only", description: "map layouts", impact: "high", assumption: { proposal: "digitise", rationale: "closest" } }, { kind: "weird", description: "other thing", impact: "huge", assumption: {} }, { description: "" }],
};
it("keeps only quotes found in the paper and marks a value verified only when it sits inside its quote", () => {
  const spec = validateReplicationSpec(raw, paper);
  expect(spec.steps.map(s => [s.n, s.name, s.verified])).toEqual([[1, "Initialise", true], [2, "Search", false]]);
  expect(spec.steps[1]!.quote).toBe("");
  expect(spec.parameters.map(p => [p.name, p.verified])).toEqual([["colony size", true], ["rate", false], ["x", false]]);
  expect(spec.parameters[1]!.quote).toBe("the evaporation rate to 0.15");
  expect(spec.reportedResults[0]).toMatchObject({ verified: true, page: 2 });
  expect(spec.environment[0]!.verified).toBe(true);
});
it("repairs odd gap fields, drops empty items, and ignores an equation's step when it is out of range", () => {
  const spec = validateReplicationSpec(raw, paper);
  expect(spec.gaps.map(g => [g.id, g.kind, g.impact])).toEqual([["G1", "figure_only", "high"], ["G2", "other", "medium"]]);
  expect(spec.equations[0]).toMatchObject({ step: 1, page: 2 }); expect(spec.equations[1]).not.toHaveProperty("step");
  expect(spec.evaluation.metrics).toEqual([{ name: "path length", definition: "length" }]); expect(spec.evaluation.baselines).toEqual(["basic ACO"]);
  expect(() => validateReplicationSpec("nope", paper)).toThrow("Invalid reproduction spec");
  expect(validateReplicationSpec({}, paper)).toMatchObject({ steps: [], parameters: [], gaps: [] });
});
it("renders Markdown that separates verified items from unverified ones and assumptions", () => {
  const spec = validateReplicationSpec(raw, paper), md = replicationMarkdown(spec, meta);
  expect(md).toContain("# Reproduction spec: ACO study"); expect(md).toContain("muse-wonder-1.0"); expect(md).toContain("2025"); expect(md).toContain("DOI 10.1/x");
  expect(md).toMatch(/\| colony size \| 50 ants \|.*✔/); expect(md).toMatch(/\| rate \| 0.99 \|.*⚠ not verified/);
  expect(md).toContain("$\\tau_0 = 0.09$"); expect(md).toContain("as extracted: `tau0 = 0.09 * |x-y|`");
  expect(md).toMatch(/G1 \| figure only \| high \| map layouts \| digitise \(closest\)/); expect(md).toContain("Approve or change each assumption");
});
it("writes a Codex brief with rules, traceability, targets and every gap's assumption", () => {
  const p = codexPrompt(validateReplicationSpec(raw, paper), meta);
  expect(p).toContain('TASK: Re-implement the method of "ACO study" (2025)'); expect(p).toContain("Do not commit"); expect(p).toContain("Never invent a value the spec does not give");
  expect(p).toContain("- colony size = 50 ants"); expect(p).toContain("- rate = 0.99"); expect(p).toContain("[not verified in the paper text]");
  expect(p).toContain("- R1: convergence = 23rd iteration (20*20)"); expect(p).toContain("G1 [high] map layouts ASSUMPTION: digitise (closest)");
  expect(p).toMatch(/FINAL REPORT:.*reported vs reproduced/);
});
