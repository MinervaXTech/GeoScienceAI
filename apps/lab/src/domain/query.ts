import { implementationStatus } from "./labelRule";
import type { CitationCheck, ImplStatus, Item, ItemType, Label, LabState, Review } from "./types";

export type SortKey = "type" | "title" | "label" | "verdict" | "impl" | "review" | "updated";
export type SortDir = "asc" | "desc";
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

/** `none` on label means "has no label" (not a unit); `na` on impl means "not a unit". */
export interface Filters {
  type?: ItemType;
  label?: Label | "none";
  verdict?: CitationCheck;
  impl?: ImplStatus | "na";
  review?: Review;
  batch?: string;
  search: string;
}

export const noFilters = (): Filters => ({ search: "" });

/** The unit's implementation status, or undefined for items that are not units. */
export const statusOf = (i: Item): ImplStatus | undefined => (i.type === "unit" ? implementationStatus(i) : undefined);

const TYPE_ORDER: ItemType[] = ["paper", "unit", "finding", "snapshot", "note"];
const LABEL_ORDER: (Label | undefined)[] = ["reproduced", "new", undefined];
const IMPL_ORDER: (ImplStatus | undefined)[] = ["runnable", "spec-only", undefined];
const VERDICT_ORDER: CitationCheck[] = ["fail", "pass", "not-run"];
const REVIEW_ORDER: Review[] = ["pending", "reviewed"];

const rank = <T,>(order: readonly T[], v: T) => order.indexOf(v);

function compare(key: SortKey, a: Item, b: Item): number {
  switch (key) {
    case "type":
      return rank(TYPE_ORDER, a.type) - rank(TYPE_ORDER, b.type);
    case "title":
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
    case "label":
      return rank(LABEL_ORDER, a.label) - rank(LABEL_ORDER, b.label);
    case "verdict":
      return rank(VERDICT_ORDER, a.citationCheck) - rank(VERDICT_ORDER, b.citationCheck);
    case "impl":
      return rank(IMPL_ORDER, statusOf(a)) - rank(IMPL_ORDER, statusOf(b));
    case "review":
      return rank(REVIEW_ORDER, a.review) - rank(REVIEW_ORDER, b.review);
    case "updated":
      return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  }
}

/**
 * Stable sort on one column. Equal keys keep their input order in both
 * directions, so reversing never reshuffles ties.
 */
export function sortItems(items: readonly Item[], sort: Sort | undefined): Item[] {
  if (!sort) return items.slice();
  const indexed = items.map((item, i) => ({ item, i }));
  const sign = sort.dir === "asc" ? 1 : -1;
  indexed.sort((x, y) => sign * compare(sort.key, x.item, y.item) || x.i - y.i);
  return indexed.map((x) => x.item);
}

export function matchesSearch(item: Item, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return `${item.title}\n${item.body}`.toLowerCase().includes(q);
}

export function applyFilters(items: readonly Item[], f: Filters): Item[] {
  return items.filter(
    (i) =>
      (f.type === undefined || i.type === f.type) &&
      (f.label === undefined || (f.label === "none" ? i.label === undefined : i.label === f.label)) &&
      (f.verdict === undefined || i.citationCheck === f.verdict) &&
      (f.impl === undefined || (f.impl === "na" ? statusOf(i) === undefined : statusOf(i) === f.impl)) &&
      (f.review === undefined || i.review === f.review) &&
      (f.batch === undefined || i.batchId === f.batch) &&
      matchesSearch(i, f.search),
  );
}

export function queryItems(state: LabState, f: Filters, sort: Sort | undefined) {
  const rows = sortItems(applyFilters(state.items, f), sort);
  return { rows, shown: rows.length, total: state.items.length };
}

export interface Overview {
  total: number;
  units: number;
  label: Record<Label, number>;
  impl: Record<ImplStatus, number>;
  verdict: Record<CitationCheck, number>;
  review: Record<Review, number>;
}

/** Counts over the batch scope only (no other filter), so a segment's count equals the table count once its filter is applied. */
export function batchOverview(items: readonly Item[], batch: string | undefined): Overview {
  const scope = batch === undefined ? items : items.filter((i) => i.batchId === batch);
  const o: Overview = {
    total: scope.length,
    units: 0,
    label: { reproduced: 0, new: 0 },
    impl: { runnable: 0, "spec-only": 0 },
    verdict: { pass: 0, fail: 0, "not-run": 0 },
    review: { pending: 0, reviewed: 0 },
  };
  for (const i of scope) {
    if (i.label) o.label[i.label]++;
    const st = statusOf(i);
    if (st) {
      o.impl[st]++;
      o.units++;
    }
    o.verdict[i.citationCheck]++;
    o.review[i.review]++;
  }
  return o;
}

export const SORT_LABEL: Record<SortKey, string> = {
  type: "Type",
  title: "Title",
  label: "Label",
  verdict: "Citation check",
  impl: "Implementation",
  review: "Review",
  updated: "Updated",
};

const SORT_WORDS: Record<SortKey, [string, string]> = {
  type: ["A to Z", "Z to A"],
  title: ["A to Z", "Z to A"],
  label: ["Reproduced first", "New first"],
  verdict: ["FAIL first", "Not run first"],
  impl: ["runnable first", "spec only first"],
  review: ["pending first", "reviewed first"],
  updated: ["oldest first", "newest first"],
};

export function sortText(s: Sort): string {
  return `Sort: ${SORT_LABEL[s.key]}, ${SORT_WORDS[s.key][s.dir === "asc" ? 0 : 1]}`;
}
