import type { CrownSector } from "./crownCoverage.ts";
import type { FeatureCollection, Polygon } from "geojson";
import polygonClipping from "polygon-clipping";
import { imagePixelToLngLat, lngLatToImagePixel, type SamFrame } from "./sam.ts";
export const CROWN_REVIEW_LABELS = { crowns_accounted_for: "Visible palms accounted for", missed_palms: "Missed palms remain", no_visible_palms: "No visible palms / genuine gap", uncertain: "Uncertain / image too unclear" } as const;
export type CrownReviewStatus = keyof typeof CROWN_REVIEW_LABELS;
export interface CrownSectorReview { id: string; status: CrownReviewStatus; reason: string; reviewer?: "muse" | "user" | "system"; reviewedAt?: string }
export function validateSectorReviews(value: unknown, allowed?: readonly string[]): CrownSectorReview[] {
  if (!Array.isArray(value) || value.length > 16) throw Error("Invalid area-review list.");
  const ids = new Set<string>();
  return value.map((r) => {
    if (!r || typeof r.id !== "string" || !/^[A-D][1-4]$/.test(r.id) || ids.has(r.id) || (allowed && !allowed.includes(r.id)) || !Object.hasOwn(CROWN_REVIEW_LABELS, r.status) || typeof r.reason !== "string" || !r.reason.trim() || r.reason.length > 1000) throw Error("Invalid or duplicate area review.");
    ids.add(r.id);
    return { id: r.id, status: r.status as CrownReviewStatus, reason: r.reason };
  });
}
export function crownReviewSummary(sectors: CrownSector[], reviews: CrownSectorReview[] = []) {
  let resolved = 0, unreviewed = 0, uncertain = 0, missed = 0, conflicts = 0;
  for (const sector of sectors) {
    const review = reviews.find((r) => r.id === sector.id);
    if (!review) unreviewed++;
    else if (review.status === "uncertain") uncertain++;
    else if (review.status === "missed_palms") missed++;
    else if ((review.status === "no_visible_palms" && sector.count > 0) || (review.status === "crowns_accounted_for" && sector.count === 0)) conflicts++;
    else resolved++;
  }
  return { total: sectors.length, resolved, unreviewed, uncertain, missed, conflicts, pending: sectors.length - resolved, complete: sectors.length > 0 && resolved === sectors.length };
}
export function invalidateChangedReviews(previous: CrownSector[], next: CrownSector[], reviews: CrownSectorReview[] = []): CrownSectorReview[] {
  return reviews.map((r) => previous.find((s) => s.id === r.id)?.count !== next.find((s) => s.id === r.id)?.count || previous.find((s) => s.id === r.id)?.candidateSignature !== next.find((s) => s.id === r.id)?.candidateSignature ? { id: r.id, status: "uncertain", reason: "The candidate layer changed after this review. Inspect this area again.", reviewer: "system" } : r);
}
/** Review cells are clipped to the actual selected polygon, including its holes. */
export function crownReviewFeatures(image: SamFrame & { area?: Polygon }, review: { sectors: CrownSector[]; reviews: CrownSectorReview[] } | null): FeatureCollection<Polygon> {
  const clip: polygonClipping.Polygon = image.area ? image.area.coordinates.map((ring) => ring.map((p) => lngLatToImagePixel(image, p as [number, number]))) : [[[0, 0], [image.width, 0], [image.width, image.height], [0, image.height], [0, 0]]];
  return { type: "FeatureCollection", features: review?.sectors.flatMap((s) => {
    const r = review.reviews.find((r) => r.id === s.id);
    const rectangles: polygonClipping.Polygon = [[[s.x, s.y], [s.x + s.width, s.y], [s.x + s.width, s.y + s.height], [s.x, s.y + s.height], [s.x, s.y]]];
    return polygonClipping.intersection(clip, rectangles).map((polygon) => ({ type: "Feature" as const, properties: { kind: "sector-review", sectorId: s.id, count: s.count, status: r?.status ?? "unreviewed", reason: r?.reason ?? "Not reviewed", reviewer: r?.reviewer ?? "none" }, geometry: { type: "Polygon" as const, coordinates: polygon.map((ring) => ring.map(([x, y]) => imagePixelToLngLat(image, x, y))) } }));
  }) ?? [] };
}
