import { ALGORITHMS } from "../../engine/algorithms.mjs";

/** Version string written by tools/tree-peaks (see engine/README.md). */
export const DETECTOR_VERSION = "openpalm-tree-peaks-v1";

export interface Implementation {
  id: string;
  name: string;
  version: string;
  /** Set when the implementation orders a route: which registered tour algorithm it runs. */
  route?: "A" | "B";
}

const entries: Implementation[] = [
  { id: "chm-smoothing", name: "CHM 3x3 mean smoothing", version: DETECTOR_VERSION },
  { id: "local-maximum-search", name: "Local-maximum search", version: DETECTOR_VERSION },
  { id: "height-filter", name: "Minimum-height filter", version: DETECTOR_VERSION },
  { id: "nn-ordering", name: ALGORITHMS.A.name, version: ALGORITHMS.A.version, route: "A" },
  { id: "two-opt-refinement", name: ALGORITHMS.B.name, version: ALGORITHMS.B.version, route: "B" },
];

export const REGISTRY: Readonly<Record<string, Implementation>> = Object.freeze(
  Object.fromEntries(entries.map((e) => [e.id, e])),
);

export const NO_IMPLEMENTATION = "none";

export const isRegistered = (id: string | undefined): boolean =>
  id !== undefined && id !== NO_IMPLEMENTATION && Object.hasOwn(REGISTRY, id);

export const implementationVersion = (id: string | undefined): string =>
  isRegistered(id) ? REGISTRY[id as string]!.version : NO_IMPLEMENTATION;
