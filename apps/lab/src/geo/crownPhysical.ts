import type { CrownMatch, CrownMatchResult, PixelRect } from "./templateMatch.ts";
import { countSectorMatches } from "./crownCoverage.ts";
import { invalidateChangedReviews } from "./crownReview.ts";
export interface CrownSizePolicy { referenceDiameterPx: number; minDiameterPx: number; maxDiameterPx: number; clearancePx: number; maxAspectRatio: number }
export interface CrownConstraintReport { policy: CrownSizePolicy; sizeRejected: number; shapeRejected: number; overlapRejected: number }
/** Keep alternate candidates for reversible size/spacing changes. Spatial suppression
 * happens AFTER size validation so a giant false match cannot hide real crowns. */
export function mergeCrownCandidatePool(existing: CrownMatch[], incoming: CrownMatch[], limit = 5000) {
  const unique = new Map<string, CrownMatch>();
  for (const m of [...existing, ...incoming]) {
    const key = [m.x, m.y, m.width, m.height].join(":");
    if (!unique.has(key) || unique.get(key)!.score < m.score) unique.set(key, m);
  }
  const all = [...unique.values()].sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  return { matches: all.slice(0, limit), truncated: all.length > limit };
}
export function crownSizePolicy(sample: Pick<PixelRect, "width" | "height">, tolerance = 0.25, clearancePx = 0): CrownSizePolicy {
  const referenceDiameterPx = Math.min(sample.width, sample.height);
  return validateCrownSizePolicy({ referenceDiameterPx, minDiameterPx: Math.max(4, referenceDiameterPx * (1 - tolerance)), maxDiameterPx: referenceDiameterPx * (1 + tolerance), clearancePx, maxAspectRatio: 1.4 });
}
export function validateCrownSizePolicy(value: unknown): CrownSizePolicy {
  const p = value as CrownSizePolicy;
  if (!p || ![p.referenceDiameterPx, p.minDiameterPx, p.maxDiameterPx, p.clearancePx, p.maxAspectRatio].every(Number.isFinite) || p.referenceDiameterPx < 6 || p.referenceDiameterPx > 64 || p.minDiameterPx < 4 || p.maxDiameterPx > 96 || p.minDiameterPx > p.referenceDiameterPx || p.referenceDiameterPx > p.maxDiameterPx || p.clearancePx < 0 || p.clearancePx > 16 || p.maxAspectRatio < 1 || p.maxAspectRatio > 2) throw Error("Invalid crown-size constraints.");
  return { referenceDiameterPx: p.referenceDiameterPx, minDiameterPx: p.minDiameterPx, maxDiameterPx: p.maxDiameterPx, clearancePx: p.clearancePx, maxAspectRatio: p.maxAspectRatio };
}
/** Keep whole-crown-sized, near-square patches; circles never overlap. */
export function constrainCrownMatches(raw: CrownMatch[], policy: CrownSizePolicy) {
  validateCrownSizePolicy(policy);
  const report: CrownConstraintReport = { policy, sizeRejected: 0, shapeRejected: 0, overlapRejected: 0 };
  const eligible: CrownMatch[] = [];
  for (const m of raw) {
    const diameter = Math.min(m.width, m.height);
    if (diameter < policy.minDiameterPx || diameter > policy.maxDiameterPx) { report.sizeRejected++; continue; }
    if (Math.max(m.width, m.height) / diameter > policy.maxAspectRatio) { report.shapeRejected++; continue; }
    eligible.push({ ...m, radiusPx: diameter / 2 });
  }
  eligible.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const maxRadius = Math.max(0, ...eligible.map((m) => m.radiusPx!)), cell = 64, buckets = new Map<string, CrownMatch[]>(), matches: CrownMatch[] = [];
  for (const m of eligible) {
    const x = m.x + m.width / 2, y = m.y + m.height / 2, bx = Math.floor(x / cell), by = Math.floor(y / cell), reach = Math.ceil((m.radiusPx! + maxRadius + policy.clearancePx) / cell);
    let overlap = false;
    for (let dy = -reach; dy <= reach && !overlap; dy++) for (let dx = -reach; dx <= reach && !overlap; dx++) for (const n of buckets.get(`${bx + dx}:${by + dy}`) ?? []) {
      if (Math.hypot(x - n.x - n.width / 2, y - n.y - n.height / 2) + 1e-9 < m.radiusPx! + n.radiusPx! + policy.clearancePx) { overlap = true; break; }
    }
    if (overlap) { report.overlapRejected++; continue; }
    matches.push(m); const key = `${bx}:${by}`, bucket = buckets.get(key) ?? []; bucket.push(m); buckets.set(key, bucket);
  }
  return { matches, report };
}
export function applyCrownPolicy(result: CrownMatchResult, policy: CrownSizePolicy): CrownMatchResult {
  const rawMatches = result.rawMatches ?? result.matches;
  const { matches, report } = constrainCrownMatches(rawMatches, policy);
  const sectors = result.coverage ? countSectorMatches(result.coverage.sectors, matches) : [];
  return { ...result, matches, rawMatches, physical: report,
    ...(result.coverage ? { coverage: { ...result.coverage, mergeMethod: "reference-size-nonoverlap-v1", mergeSpacing: 1, mergedCount: matches.length, sectors, reviews: invalidateChangedReviews(result.coverage.sectors, sectors, result.coverage.reviews) } } : {}) };
}
