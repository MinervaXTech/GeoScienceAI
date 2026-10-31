export interface RoutePoint {
  id: number;
  x: number;
  y: number;
  h: number;
}
export interface RouteMetrics {
  pathLengthM: number;
  turnSumDeg: number;
  turnsOver45Deg: number;
  turnVertices: number;
  heightProxy: { climbM: number; descentM: number; legsCounted: number; note: string };
}
export interface AlgorithmInfo {
  id: "A" | "B";
  name: string;
  version: string;
  method: string;
  reference: string;
  doi: string;
}
export const ALGORITHMS: Readonly<Record<"A" | "B", Readonly<AlgorithmInfo>>>;
export function runAlgorithm(
  id: "A" | "B",
  points: RoutePoint[],
  home: { x: number; y: number },
): { order: number[]; passes: number | null };
export function routeMetrics(
  points: RoutePoint[],
  home: { x: number; y: number },
  order: number[],
): RouteMetrics;
