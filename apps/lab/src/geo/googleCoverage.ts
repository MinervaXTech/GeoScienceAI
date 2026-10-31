export interface ZoomRect { maxZoom: number; north: number; south: number; east: number; west: number }

/** Check the entire viewport against the union of Google's coverage rectangles. */
export function googleViewportCovered(bounds: Omit<ZoomRect, "maxZoom">, zoom: number, rects: ZoomRect[]) {
  const eligible = rects.filter((r) => r && [r.maxZoom, r.north, r.south, r.east, r.west].every(Number.isFinite) && r.maxZoom >= zoom && r.east > bounds.west && r.west < bounds.east && r.north > bounds.south && r.south < bounds.north);
  const edges = [...new Set([bounds.west, bounds.east, ...eligible.flatMap((r) => [Math.max(bounds.west, r.west), Math.min(bounds.east, r.east)])])].sort((a, b) => a - b);
  for (let i = 1; i < edges.length; i++) {
    const x = (edges[i - 1]! + edges[i]!) / 2;
    const spans = eligible.filter((r) => r.west <= x && r.east >= x)
      .map((r) => [Math.max(bounds.south, r.south), Math.min(bounds.north, r.north)] as const).sort((a, b) => a[0] - b[0]);
    let north = bounds.south;
    for (const [s, n] of spans) {
      if (s > north + 1e-9) return false;
      north = Math.max(north, n);
    }
    if (north < bounds.north - 1e-9) return false;
  }
  return eligible.length > 0;
}
