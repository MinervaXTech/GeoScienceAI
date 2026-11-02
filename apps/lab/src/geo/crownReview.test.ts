import { describe, expect, it } from "vitest";
import { crownReviewFeatures, crownReviewSummary, invalidateChangedReviews, validateSectorReviews, type CrownSectorReview } from "./crownReview";
import { countSectorMatches, type CrownSector } from "./crownCoverage";
import { imagePixelToLngLat, lngLatToImagePixel, type SamFrame } from "./sam";
const sectors: CrownSector[] = [{ id: "A1", x: 0, y: 0, width: 16, height: 16, count: 1, validPixels: 256 }, { id: "B1", x: 16, y: 0, width: 16, height: 16, count: 0, validPixels: 256 }];
const review = (id: string, status: CrownSectorReview["status"]): CrownSectorReview => ({ id, status, reason: "Visible image inspected." });
describe("explicit review of every polygon sector", () => {
  it("does not interpret empty detections as confirmed coverage", () => {
    expect(crownReviewSummary(sectors)).toMatchObject({ complete: false, unreviewed: 2, pending: 2 });
    expect(crownReviewSummary(sectors, [review("A1", "crowns_accounted_for")])).toMatchObject({ complete: false, pending: 1 });
    expect(crownReviewSummary(sectors, [review("A1", "crowns_accounted_for"), review("B1", "no_visible_palms")])).toMatchObject({ complete: true, resolved: 2 });
  });
  it("leaves uncertain, missed and contradictory assessments pending", () => {
    for (const status of ["uncertain", "missed_palms", "crowns_accounted_for"] as const) expect(crownReviewSummary(sectors, [review("A1", "crowns_accounted_for"), review("B1", status)])).toMatchObject({ complete: false, pending: 1 });
    expect(crownReviewSummary(sectors, [review("A1", "no_visible_palms")]).conflicts).toBe(1);
  });
  it("invalidates assessments when locations or sizes change even if counts stay equal", () => {
    const a = countSectorMatches(sectors, [{ x: 1, y: 1, width: 8, height: 8, score: 1, scale: 1 }]);
    const b = countSectorMatches(sectors, [{ x: 2, y: 1, width: 8, height: 8, score: 1, scale: 1 }]);
    expect(invalidateChangedReviews(a, b, [review("A1", "crowns_accounted_for")])[0]).toMatchObject({ status: "uncertain", reviewer: "system" });
    expect(invalidateChangedReviews(a, a, [review("A1", "crowns_accounted_for")])[0]!.status).toBe("crowns_accounted_for");
  });
  it("rejects duplicate/outside IDs and prevents the model claiming user review", () => {
    expect(() => validateSectorReviews([review("A1", "uncertain"), review("A1", "uncertain")])).toThrow();
    expect(() => validateSectorReviews([review("B1", "uncertain")], ["A1"])).toThrow();
    expect(validateSectorReviews([{ ...review("A1", "uncertain"), reviewer: "user" }])[0]).not.toHaveProperty("reviewer");
  });
  it("clips map review cells to polygon edges and excludes holes", () => {
    const frame: SamFrame = { width: 32, height: 32, corners: [[101, 3], [102, 3], [102, 2], [101, 2]] };
    const area = { type: "Polygon" as const, coordinates: [[[0, 0], [12, 0], [12, 32], [0, 32], [0, 0]], [[2, 2], [2, 6], [6, 6], [6, 2], [2, 2]]].map((ring) => ring.map(([x, y]) => imagePixelToLngLat(frame, x!, y!))) };
    const features = crownReviewFeatures({ ...frame, area }, { sectors, reviews: [] }).features;
    expect(features).toHaveLength(1); expect(features[0]!.properties).toMatchObject({ sectorId: "A1", status: "unreviewed" });
    expect(features[0]!.geometry.coordinates).toHaveLength(2);
    for (const ring of features[0]!.geometry.coordinates) for (const p of ring) expect(lngLatToImagePixel(frame, p as [number, number])[0]).toBeLessThanOrEqual(12.000001);
  });
});
