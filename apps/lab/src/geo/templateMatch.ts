import type { FeatureCollection, Point, Polygon } from "geojson";
import { imagePixelToLngLat, type SamImage } from "./sam";
import type { MuseImage } from "./muse";
import type { CrownAgentRun } from "./crownAgent";
import type { CrownCoverageResult } from "./crownCoverage";
import type { CrownConstraintReport } from "./crownPhysical";

export interface PixelRect { x: number; y: number; width: number; height: number }
export interface CrownMatch extends PixelRect { score: number; scale: number; templateRound?: number; radiusPx?: number }
export interface MatchingSettings { threshold: number; multiScale: boolean; spacing: number }
export type CrownImage = SamImage | MuseImage;
export const DEFAULT_MATCHING_SETTINGS: MatchingSettings = { threshold: 0.65, multiScale: true, spacing: 0.65 };
export interface CrownMatchResult {
  method: "normalized-cross-correlation-v1" | "multi-template-ncc-v1";
  mapId: string;
  receivedAt: string;
  durationMs: number;
  image: CrownImage;
  sample: PixelRect;
  settings: MatchingSettings;
  matches: CrownMatch[];
  truncated: boolean;
  agent?: CrownAgentRun;
  coverage?: CrownCoverageResult;
  rawMatches?: CrownMatch[];
  physical?: CrownConstraintReport;
}
export interface MatchJob { width: number; height: number; rgba: Uint8ClampedArray; sample: PixelRect; settings: MatchingSettings }

function validate(job: MatchJob) {
  const { width, height, rgba, sample: s, settings } = job;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024 || rgba.length !== width * height * 4) throw Error("Capture an image up to 1024 × 1024 pixels for matching.");
  if (![s.x, s.y, s.width, s.height].every(Number.isInteger) || s.x < 0 || s.y < 0 || s.x + s.width > width || s.y + s.height > height || Math.min(s.width, s.height) < 6 || Math.max(s.width, s.height) > 64) throw Error("Draw a sample around one crown, between 6 and 64 image pixels on each side. Zoom the preview for easier selection.");
  if (!Number.isFinite(settings.threshold) || settings.threshold < 0.4 || settings.threshold > 0.99 || !Number.isFinite(settings.spacing) || settings.spacing < 0.25 || settings.spacing > 2 || typeof settings.multiScale !== "boolean") throw Error("Invalid matching sensitivity or spacing.");
  for (let y = s.y; y < s.y + s.height; y++) for (let x = s.x; x < s.x + s.width; x++) {
    if (rgba[(y * width + x) * 4 + 3]! < 250) throw Error("Select a crown fully inside the polygon, away from transparent edges.");
  }
}

/** Exact zero-mean NCC on grayscale pixels; transparent windows are excluded. */
export function matchCrowns(job: MatchJob, progress: (value: number) => void = () => {}) {
  validate(job);
  const { width, height, rgba, sample, settings } = job;
  const gray = new Float32Array(width * height);
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  const squares = new Float64Array(sum.length), invalid = new Uint32Array(sum.length);
  for (let y = 0; y < height; y++) {
    let rowSum = 0, rowSquares = 0, rowInvalid = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x, value = rgba[i * 4]! * 0.2126 + rgba[i * 4 + 1]! * 0.7152 + rgba[i * 4 + 2]! * 0.0722;
      gray[i] = value; rowSum += value; rowSquares += value * value; rowInvalid += rgba[i * 4 + 3]! < 250 ? 1 : 0;
      const p = (y + 1) * stride + x + 1;
      sum[p] = sum[p - stride]! + rowSum; squares[p] = squares[p - stride]! + rowSquares; invalid[p] = invalid[p - stride]! + rowInvalid;
    }
  }
  const rectangle = (integral: Float64Array | Uint32Array, x: number, y: number, w: number, h: number) => integral[(y + h) * stride + x + w]! - integral[y * stride + x + w]! - integral[(y + h) * stride + x]! + integral[y * stride + x]!;
  const original = new Float32Array(sample.width * sample.height);
  let originalSum = 0;
  for (let y = 0; y < sample.height; y++) for (let x = 0; x < sample.width; x++) {
    const value = gray[(sample.y + y) * width + sample.x + x]!;
    original[y * sample.width + x] = value; originalSum += value;
  }
  const mean = originalSum / original.length;
  if (original.reduce((v, p) => v + (p - mean) ** 2, 0) / original.length < 9) throw Error("This sample has too little texture. Select a distinct crown with visible fronds and some surrounding contrast.");
  const scales = settings.multiScale ? [0.8, 1, 1.2] : [1];
  const candidates: CrownMatch[] = [];
  const sizes = new Set<string>();
  for (let scaleIndex = 0; scaleIndex < scales.length; scaleIndex++) {
    const scale = scales[scaleIndex]!;
    const tw = Math.max(4, Math.round(sample.width * scale)), th = Math.max(4, Math.round(sample.height * scale));
    if (tw > width || th > height || sizes.has(`${tw}:${th}`)) continue;
    sizes.add(`${tw}:${th}`);
    const template = new Float32Array(tw * th);
    let total = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const sx = Math.max(0, Math.min(sample.width - 1, (x + 0.5) / tw * sample.width - 0.5));
      const sy = Math.max(0, Math.min(sample.height - 1, (y + 0.5) / th * sample.height - 0.5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(sample.width - 1, x0 + 1), y1 = Math.min(sample.height - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      const value = original[y0 * sample.width + x0]! * (1 - fx) * (1 - fy) + original[y0 * sample.width + x1]! * fx * (1 - fy) + original[y1 * sample.width + x0]! * (1 - fx) * fy + original[y1 * sample.width + x1]! * fx * fy;
      template[y * tw + x] = value; total += value;
    }
    const average = total / template.length;
    let energy = 0;
    for (let i = 0; i < template.length; i++) { template[i] = template[i]! - average; energy += template[i]! ** 2; }
    const score = (x: number, y: number) => {
      if (x < 0 || y < 0 || x + tw > width || y + th > height || rectangle(invalid, x, y, tw, th)) return -1;
      const windowSum = rectangle(sum, x, y, tw, th);
      const variance = rectangle(squares, x, y, tw, th) - windowSum * windowSum / template.length;
      if (variance < template.length || energy < 1) return -1;
      let numerator = 0;
      for (let ty = 0; ty < th; ty++) {
        const sourceOffset = (y + ty) * width + x, templateOffset = ty * tw;
        for (let tx = 0; tx < tw; tx++) numerator += gray[sourceOffset + tx]! * template[templateOffset + tx]!;
      }
      return Math.max(-1, Math.min(1, numerator / Math.sqrt(variance * energy)));
    };
    // Coarse scan followed by full-resolution refinement around local peaks.
    const step = Math.max(1, Math.min(3, Math.floor(Math.min(tw, th) / 8)));
    const cols = Math.floor((width - tw) / step) + 1, rows = Math.floor((height - th) / step) + 1;
    const scores = new Float32Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) scores[y * cols + x] = score(x * step, y * step);
      if (y % 16 === 0) progress(Math.round((scaleIndex + y / rows * 0.85) / scales.length * 100));
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const current = scores[y * cols + x]!;
      if (current < settings.threshold - 0.25) continue;
      let peak = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (x + dx >= 0 && x + dx < cols && y + dy >= 0 && y + dy < rows && scores[(y + dy) * cols + x + dx]! > current) peak = false;
      }
      if (!peak) continue;
      let best = { x: x * step, y: y * step, score: current };
      for (let dy = 1 - step; dy < step; dy++) for (let dx = 1 - step; dx < step; dx++) {
        const value = score(x * step + dx, y * step + dy);
        if (value > best.score) best = { x: x * step + dx, y: y * step + dy, score: value };
      }
      if (best.score >= settings.threshold) candidates.push({ ...best, width: tw, height: th, scale });
    }
    // Always evaluate the selected sample, even if its origin misses the grid.
    if (scale === 1) candidates.push({ ...sample, score: score(sample.x, sample.y), scale });
    progress(Math.round((scaleIndex + 1) / scales.length * 100));
  }
  candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const matches: CrownMatch[] = [];
  let truncated = false;
  for (const c of candidates) {
    if (c.score < settings.threshold) continue;
    const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
    if (matches.some((m) => {
      const ix = Math.max(0, Math.min(c.x + c.width, m.x + m.width) - Math.max(c.x, m.x));
      const iy = Math.max(0, Math.min(c.y + c.height, m.y + m.height) - Math.max(c.y, m.y));
      return ix * iy / (c.width * c.height + m.width * m.height - ix * iy) > 0.25 || Math.hypot(cx - m.x - m.width / 2, cy - m.y - m.height / 2) < settings.spacing * Math.min(c.width, c.height, m.width, m.height);
    })) continue;
    if (matches.length === 2000) { truncated = true; break; }
    matches.push(c);
  }
  return { matches, truncated };
}

export function crownMatchFeatures(result: CrownMatchResult | null): FeatureCollection<Point | Polygon> {
  return { type: "FeatureCollection", features: result?.matches.flatMap((match, i) => {
    const properties = { candidateId: i + 1, similarity: match.score, scale: match.scale, method: result.method, centerX: match.x + match.width / 2, centerY: match.y + match.height / 2, ...(match.radiusPx !== undefined ? { radiusPx: match.radiusPx } : {}), ...(match.templateRound !== undefined ? { templateRound: match.templateRound } : {}) };
    const pixel = (x: number, y: number) => imagePixelToLngLat(result.image, x, y);
    const ring = match.radiusPx !== undefined
      ? Array.from({ length: 49 }, (_, n) => { const angle = (n % 48) / 48 * Math.PI * 2; return pixel(properties.centerX + match.radiusPx! * Math.cos(angle), properties.centerY + match.radiusPx! * Math.sin(angle)); })
      : [pixel(match.x, match.y), pixel(match.x + match.width, match.y), pixel(match.x + match.width, match.y + match.height), pixel(match.x, match.y + match.height), pixel(match.x, match.y)];
    return [
      { type: "Feature" as const, properties: { ...properties, kind: "center" }, geometry: { type: "Point" as const, coordinates: pixel(match.x + match.width / 2, match.y + match.height / 2) } },
      { type: "Feature" as const, properties: { ...properties, kind: match.radiusPx !== undefined ? "circle" : "box" }, geometry: { type: "Polygon" as const, coordinates: [ring] } },
    ];
  }) ?? [] };
}
