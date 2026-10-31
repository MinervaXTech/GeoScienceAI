import { beforeAll, describe, expect, it } from "vitest";
import { applyFilters, batchOverview, noFilters, queryItems, sortItems, sortText, type Filters, type SortKey } from "./query";
import { loadSampleData } from "./sample";
import { emptyState, type Item, type LabState } from "./types";

let state: LabState;
beforeAll(() => {
  state = loadSampleData(emptyState());
});

const keyOf: Record<SortKey, (i: Item) => string | number> = {
  type: (i) => ["paper", "unit", "finding", "snapshot", "note"].indexOf(i.type),
  title: (i) => i.title,
  label: (i) => (i.label ? ["reproduced", "new"].indexOf(i.label) : 99),
  impl: (i) => (i.type !== "unit" ? 99 : i.implementation && i.implementation !== "none" ? 0 : 1),
  verdict: (i) => ["fail", "pass", "not-run"].indexOf(i.citationCheck),
  review: (i) => ["pending", "reviewed"].indexOf(i.review),
  updated: (i) => Date.parse(i.updatedAt),
};

describe("sorting", () => {
  for (const key of Object.keys(keyOf) as SortKey[]) {
    it(`sorts by ${key} in both directions`, () => {
      for (const dir of ["asc", "desc"] as const) {
        const rows = sortItems(state.items, { key, dir });
        expect(rows).toHaveLength(state.items.length);
        for (let i = 1; i < rows.length; i++) {
          const a = keyOf[key](rows[i - 1]!), b = keyOf[key](rows[i]!);
          const cmp = key === "title" ? String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }) : Number(a) - Number(b);
          expect(dir === "asc" ? cmp <= 0 : cmp >= 0).toBe(true);
        }
      }
    });
  }

  it("keeps equal rows in their original order in both directions", () => {
    for (const dir of ["asc", "desc"] as const) {
      const rows = sortItems(state.items, { key: "review", dir });
      for (const review of ["pending", "reviewed"] as const) {
        const got = rows.filter((r) => r.review === review).map((r) => r.id);
        const want = state.items.filter((r) => r.review === review).map((r) => r.id);
        expect(got).toEqual(want);
      }
    }
  });

  it("sorting twice gives the same order, and does not mutate the input", () => {
    const before = state.items.map((i) => i.id);
    const once = sortItems(state.items, { key: "verdict", dir: "asc" });
    expect(sortItems(once, { key: "verdict", dir: "asc" }).map((i) => i.id)).toEqual(once.map((i) => i.id));
    expect(state.items.map((i) => i.id)).toEqual(before);
  });

  it("puts FAIL first when verdict is ascending, as the sort chip says", () => {
    expect(sortItems(state.items, { key: "verdict", dir: "asc" })[0]!.citationCheck).toBe("fail");
    expect(sortText({ key: "verdict", dir: "asc" })).toBe("Sort: Citation check, FAIL first");
  });
});

describe("filters and search", () => {
  const ids = (f: Filters) => applyFilters(state.items, f).map((i) => i.id);

  it("combines filters with AND", () => {
    const fail = ids({ ...noFilters(), verdict: "fail" });
    const failPaperA = ids({ ...noFilters(), verdict: "fail", batch: "sample-batch-paper-a" });
    const failPendingSpec = ids({ ...noFilters(), verdict: "fail", review: "pending", impl: "spec-only", type: "unit" });
    expect(fail.length).toBeGreaterThan(failPaperA.length);
    expect(failPaperA).toEqual(["sample-u6"]);
    expect(failPendingSpec.every((id) => fail.includes(id))).toBe(true);
    expect(ids({ ...noFilters(), verdict: "pass", label: "new" })).toEqual([]);
    // Label and implementation filters are independent axes: reproduced AND spec only is a real combination.
    expect(ids({ ...noFilters(), label: "reproduced", impl: "spec-only" })).toEqual(expect.arrayContaining(["sample-u6", "sample-gap"]));
    expect(ids({ ...noFilters(), label: "new", impl: "runnable" })).toEqual(["sample-u5"]);
    expect(ids({ ...noFilters(), label: "none" }).length).toBe(state.items.filter((i) => i.type !== "unit").length);
    expect(ids({ ...noFilters(), impl: "na" }).length).toBe(state.items.filter((i) => i.type !== "unit").length);
  });

  it("searches titles and body text, ignoring case, and combines with filters", () => {
    expect(ids({ ...noFilters(), search: "WIND" })).toEqual(expect.arrayContaining(["sample-u6", "sample-s2-wind"]));
    expect(ids({ ...noFilters(), search: "no wind source" })).toEqual(["sample-s2-wind"]);
    expect(ids({ ...noFilters(), search: "wind", batch: "sample-batch-paper-a" })).toEqual(["sample-paper-a", "sample-u6"]);
    expect(ids({ ...noFilters(), search: "zzz-nothing" })).toEqual([]);
  });

  it("reports shown and total", () => {
    const q = queryItems(state, { ...noFilters(), batch: "sample-batch-paper-a" }, undefined);
    expect(q.shown).toBe(11);
    expect(q.total).toBe(23);
  });
});

describe("batch overview", () => {
  it("counts equal the table count once the segment's filter is applied", () => {
    for (const batch of [undefined, ...state.batches.map((b) => b.id)]) {
      const o = batchOverview(state.items, batch);
      const count = (f: Partial<Filters>) => queryItems(state, { ...noFilters(), ...(batch ? { batch } : {}), ...f }, undefined).shown;
      expect(o.total).toBe(count({}));
      for (const [k, n] of Object.entries(o.label)) expect(count({ label: k as never })).toBe(n);
      for (const [k, n] of Object.entries(o.impl)) expect(count({ impl: k as never })).toBe(n);
      expect(o.label.reproduced + o.label.new).toBe(o.units);
      expect(o.impl.runnable + o.impl["spec-only"]).toBe(o.units);
      for (const [k, n] of Object.entries(o.verdict)) expect(count({ verdict: k as never })).toBe(n);
      for (const [k, n] of Object.entries(o.review)) expect(count({ review: k as never })).toBe(n);
      expect(o.verdict.pass + o.verdict.fail + o.verdict["not-run"]).toBe(o.total);
      expect(o.review.pending + o.review.reviewed).toBe(o.total);
    }
  });
});
