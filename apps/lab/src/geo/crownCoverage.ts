import type { CrownMatch, PixelRect } from "./templateMatch.ts";
import { validateSectorReviews, type CrownSectorReview } from "./crownReview.ts";
export const CROWN_CANDIDATE_LIMIT = 5000;
export const CROWN_MAX_ROUNDS = 12;
export interface CrownSector extends PixelRect { id: string; validPixels: number; count: number; candidateSignature?: string }
export interface CrownCoverageFeedback {
  mergedCount: number; addedCandidates: number; stagnantPasses: number;
  samples: PixelRect[]; sectors: CrownSector[];
  reviews?: CrownSectorReview[];
}
export interface CrownCoverageResult extends CrownCoverageFeedback { initialCandidates: number; templateCount: number; mergeSpacing: number; mergeMethod?: "reference-size-nonoverlap-v1" }
export function crownSectors(width: number, height: number, rgba: Uint8ClampedArray): CrownSector[] {
  if (rgba.length !== width * height * 4 || width < 1 || height < 1 || width > 1024 || height > 1024) throw Error("Invalid crown coverage image.");
  const sectors: CrownSector[] = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const x = Math.floor(col * width / 4), y = Math.floor(row * height / 4), right = Math.floor((col + 1) * width / 4), bottom = Math.floor((row + 1) * height / 4);
    let validPixels = 0;
    for (let py = y; py < bottom; py++) for (let px = x; px < right; px++) if (rgba[(py * width + px) * 4 + 3]! >= 250) validPixels++;
    if (validPixels) sectors.push({ id: `${String.fromCharCode(65 + col)}${row + 1}`, x, y, width: right - x, height: bottom - y, validPixels, count: 0 });
  }
  return sectors;
}
export function countSectorMatches(sectors: CrownSector[], matches: CrownMatch[]): CrownSector[] {
  const output = sectors.map((sector) => ({ ...sector, count: 0, candidateSignature: "" }));
  const signatures = new Map(output.map((s) => [s.id, [] as string[]]));
  for (const m of matches) { const x = m.x + m.width / 2, y = m.y + m.height / 2; const sector = output.find((s) => x >= s.x && y >= s.y && x < s.x + s.width && y < s.y + s.height); if (sector) { sector.count++; signatures.get(sector.id)!.push([m.x, m.y, m.width, m.height, m.radiusPx ?? ""].join(",")); } }
  for (const s of output) s.candidateSignature = signatures.get(s.id)!.sort().join(";");
  return output;
}
/** Union templates, then apply NMS across passes; never fill empty locations. */
export function mergeCrownMatches(existing: CrownMatch[], incoming: CrownMatch[], spacing = 0.65, limit = CROWN_CANDIDATE_LIMIT) {
  const cell = 64, buckets = new Map<string, CrownMatch[]>(), matches: CrownMatch[] = [];
  const candidates = [...existing, ...incoming].sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  let truncated = false;
  for (const c of candidates) {
    const cx = c.x + c.width / 2, cy = c.y + c.height / 2, bx = Math.floor(cx / cell), by = Math.floor(cy / cell);
    // Per-pass templates are <=64 px, enlarged at most 1.2x. Search enough
    // neighbouring buckets for overlap and the maximum permitted spacing.
    const radius = Math.ceil(Math.max(c.width, c.height, 80) * Math.max(1, spacing) / cell);
    let duplicate = false;
    for (let dy = -radius; dy <= radius && !duplicate; dy++) for (let dx = -radius; dx <= radius && !duplicate; dx++) for (const m of buckets.get(`${bx + dx}:${by + dy}`) ?? []) {
      const ix = Math.max(0, Math.min(c.x + c.width, m.x + m.width) - Math.max(c.x, m.x));
      const iy = Math.max(0, Math.min(c.y + c.height, m.y + m.height) - Math.max(c.y, m.y));
      if (ix * iy / (c.width * c.height + m.width * m.height - ix * iy) > 0.25 || Math.hypot(cx - m.x - m.width / 2, cy - m.y - m.height / 2) < spacing * Math.min(c.width, c.height, m.width, m.height)) { duplicate = true; break; }
    }
    if (duplicate) continue;
    if (matches.length >= limit) { truncated = true; break; }
    matches.push(c); const key = `${bx}:${by}`, bucket = buckets.get(key) ?? []; bucket.push(c); buckets.set(key, bucket);
  }
  return { matches, truncated, addedCandidates: Math.max(0, matches.length - existing.length) };
}
export function validateCoverageFeedback(value: unknown, width: number, height: number): CrownCoverageFeedback {
  const v = value as CrownCoverageFeedback;
  if (!v || ![v.mergedCount, v.addedCandidates, v.stagnantPasses].every((n) => Number.isInteger(n) && n >= 0) || v.mergedCount > CROWN_CANDIDATE_LIMIT || v.addedCandidates > CROWN_CANDIDATE_LIMIT || v.stagnantPasses > CROWN_MAX_ROUNDS || !Array.isArray(v.samples) || v.samples.length > CROWN_MAX_ROUNDS || !Array.isArray(v.sectors) || v.sectors.length > 16) throw Error("Invalid crown coverage feedback.");
  const rect = (r: PixelRect) => r && [r.x, r.y, r.width, r.height].every(Number.isInteger) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= width && r.y + r.height <= height;
  if (!v.samples.every((s) => rect(s) && Math.min(s.width, s.height) >= 6 && Math.max(s.width, s.height) <= 64) || !v.sectors.every((s) => rect(s) && /^[A-D][1-4]$/.test(s.id) && Number.isInteger(s.validPixels) && s.validPixels > 0 && s.validPixels <= s.width * s.height && Number.isInteger(s.count) && s.count >= 0 && s.count <= CROWN_CANDIDATE_LIMIT)) throw Error("Invalid coverage sample or sector.");
  return { mergedCount: v.mergedCount, addedCandidates: v.addedCandidates, stagnantPasses: v.stagnantPasses, samples: v.samples.map(({ x, y, width, height }) => ({ x, y, width, height })), sectors: v.sectors.map(({ id, x, y, width, height, validPixels, count }) => ({ id, x, y, width, height, validPixels, count })), ...(v.reviews ? { reviews: validateSectorReviews(v.reviews, v.sectors.map((s) => s.id)) } : {}) };
}
