import type { Polygon } from "geojson";

export type AreaPoint = [number, number];
export const samePolygon = (a: Polygon | null | undefined, b: Polygon | null | undefined) =>
  a === b || (!!a && !!b && JSON.stringify(a.coordinates) === JSON.stringify(b.coordinates));
const cross = (a: AreaPoint, b: AreaPoint, c: AreaPoint) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a: AreaPoint, b: AreaPoint, p: AreaPoint) => Math.abs(cross(a, b, p)) < 1e-16 && p[0] >= Math.min(a[0], b[0]) - 1e-12 && p[0] <= Math.max(a[0], b[0]) + 1e-12 && p[1] >= Math.min(a[1], b[1]) - 1e-12 && p[1] <= Math.max(a[1], b[1]) + 1e-12;
const intersects = (a: AreaPoint, b: AreaPoint, c: AreaPoint, d: AreaPoint) => {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
};

export function samAreaError(value: unknown): string | null {
  const area = value as Polygon | null;
  if (!area || area.type !== "Polygon" || !Array.isArray(area.coordinates) || area.coordinates.length !== 1) return "Draw a polygon to select the SAM area.";
  const ring = area.coordinates[0];
  if (!ring || ring.length < 4 || ring.length > 65) return "Choose between 3 and 64 polygon corners.";
  if (!ring.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]!) <= 180 && Math.abs(p[1]!) <= 85.051129)) return "Polygon coordinates are invalid.";
  const points = ring as AreaPoint[];
  const first = points[0]!, last = points.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) return "Finish the polygon before running SAM.";
  let signedArea = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!;
    if (a[0] === b[0] && a[1] === b[1]) return "Polygon corners must be distinct.";
    signedArea += cross(first, a, b);
    for (let j = i + 2; j < points.length - 1; j++) {
      if (i === 0 && j === points.length - 2) continue;
      if (intersects(a, b, points[j]!, points[j + 1]!)) return "Polygon edges cross. Undo a corner or redraw the area.";
    }
  }
  if (Math.abs(signedArea) < 1e-14) return "The polygon needs to enclose an area.";
  return null;
}

export function areaBounds(area: Polygon): [[number, number], [number, number]] {
  const ring = area.coordinates[0]!;
  return [[Math.min(...ring.map((p) => p[0]!)), Math.min(...ring.map((p) => p[1]!))], [Math.max(...ring.map((p) => p[0]!)), Math.max(...ring.map((p) => p[1]!))]];
}
