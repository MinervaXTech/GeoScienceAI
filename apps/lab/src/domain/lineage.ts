import type { Item, LabState } from "./types";

/** Geometry follows the design's Lineage template (design/OpenPalm Lab.html). */
export const GEO = { top: 24, spanH: 30, spanGap: 38, unitH: 46, snapH: 44, spanX: 0, spanW: 180, unitX: 236, unitW: 184, snapX: 476, snapW: 134 } as const;

export interface LSpan { key: string; id: string; text: string; y: number; cited: boolean }
export interface LUnit { key: string; item: Item; y: number; isNew: boolean }
export interface LSnap { key: string; item: Item; y: number; hash: string; count: number }
export interface LEdge { kind: "span-unit" | "unit-snap"; from: string; to: string; y1: number; y2: number }
export interface Lineage {
  batchId: string;
  paper: Item;
  spans: LSpan[];
  units: LUnit[];
  snaps: LSnap[];
  edges: LEdge[];
  newHeaderY: number | null;
  height: number;
  summary: string;
}

export const paperBatches = (s: LabState) =>
  s.batches.filter((b) => b.kind === "paper" && s.items.some((i) => i.batchId === b.id && i.type === "paper"));

/** Derives spans -> units -> snapshots from the stored items. Nothing here is stored separately. */
export function buildLineage(state: LabState, batchId: string): Lineage | undefined {
  const paper = state.items.find((i) => i.batchId === batchId && i.type === "paper" && i.paper);
  if (!paper?.paper) return undefined;
  const { top, spanH, spanGap, unitH, snapH } = GEO;
  const units = state.items.filter((i) => i.type === "unit" && i.batchId === batchId && i.unit?.paperItemId === paper.id);
  const snapItems = state.items.filter((i) => i.type === "snapshot" && i.batchId === batchId && i.snapshot);
  const cited = new Set(units.flatMap((u) => u.citedSpans));
  const spanY = (id: string) => top + (Number(id.slice(1)) - 1) * spanGap;

  const spans: LSpan[] = paper.paper.spans.map((s, i) => ({ key: `span:${s.id}`, id: s.id, text: s.text, y: top + i * spanGap, cited: cited.has(s.id) }));

  const pos = new Map<string, number>();
  let bottom = top - 8;
  units
    .filter((u) => u.citedSpans.length)
    .map((u) => ({ u, want: u.citedSpans.reduce((a, s) => a + spanY(s) + spanH / 2, 0) / u.citedSpans.length - unitH / 2 }))
    .sort((a, b) => a.want - b.want)
    .forEach(({ u, want }) => {
      const y = Math.max(want, bottom + 8);
      pos.set(u.id, y);
      bottom = y + unitH;
    });
  const fresh = units.filter((u) => !u.citedSpans.length);
  const newHeaderY = fresh.length ? Math.max(bottom, top) + 22 : null;
  let nb = (newHeaderY ?? 0) + 10;
  fresh.forEach((u) => {
    pos.set(u.id, nb + 8);
    nb = nb + 8 + unitH;
  });

  const snapPos = new Map<string, number>();
  let sb = top - 8;
  snapItems
    .map((sn) => {
      const ys = sn.snapshot!.units.map((x) => pos.get(x.unitId)).filter((y): y is number => y !== undefined);
      return { sn, want: (ys.length ? ys.reduce((a, y) => a + y + unitH / 2, 0) / ys.length : top) - snapH / 2 };
    })
    .sort((a, b) => a.want - b.want)
    .forEach(({ sn, want }) => {
      const y = Math.max(want, sb + 12);
      snapPos.set(sn.id, y);
      sb = y + snapH;
    });

  const edges: LEdge[] = [];
  for (const u of units)
    for (const s of u.citedSpans)
      if (spans.some((x) => x.id === s)) edges.push({ kind: "span-unit", from: `span:${s}`, to: `unit:${u.id}`, y1: spanY(s) + spanH / 2, y2: pos.get(u.id)! + unitH / 2 });
  for (const sn of snapItems)
    for (const su of sn.snapshot!.units) {
      const y = pos.get(su.unitId);
      if (y !== undefined) edges.push({ kind: "unit-snap", from: `unit:${su.unitId}`, to: `snap:${sn.id}`, y1: y + unitH / 2, y2: snapPos.get(sn.id)! + snapH / 2 });
    }

  return {
    batchId,
    paper,
    spans,
    units: units.map((item) => ({ key: `unit:${item.id}`, item, y: pos.get(item.id)!, isNew: !item.citedSpans.length })),
    snaps: snapItems.map((item) => ({ key: `snap:${item.id}`, item, y: snapPos.get(item.id)!, hash: item.snapshot!.hash, count: item.snapshot!.units.length })),
    edges,
    newHeaderY,
    height: Math.max(top + spans.length * spanGap, nb, sb) + 12,
    summary: `${spans.length} spans, ${cited.size} cited, ${units.length} units, ${snapItems.length} snapshots`,
  };
}

/** Keys lit when `selected` is chosen: the node, and everything connected to it through spans, units and snapshots. */
export function litKeys(l: Lineage, selected: string | undefined): Set<string> | undefined {
  if (!selected) return undefined;
  const on = new Set([selected]);
  const [kind, id] = [selected.slice(0, selected.indexOf(":")), selected.slice(selected.indexOf(":") + 1)];
  const snapsOf = (unitKey: string) => l.edges.filter((e) => e.kind === "unit-snap" && e.from === unitKey).map((e) => e.to);
  if (kind === "span")
    l.edges.filter((e) => e.kind === "span-unit" && e.from === selected).forEach((e) => {
      on.add(e.to);
      snapsOf(e.to).forEach((k) => on.add(k));
    });
  if (kind === "unit") {
    l.edges.filter((e) => e.kind === "span-unit" && e.to === selected).forEach((e) => on.add(e.from));
    snapsOf(selected).forEach((k) => on.add(k));
  }
  if (kind === "snap")
    l.edges.filter((e) => e.kind === "unit-snap" && e.to === selected).forEach((e) => {
      on.add(e.from);
      l.edges.filter((x) => x.kind === "span-unit" && x.to === e.from).forEach((x) => on.add(x.from));
    });
  void id;
  return on;
}
