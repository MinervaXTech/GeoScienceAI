import { DEFAULT_PARAMS } from "../../engine/peaks.mjs";
import { LOCAL_CRS } from "../../engine/project.mjs";
import { canonicalJson, sha256Hex } from "./hash";
import { computeLabel } from "./labelRule";
import { HOME_WGS84 } from "../geo/layer";
import { implementationVersion, isRegistered, NO_IMPLEMENTATION, REGISTRY } from "./registry";
import type { Item, SnapshotData, SnapshotParameters, SnapshotUnit } from "./types";

export const DEFAULT_SNAPSHOT_PARAMETERS = (): SnapshotParameters => ({
  detector: { ...DEFAULT_PARAMS },
  route: { homeWgs84: [...HOME_WGS84], localCrs: LOCAL_CRS, routeShape: "closed tour, every peak once", tieBreak: "lower peak id" },
});

/** "U3 Height filter" gives key "U3"; titles without a leading unit number key on the whole title. */
export const unitKey = (title: string): string => /^U\d+/.exec(title)?.[0] ?? title;

export function describeUnit(item: Item): SnapshotUnit {
  const label = computeLabel(item);
  const impl = item.implementation ?? NO_IMPLEMENTATION;
  return {
    unitId: item.id,
    key: unitKey(item.title),
    title: item.title,
    label,
    citedSpans: [...item.citedSpans].sort(),
    implementation: impl,
    implementationVersion: implementationVersion(impl),
  };
}

/**
 * Hash over the units, the parameters and the implementation versions. Review
 * state, timestamps and item ids are left out on purpose, so reviewing a unit
 * does not change the hash but editing what it cites or runs does.
 */
export function snapshotHash(units: readonly SnapshotUnit[], parameters: SnapshotParameters): string {
  const body = {
    units: units
      .map((u) => ({ key: u.key, title: u.title, citedSpans: u.citedSpans, implementation: u.implementation, version: u.implementationVersion }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    parameters,
  };
  return sha256Hex(canonicalJson(body)).slice(0, 7);
}

/** The route a snapshot draws: the last route-ordering implementation among its units wins. */
export function routeOf(units: readonly SnapshotUnit[]): "A" | "B" | null {
  let route: "A" | "B" | null = null;
  for (const u of units) {
    const r = isRegistered(u.implementation) ? REGISTRY[u.implementation]?.route : undefined;
    if (r) route = r;
  }
  return route;
}

export const runnableCount = (units: readonly SnapshotUnit[]): number =>
  units.filter((u) => isRegistered(u.implementation)).length;

export function buildSnapshotData(
  unitItems: readonly Item[],
  parameters: SnapshotParameters = DEFAULT_SNAPSHOT_PARAMETERS(),
  extra: Pick<SnapshotData, "slot" | "paperItemId"> = {},
): SnapshotData {
  const units = unitItems.map(describeUnit);
  return { ...extra, hash: snapshotHash(units, parameters), units, parameters, route: routeOf(units) };
}
