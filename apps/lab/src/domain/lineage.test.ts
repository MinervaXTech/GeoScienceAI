import { describe, expect, it } from "vitest";
import { buildLineage, litKeys, paperBatches } from "./lineage";
import { loadSampleData } from "./sample";
import { emptyState } from "./types";

const state = loadSampleData(emptyState());
const lin = buildLineage(state, "sample-batch-paper-a")!;

describe("lineage", () => {
  it("is derived from the stored items", () => {
    expect(paperBatches(state).map((b) => b.id)).toEqual(["sample-batch-paper-a", "sample-batch-paper-b"]);
    expect(lin.summary).toBe("9 spans, 6 cited, 7 units, 2 snapshots");
    expect(lin.spans.filter((s) => s.cited).map((s) => s.id)).toEqual(["S2", "S3", "S4", "S5", "S6", "S8"]);
  });

  it("has one span-to-unit edge per citation and one unit-to-snapshot edge per snapshot member", () => {
    const cites = state.items.filter((i) => i.type === "unit" && i.batchId === "sample-batch-paper-a").reduce((n, u) => n + u.citedSpans.length, 0);
    expect(lin.edges.filter((e) => e.kind === "span-unit")).toHaveLength(cites);
    expect(lin.edges.filter((e) => e.kind === "unit-snap")).toHaveLength(4 + 6);
  });

  it("puts units that cite nothing in a separate New group below the cited ones", () => {
    const cited = lin.units.filter((u) => !u.isNew), fresh = lin.units.filter((u) => u.isNew);
    expect(fresh.map((u) => u.item.id)).toEqual(["sample-u5", "sample-u7"]);
    expect(lin.newHeaderY).not.toBeNull();
    expect(Math.min(...fresh.map((u) => u.y))).toBeGreaterThan(Math.max(...cited.map((u) => u.y)));
  });

  it("changes when an item changes, so it is not a separate store", () => {
    const edited = { ...state, items: state.items.map((i) => (i.id === "sample-u7" ? { ...i, citedSpans: ["S9"], label: "reproduced" as const } : i)) };
    const l2 = buildLineage(edited, "sample-batch-paper-a")!;
    expect(l2.spans.find((s) => s.id === "S9")!.cited).toBe(true);
    expect(l2.edges.length).toBe(lin.edges.length + 1);
  });

  it("lights the connected spans, units and snapshots when a node is chosen", () => {
    const u6 = litKeys(lin, "unit:sample-u6")!;
    expect([...u6].sort()).toEqual(["snap:sample-snap-b", "span:S8", "unit:sample-u6"]);
    const s2 = litKeys(lin, "span:S2")!;
    expect(s2.has("unit:sample-u1") && s2.has("snap:sample-snap-a") && s2.has("snap:sample-snap-b")).toBe(true);
    expect(litKeys(lin, undefined)).toBeUndefined();
  });

  it("returns nothing for a batch with no paper", () => {
    expect(buildLineage(state, "sample-batch-session-3")).toBeUndefined();
  });
});
