import { describe, expect, it } from "vitest";
import { parseStepCoverage, replicationScore, scoreSentences } from "./replicationScore";
const rows = (...statuses: string[]) => statuses.map(status => ({ status }));
describe("replication score", () => {
  it("counts results near the paper's both ways: of all results, and of the ones that could be compared", () => {
    const s = replicationScore(rows("match", "within_tolerance", "within_tolerance", "mismatch", "mismatch", "mismatch", "not_comparable", "not_run"), 0);
    expect(s).toMatchObject({ total: 8, comparable: 6, withinPercent: 38, comparablePercent: 50, counts: { match: 1, within_tolerance: 2, mismatch: 3, not_comparable: 1, not_run: 1 } });
    expect(replicationScore(rows("not_comparable", "not_run"), 0)).toMatchObject({ withinPercent: 0, comparablePercent: null, comparable: 0 });
    expect(replicationScore([], 0)).toMatchObject({ total: 0, withinPercent: null });
  });
  it("measures method coverage from Muse's per-step verdicts, counting partial steps as half", () => {
    const cover = [{ n: 1, status: "implemented", note: "" }, { n: 2, status: "partial", note: "" }, { n: 3, status: "missing", note: "" }, { n: 4, status: "implemented", note: "" }] as const;
    expect(replicationScore([], 5, [...cover]).steps).toEqual({ total: 5, implemented: 2, partial: 1, missing: 1, unassessed: 1, percent: 50 });
    expect(replicationScore([], 5).steps).toMatchObject({ percent: null, unassessed: 5 }); expect(replicationScore([], 0, [...cover]).steps.percent).toBeNull();
  });
  it("keeps only valid, unique coverage entries for steps that exist", () => {
    expect(parseStepCoverage([{ n: 2, status: "partial", note: "  simplified   a lot " }, { n: 1, status: "implemented" }, { n: 1, status: "missing" }, { n: 9, status: "implemented" }, { n: 3, status: "great" }, { n: 0, status: "missing" }, { n: 2.5, status: "missing" }, "x", null], 4)).toEqual([{ n: 1, status: "implemented", note: "" }, { n: 2, status: "partial", note: "simplified a lot" }]);
    expect(parseStepCoverage("nope", 4)).toEqual([]);
  });
  it("states the facts in plain sentences without a grade", () => {
    const s = scoreSentences(replicationScore(rows("match", "within_tolerance", "mismatch", "mismatch", "not_comparable", "not_run"), 4, [{ n: 1, status: "implemented", note: "" }, { n: 2, status: "partial", note: "" }, { n: 3, status: "missing", note: "" }]));
    expect(s).toEqual(["2 of 6 reported results (33%) are within 10% of the paper's numbers, 1 of them within 2%.", "Of the 4 that could be compared, 2 (50%) are near the paper's value and 2 are not.", "1 were measured on different data or settings and are not comparable and 1 could not be run.", "1 of 4 method steps are implemented, 1 partly, 1 missing, 1 not assessed (about 38% of the method), as judged by Muse's review."]);
    expect(scoreSentences(replicationScore(rows("not_comparable"), 3))).toEqual(["0 of 1 reported results (0%) are within 10% of the paper's numbers.", "None of the results could be compared with the paper's numbers.", "1 were measured on different data or settings and are not comparable.", "Method coverage has not been assessed (3 steps in the spec)."]);
    expect(scoreSentences(replicationScore([], 0))).toEqual(["No results have been compared yet."]);
  });
});

import { assessReplication, ratingTone, type GapInfo } from "./replicationScore";
const cover = (implemented: number, partial: number, missing: number) => [...Array(implemented).fill("implemented"), ...Array(partial).fill("partial"), ...Array(missing).fill("missing")].map((status, i) => ({ n: i + 1, status, note: status === "implemented" ? "" : `note ${i + 1}` })) as never;
const res = (...statuses: string[]) => statuses.map((status, i) => ({ id: `R${i + 1}`, status, relError: status === "mismatch" ? 0.1 * (i + 1) : 0.01 }));
const gaps: GapInfo[] = [{ id: "G8", kind: "figure_only", impact: "high", description: "Exact obstacle layouts are only in figures, not coordinates." }, { id: "G2", kind: "ambiguous_step", impact: "high", description: "Eq. (2) integrals are garbled." }, { id: "G10", kind: "randomness", impact: "medium", description: "Seeds not reported." }];
describe("assessment", () => {
  it("rates by explicit thresholds on method coverage and comparable results, and caps replicated when data is missing", () => {
    const rate = (m: [number, number, number], r: string[], g: GapInfo[] = []) => assessReplication({ results: res(...r), stepCount: m[0] + m[1] + m[2], coverage: cover(...m), gaps: g, concerns: [] }).rating;
    expect(rate([10, 0, 0], Array(10).fill("match"))).toBe("replicated"); expect(rate([10, 0, 0], Array(10).fill("match"), gaps)).toBe("close");
    expect(rate([8, 2, 0], ["match", "match", "match", "mismatch"])).toBe("close"); expect(rate([6, 4, 0], ["match", "match", "mismatch", "mismatch"])).toBe("partial");
    expect(rate([2, 11, 0], ["within_tolerance", "mismatch", "mismatch"])).toBe("early"); expect(rate([0, 4, 6], ["mismatch", "mismatch", "mismatch", "mismatch"])).toBe("not_replicated");
    expect(assessReplication({ results: res("match"), stepCount: 4, gaps: [], concerns: [] }).rating).toBe("unrated");
    expect(["replicated", "close", "partial", "early", "not_replicated", "unrated"].map(r => ratingTone(r as never))).toEqual(["ok", "ok", "busy", "bad", "bad", "idle"]);
  });
  it("explains the rating with facts and gives prioritised actions for the ACO-like case", () => {
    const within = new Set([0, 2, 5, 8, 10, 12]), statuses = Array.from({ length: 17 }, (_, i) => i === 16 ? "not_run" : within.has(i) ? "within_tolerance" : "mismatch");
    const a = assessReplication({ results: res(...statuses), stepCount: 13, coverage: cover(2, 11, 0), gaps, concerns: ["[high] Eq. 1 was altered in the code.", "[medium] minor", "[high] Seeds repeat."] });
    expect(a.rating).toBe("early"); expect(a.label).toBe("Early attempt");
    expect(a.reasons).toEqual(["58% of the method is implemented (2 of 13 steps fully, 11 partly).", "38% of the 16 comparable results are within 10% of the paper (6 of 16).", "Only 94% of the reported results could be compared at all (0 measured on different data, 1 not run).", "The paper does not give data that high-impact gaps depend on (G8), so even matching numbers cannot fully confirm replication.", "The review raised 2 high-severity concerns."]);
    expect(a.actions.map(x => [x.priority, x.kind])).toEqual([["high", "data"], ["high", "code"], ["high", "honesty"], ["high", "honesty"], ["medium", "measure"], ["medium", "measure"], ["medium", "rerun"], ["medium", "verify"], ["low", "measure"]]);
    expect(a.actions[0]!.text).toContain("(G8)"); expect(a.actions[1]!.text).toContain("Fix 11 steps that are only partly implemented or missing (steps 3, 4, 5, 6, 7, 8, …)"); expect(a.actions[4]!.text).toContain("Investigate 10 mismatches, largest first: R16 (160% off), R15 (150% off), R14 (140% off), R12 (120% off)."); expect(a.actions[5]!.text).toContain("R17 produced no result"); expect(a.actions[2]!.text).toContain("Eq. 1 was altered");
  });
  it("asks to assess coverage first when it is missing, and does not nag about rerunning once results are flagged", () => {
    const a = assessReplication({ results: res("match", "not_comparable"), stepCount: 3, gaps, concerns: [] });
    expect(a.actions[0]).toMatchObject({ priority: "high", kind: "assess" }); expect(a.actions.some(x => x.kind === "rerun")).toBe(false);
    expect(assessReplication({ results: [], stepCount: 0, gaps: [], concerns: [] })).toMatchObject({ rating: "unrated", reasons: ["Method coverage has not been assessed, so the method cannot be rated yet.", "No results have been compared yet."], actions: [] });
  });
});

describe("next steps when maps are already attached", () => {
  const res = (...statuses: string[]) => statuses.map((status, i) => ({ id: `R${i + 1}`, status }));
  it("replaces 'supply the missing data' by checking the attached maps, at medium priority", () => {
    const without = assessReplication({ results: res("not_comparable"), stepCount: 2, gaps, concerns: [] }).actions.find(a => a.kind === "data")!;
    expect(without).toMatchObject({ priority: "high" }); expect(without.text).toContain("Supply the missing data (G8)");
    const withMaps = assessReplication({ results: res("not_comparable"), stepCount: 2, gaps, concerns: [], mapsAttached: 5 }).actions.find(a => a.kind === "data")!;
    expect(withMaps).toMatchObject({ priority: "medium" }); expect(withMaps.text).not.toContain("Supply the missing data"); expect(withMaps.text).toContain("5 digitised maps are attached"); expect(withMaps.text).toContain("only if you find an error"); expect(withMaps.text).toContain("not approved");
    expect(assessReplication({ results: res("not_comparable"), stepCount: 2, gaps, concerns: [], mapsAttached: 1 }).actions.find(a => a.kind === "data")!.text).toContain("1 digitised map is attached: check it against the figures and use it");
  });
});
