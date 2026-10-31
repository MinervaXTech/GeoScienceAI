import { routeRun, PEAKS } from "../geo/layer";
import { runnableCount } from "./snapshots";
import type { SnapshotData, SnapshotUnit } from "./types";

export type RowStatus = "same" | "changed" | "added" | "removed";

export interface CompareRow {
  key: string;
  status: RowStatus;
  a?: SnapshotUnit;
  b?: SnapshotUnit;
}

export interface MetricRow {
  metric: string;
  a: number | null;
  b: number | null;
  /** b minus a; null when either side has no value. */
  difference: number | null;
  unit?: string;
}

const same = (a: SnapshotUnit, b: SnapshotUnit) =>
  a.label === b.label &&
  a.implementation === b.implementation &&
  a.implementationVersion === b.implementationVersion &&
  a.citedSpans.join() === b.citedSpans.join();

export function compareUnits(a: SnapshotData, b: SnapshotData): CompareRow[] {
  const bByKey = new Map(b.units.map((u) => [u.key, u]));
  const seen = new Set<string>();
  const rows: CompareRow[] = [];
  for (const ua of a.units) {
    const ub = bByKey.get(ua.key);
    seen.add(ua.key);
    rows.push(ub ? { key: ua.key, status: same(ua, ub) ? "same" : "changed", a: ua, b: ub } : { key: ua.key, status: "removed", a: ua });
  }
  for (const ub of b.units) if (!seen.has(ub.key)) rows.push({ key: ub.key, status: "added", b: ub });
  return rows;
}

const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : b - a);

/** Metrics come from running the registered tour algorithm over the saved layer, not from stored numbers. */
export function compareMetrics(a: SnapshotData, b: SnapshotData): MetricRow[] {
  const ra = a.route ? routeRun(a.route).metrics : null;
  const rb = b.route ? routeRun(b.route).metrics : null;
  const row = (metric: string, va: number | null | undefined, vb: number | null | undefined, unit?: string): MetricRow => ({
    metric,
    a: va ?? null,
    b: vb ?? null,
    difference: diff(va ?? null, vb ?? null),
    ...(unit ? { unit } : {}),
  });
  return [
    row("Units (total)", a.units.length, b.units.length),
    row("Runnable units", runnableCount(a.units), runnableCount(b.units)),
    row("Spec-only units", a.units.length - runnableCount(a.units), b.units.length - runnableCount(b.units)),
    row("Candidate peaks visited", ra ? PEAKS.length : null, rb ? PEAKS.length : null),
    row("Path length", ra?.pathLengthM, rb?.pathLengthM, "m"),
    row("Turn sum", ra?.turnSumDeg, rb?.turnSumDeg, "deg"),
    row("Turns > 45 deg", ra?.turnsOver45Deg, rb?.turnsOver45Deg),
    row("Climb (CHMv2 proxy)", ra?.heightProxy.climbM, rb?.heightProxy.climbM, "m"),
    row("Descent (CHMv2 proxy)", ra?.heightProxy.descentM, rb?.heightProxy.descentM, "m"),
  ];
}
