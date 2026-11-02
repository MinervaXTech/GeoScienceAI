import type { FeatureCollection, MultiPolygon } from "geojson";
import { insidePolygon } from "./polygonEdit";
import type { CanopyClip } from "./canopy";
import { lngLatToImagePixel, type SamFrame } from "./sam";

export interface TreeGuidanceSummary {
  chmv2?: { clipId: string; minimumHeightM: number; sourceDate: string | null; fetchedAt: string; resolutionMapM: number; missingPixels: number; belowHeightPixels: number; supportedPixels: number };
  sam?: { imageSha256: string; runId?: string; receivedAt: string; objects: number; prompt: string; excludedPixels: number };
}
export interface TreeGuidanceSettings { useChmv2: boolean; useSam: boolean; minimumHeightM: number }
/** Decode the numeric 8-bit metre band. 255 denotes outside/no-data; zero is
 * a known ground height. Never infer height from the display spectrum. */
export function alignedCanopyHeights(frame: SamFrame, clip: CanopyClip): Float32Array {
  if (!clip.heightData || clip.heightData.encoding !== "uint8-metres-base64" || !Number.isInteger(clip.width) || !Number.isInteger(clip.height) || clip.width < 1 || clip.height < 1 || clip.width > 2048 || clip.height > 2048) throw Error("CHMv2 numeric heights are unavailable. Reload canopy data for this area.");
  const bytes = atob(clip.heightData.data);
  if (bytes.length !== clip.width * clip.height) throw Error("CHMv2 numeric height dimensions do not match its frame.");
  const a = lngLatToImagePixel(clip, frame.corners[0]), b = lngLatToImagePixel(clip, frame.corners[1]), d = lngLatToImagePixel(clip, frame.corners[3]);
  const output = new Float32Array(frame.width * frame.height).fill(NaN);
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    const u = (x + .5) / frame.width, v = (y + .5) / frame.height, col = Math.floor(a[0] + (b[0] - a[0]) * u + (d[0] - a[0]) * v), row = Math.floor(a[1] + (b[1] - a[1]) * u + (d[1] - a[1]) * v);
    if (col < 0 || row < 0 || col >= clip.width || row >= clip.height) continue;
    const value = bytes.charCodeAt(row * clip.width + col);
    if (value !== 255) output[y * frame.width + x] = value;
  }
  return output;
}
/** Rasterize the UNION of actual SAM output polygons. Even-odd scan lines keep
 * interior holes empty; a different output polygon can occupy another's hole. */
export function samCoverageMask(frame: SamFrame, regions: FeatureCollection<MultiPolygon>): Uint8Array {
  const mask = new Uint8Array(frame.width * frame.height);
  for (const feature of regions.features) for (const polygon of feature.geometry.coordinates) {
    const rings = polygon.map((ring) => ring.map((p) => lngLatToImagePixel(frame, p as [number, number])));
    if (!rings.length || rings.some((ring) => ring.some((p) => !p.every(Number.isFinite)))) continue;
    let low = Infinity, high = -Infinity;
    for (const ring of rings) for (const p of ring) { low = Math.min(low, p[1]); high = Math.max(high, p[1]); }
    const minY = Math.max(0, Math.ceil(low - .5)), maxY = Math.min(frame.height, Math.ceil(high - .5));
    for (let y = minY; y < maxY; y++) {
      const scan = y + .5, intersections: number[] = [];
      for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j]!, b = ring[i]!;
        if ((a[1] > scan) !== (b[1] > scan)) intersections.push(a[0] + (scan - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const left = Math.max(0, Math.ceil(intersections[i]! - .5)), right = Math.min(frame.width, Math.ceil(intersections[i + 1]! - .5));
        if (right > left) mask.fill(1, y * frame.width + left, y * frame.width + right);
      }
    }
  }
  return mask;
}

export function samOutputPredicate(regions: FeatureCollection<MultiPolygon>) {
  const polygons = regions.features.flatMap((feature) => feature.geometry.coordinates).map((polygon) => {
    const rings = polygon.map((ring) => ring.map(([x, y]) => ({ x: x!, y: y! })));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of rings[0] ?? []) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
    return { rings, minX, minY, maxX, maxY };
  });
  return (coordinate: [number, number]) => {
    const point = { x: coordinate[0], y: coordinate[1] };
    return polygons.some((p) => point.x >= p.minX && point.x <= p.maxX && point.y >= p.minY && point.y <= p.maxY && insidePolygon(p.rings[0]!, point) && !p.rings.slice(1).some((ring) => insidePolygon(ring, point)));
  };
}
export function insideSamOutput(regions: FeatureCollection<MultiPolygon>, coordinate: [number, number]): boolean {
  return samOutputPredicate(regions)(coordinate);
}
