import { describe, expect, it } from "vitest";
import { asciiFromGrid, checkEnvironment, gridFromAscii, instanceSeeds, materializeEnvironment, materializeRandom, mulberry32, shortestRoute, validateEnvironmentInput, validEnvId, type Environment, type EnvironmentInput } from "./environment";
const open = ["....", "....", "....", "...."];
const base = (over: Partial<EnvironmentInput> = {}): EnvironmentInput => ({ name: "Four by four", description: "", origin: "manual", source: { note: "test" }, grid: { rows: 4, cols: 4, ascii: open }, start: [0, 0], goal: [3, 3], ...over });
describe("validateEnvironmentInput", () => {
  it("accepts a fixed grid and cleans text", () => {
    const e = validateEnvironmentInput({ ...base(), name: "  Four   by four ", description: "x".repeat(900) });
    expect(e.name).toBe("Four by four"); expect(e.description).toHaveLength(600); expect(e.grid).toEqual({ rows: 4, cols: 4, ascii: open }); expect(e.start).toEqual([0, 0]);
  });
  it("rejects bad shapes with a message", () => {
    const bad = (over: Record<string, unknown>) => () => validateEnvironmentInput({ ...base(), ...over });
    expect(bad({ name: " " })).toThrow("needs a name"); expect(bad({ origin: "dream" })).toThrow("Unknown origin"); expect(bad({ source: { note: "" } })).toThrow("Say where");
    expect(bad({ grid: { rows: 4, cols: 4, ascii: ["....", "...", "....", "...."] } })).toThrow('use only "#"'); expect(bad({ grid: { rows: 2, cols: 2, ascii: ["..", ".."] } })).toThrow("3 to 120"); expect(bad({ grid: { rows: 4, cols: 4, ascii: ["....", "..x.", "....", "...."] } })).toThrow('use only "#"');
    expect(bad({ start: [9, 9] })).toThrow("outside the map"); expect(bad({ goal: [0.5, 1] })).toThrow("whole numbers"); expect(bad({ targets: [[0, 0]] })).toThrow("2 to 12"); expect(bad({ dynamicObstacles: [[40, 1]] })).toThrow("inside the map");
    expect(() => validateEnvironmentInput({ ...base(), generator: { type: "random-obstacles", rows: 5, cols: 5, density: 0.1 } })).toThrow("not both"); expect(() => validateEnvironmentInput({ ...base(), grid: undefined })).toThrow("needs a grid or a generator");
    expect(() => validateEnvironmentInput("nope")).toThrow("must be an object");
  });
  it("accepts a generator and bounds its parameters", () => {
    const gen = (g: Record<string, unknown>) => validateEnvironmentInput({ ...base(), grid: undefined, start: undefined, goal: undefined, generator: { type: "random-obstacles", rows: 20, cols: 20, density: 0.1, ...g } });
    expect(gen({}).generator).toMatchObject({ rows: 20, cols: 20, density: 0.1, seedBase: 0, start: [0, 0], goal: [19, 19], instances: 30 });
    expect(() => gen({ density: 0.9 })).toThrow("between 0 and 0.6"); expect(() => gen({ instances: 99 })).toThrow("1 to 50"); expect(() => gen({ rows: 500 })).toThrow("3 to 120"); expect(() => gen({ type: "other" })).toThrow('"random-obstacles"');
  });
  it("accepts ids only in the env- slug form", () => { expect(["env-aco-fig9", "env-1", "env-a-b-c"].map(validEnvId)).toEqual([true, true, true]); expect(["env-", "env_x", "../env-x", "ENV-x", "env-x/y", 7].map(validEnvId)).toEqual([false, false, false, false, false, false]); });
});
describe("routes and generation", () => {
  it("finds shortest 8-connected routes without cutting corners", () => {
    expect(shortestRoute(gridFromAscii(open), [0, 0], [3, 3])).toBeCloseTo(3 * Math.SQRT2, 6);
    expect(shortestRoute(gridFromAscii(["..#.", "..#.", "..#.", "..#."]), [0, 0], [3, 3])).toBeNull();
    expect(shortestRoute(gridFromAscii([".#.", "#..", "..."]), [0, 0], [2, 2])).toBeNull();   // the diagonal gap between two blocked cells is not passable
    expect(shortestRoute(gridFromAscii(["#.", ".."]), [0, 0], [1, 1])).toBeNull();
  });
  it("makes the same map for the same seed, different maps for different seeds, and keeps start and goal free", () => {
    const g = { type: "random-obstacles" as const, rows: 20, cols: 20, density: 0.2, seedBase: 7, start: [0, 0] as [number, number], goal: [19, 19] as [number, number], instances: 5 };
    const a = materializeRandom(g, 7), b = materializeRandom(g, 7), c = materializeRandom(g, 8);
    expect(a).toEqual(b); expect(a).not.toEqual(c); expect(a[0]![0]).toBe("."); expect(a[19]![19]).toBe("."); expect(a[1]![1]).toBe(".");
    const dens = (m: string[]) => (m.join("").split("#").length - 1) / 400; expect(Math.abs(dens(a) - 0.2)).toBeLessThan(0.06);
    expect(instanceSeeds(g)).toEqual([7, 8, 9, 10, 11]); expect(asciiFromGrid(gridFromAscii(a))).toEqual(a);
    expect(mulberry32(1)()).toBe(mulberry32(1)()); expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it("gives up with a message when no connected map can be made", () => {
    expect(() => materializeRandom({ type: "random-obstacles", rows: 12, cols: 12, density: 0.6, seedBase: 0, start: [0, 0], goal: [11, 11], instances: 1 }, 0)).toThrow("No connected map");
  });
});
describe("checkEnvironment", () => {
  it("passes an open route, fails a walled-off one, and checks every leg of a target route", () => {
    expect(checkEnvironment(validateEnvironmentInput(base()), "t")).toMatchObject({ solvable: true, checkedAt: "t" });
    const walled = checkEnvironment(validateEnvironmentInput(base({ grid: { rows: 4, cols: 4, ascii: ["..#.", "..#.", "..#.", "..#."] } })));
    expect(walled.solvable).toBe(false); expect(walled.notes.join(" ")).toContain("has no route");
    const legs = checkEnvironment(validateEnvironmentInput(base({ start: undefined, goal: undefined, targets: [[0, 0], [3, 0], [3, 3]] })));
    expect(legs.solvable).toBe(true); expect(legs.notes.filter(n => n.startsWith("Leg"))).toHaveLength(2);
    expect(checkEnvironment(validateEnvironmentInput(base({ start: undefined, goal: undefined }))).notes.join(" ")).toContain("No start and goal");
  });
  it("checks a generator by materialising its first seeds", () => {
    const ok = checkEnvironment(validateEnvironmentInput({ ...base(), grid: undefined, start: undefined, goal: undefined, generator: { type: "random-obstacles", rows: 20, cols: 20, density: 0.1 } }));
    expect(ok).toMatchObject({ solvable: true }); expect(ok.notes[0]).toContain("first 10 seeds all give connected maps");
  });
});
describe("materializeEnvironment", () => {
  const env = (input: EnvironmentInput): Environment => ({ ...input, id: "env-x", status: "approved", version: 2, hash: "h", checks: { solvable: true, notes: [], checkedAt: "t" }, createdBy: "app", createdAt: "t", updatedAt: "t" });
  it("hands a fixed map over as it is, with provenance", () => {
    const m = materializeEnvironment(env(validateEnvironmentInput(base({ assumptions: ["a"] }))));
    expect(m).toMatchObject({ id: "env-x", version: 2, hash: "h", kind: "fixed", rows: 4, cols: 4, ascii: open, start: [0, 0], goal: [3, 3], status: "approved", assumptions: ["a"], source: { note: "test" } }); expect(m.instances).toBeUndefined();
  });
  it("writes a generator out as numbered instances so every language sees identical maps", () => {
    const m = materializeEnvironment(env(validateEnvironmentInput({ ...base(), grid: undefined, start: undefined, goal: undefined, generator: { type: "random-obstacles", rows: 12, cols: 12, density: 0.1, seedBase: 100, instances: 3 } })));
    expect(m.kind).toBe("instances"); expect(m.instances!.map(i => i.seed)).toEqual([100, 101, 102]); expect(m.instances![0]!.ascii).toHaveLength(12); expect(m.ascii).toBeUndefined(); expect(m.start).toEqual([0, 0]); expect(m.goal).toEqual([11, 11]);
  });
});
