import { describe, expect, it } from "vitest";
import { classify, computeLabel, implementationStatus } from "./labelRule";
import { addItem, makeItem } from "./store";
import { ContradictionError, itemErrors } from "./validate";
import { emptyState, type Item, type LabState } from "./types";

describe("label rule (provenance)", () => {
  it("cited spans give reproduced, none give new, whatever the implementation", () => {
    expect(computeLabel({ citedSpans: ["S2"] })).toBe("reproduced");
    expect(computeLabel({ citedSpans: [] })).toBe("new");
  });
});

describe("implementation status", () => {
  it("is runnable only with a registered implementation", () => {
    expect(implementationStatus({ implementation: "chm-smoothing" })).toBe("runnable");
    expect(implementationStatus({ implementation: "none" })).toBe("spec-only");
    expect(implementationStatus({})).toBe("spec-only");
    expect(implementationStatus({ implementation: "not-in-registry" })).toBe("spec-only");
  });

  it("is independent of the label: all four combinations occur", () => {
    expect(classify({ citedSpans: ["S8"], implementation: "none" })).toEqual({ label: "reproduced", status: "spec-only" });
    expect(classify({ citedSpans: ["S2"], implementation: "chm-smoothing" })).toEqual({ label: "reproduced", status: "runnable" });
    expect(classify({ citedSpans: [], implementation: "two-opt-refinement" })).toEqual({ label: "new", status: "runnable" });
    expect(classify({ citedSpans: [], implementation: "none" })).toEqual({ label: "new", status: "spec-only" });
  });

  it("spec only never becomes the stored label", () => {
    const item = makeItem({ batchId: "b", type: "unit", title: "U6", citedSpans: ["S8"], implementation: "none" });
    expect(item.label).toBe("reproduced");
    expect(itemErrors({ ...item, label: "spec-only" as never })[0]).toMatch(/contradicts the label rule/);
  });
});

describe("contradiction rejection", () => {
  const state = (): LabState => ({ ...emptyState(), batches: [{ id: "b", name: "B", kind: "paper", source: "x", createdAt: "2026-01-01T00:00:00Z" }] });
  const good = (): Item => makeItem({ batchId: "b", type: "unit", title: "U1", citedSpans: ["S1"], implementation: "chm-smoothing" });

  it("computes the label when an item is made, and new items start review pending with the check not run", () => {
    const item = good();
    expect(item.label).toBe("reproduced");
    expect(item).toMatchObject({ review: "pending", citationCheck: "not-run" });
  });

  it("refuses a typed label", () => {
    expect(() => makeItem({ batchId: "b", type: "unit", title: "U1", label: "new" } as never)).toThrow(/cannot be set/);
  });

  it("rejects an item whose stored label contradicts the rule", () => {
    const bad: Item = { ...good(), label: "new" };
    expect(itemErrors(bad)[0]).toMatch(/contradicts the label rule/);
    expect(() => addItem(state(), bad)).toThrow(ContradictionError);
  });

  it("rejects a reproduced label on a unit that cites nothing", () => {
    expect(() => addItem(state(), { ...good(), citedSpans: [] })).toThrow(ContradictionError);
  });

  it("rejects an unregistered implementation and a label on a non-unit", () => {
    expect(itemErrors({ ...good(), implementation: "made-up" })[0]).toMatch(/not in the registry/);
    const note = makeItem({ batchId: "b", type: "note", title: "n" });
    expect(itemErrors({ ...note, label: "new" })[0]).toMatch(/only units carry a label/);
  });

  it("keeps the state unchanged when an item is rejected", () => {
    const s = state();
    expect(() => addItem(s, { ...good(), label: "new" })).toThrow();
    expect(s.items).toHaveLength(0);
  });
});
