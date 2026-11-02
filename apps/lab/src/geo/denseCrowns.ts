/** Approximate dense crown coverage from original RGB texture. This estimates
 * centres over a canopy footprint; it is not an individual-tree classifier. */
export interface DenseCrownSeed { x: number; y: number; index: number; manual: boolean }
export interface DenseCrownJob { width: number; height: number; rgba: Uint8ClampedArray; spacingPx: number; sensitivity: number; seeds: DenseCrownSeed[]; limit?: number; heightMetres?: Float32Array; minimumHeightM?: number; samMask?: Uint8Array }
export interface DenseCrownOutput { points: { x: number; y: number; seedIndex?: number; canopyHeightM?: number }[]; mask: Uint8Array; eligiblePixels: number; coveredPixels: number; retainedCount: number; minSpacingPx: number; guidance: { samExcludedPixels: number; heightMissingPixels: number; belowHeightPixels: number; heightSupportedPixels: number } }
export function denseCrownCoverage(job: DenseCrownJob): DenseCrownOutput {
  const { width: w, height: h, rgba, spacingPx, sensitivity } = job;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 8 || h < 8 || w > 2048 || h > 2048 || rgba.length !== w * h * 4 || !Number.isFinite(spacingPx) || spacingPx < 4 || spacingPx > 200 || !Number.isFinite(sensitivity) || sensitivity < 0 || sensitivity > 1) throw Error("Invalid dense crown coverage settings. Use imagery with at least 4 pixels between trees.");
  if ((job.heightMetres && (job.heightMetres.length !== w * h || !Number.isFinite(job.minimumHeightM) || job.minimumHeightM! < 0 || job.minimumHeightM! > 254)) || (job.samMask && job.samMask.length !== w * h)) throw Error("Tree guidance does not match the original image frame.");
  const guidance = { samExcludedPixels: 0, heightMissingPixels: 0, belowHeightPixels: 0, heightSupportedPixels: 0 }, allowed = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (rgba[p * 4 + 3]! < 250) continue;
    if (job.samMask && !job.samMask[p]) { guidance.samExcludedPixels++; continue; }
    if (job.heightMetres) {
      const height = job.heightMetres[p]!;
      if (!Number.isFinite(height) || height < 0 || height > 254) { guidance.heightMissingPixels++; continue; }
      if (height < job.minimumHeightM!) { guidance.belowHeightPixels++; continue; }
      guidance.heightSupportedPixels++;
    }
    allowed[p] = 1;
  }
  const stride = w + 1, size = stride * (h + 1), valid = new Float64Array(size), green = new Float64Array(size), sum = new Float64Array(size), square = new Float64Array(size), gradientX = new Float64Array(size), gradientY = new Float64Array(size), luma = new Float32Array(w * h), isGreen = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * 4, r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!, v = rgba[i + 3]! >= 250 ? 1 : 0;
    const value = v ? .299 * r + .587 * g + .114 * b : 0; luma[p] = value;
    const veg = v && g > r * 1.015 && g > b * 1.04 && 2 * g - r - b > 5 && value > 7 ? 1 : 0; isGreen[p] = veg;
    const at = (y + 1) * stride + x + 1;
    const gx = v && x > 0 && rgba[i - 1]! >= 250 ? Math.abs(value - luma[p - 1]!) : 0;
    const gy = v && y > 0 && rgba[i - w * 4 + 3]! >= 250 ? Math.abs(value - luma[p - w]!) : 0;
    for (const [array, sample] of [[valid, v], [green, veg], [sum, value], [square, value * value], [gradientX, gx], [gradientY, gy]] as const) array[at] = sample + array[at - 1]! + array[at - stride]! - array[at - stride - 1]!;
  }
  const region = (a: Float64Array, x: number, y: number, radius: number) => { const x0 = Math.max(0, x - radius), y0 = Math.max(0, y - radius), x1 = Math.min(w, x + radius + 1), y1 = Math.min(h, y + radius + 1); return a[y1 * stride + x1]! - a[y0 * stride + x1]! - a[y1 * stride + x0]! + a[y0 * stride + x0]!; };
  const radius = Math.max(2, Math.round(spacingPx * .3)), core = Math.max(1, Math.round(spacingPx * .12)), mask = new Uint8Array(w * h), score = new Float32Array(w * h);
  const minTexture = 5 - sensitivity * 4, minGreen = .65 - sensitivity * .3;
  let eligiblePixels = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; if (!isGreen[p] || !allowed[p]) continue;
    const count = region(valid, x, y, radius); if (count < (2 * radius + 1) ** 2 * .4 || region(green, x, y, radius) / count < minGreen) continue;
    const mean = region(sum, x, y, radius) / count, variance = Math.max(0, region(square, x, y, radius) / count - mean * mean), texture = Math.sqrt(variance);
    if (texture < minTexture || Math.min(region(gradientX, x, y, radius), region(gradientY, x, y, radius)) / count < .3 + (1 - sensitivity) * 1.2) continue;
    mask[p] = 1; eligiblePixels++;
    const coreCount = region(valid, x, y, core), bright = coreCount ? region(sum, x, y, core) / coreCount : luma[p]!;
    let heightPeak = 0;
    if (job.heightMetres) {
      const height = job.heightMetres[p]!, neighbours = [[x - radius, y], [x + radius, y], [x, y - radius], [x, y + radius]].filter(([nx, ny]) => nx! >= 0 && ny! >= 0 && nx! < w && ny! < h).map(([nx, ny]) => job.heightMetres![ny! * w + nx!]!).filter(Number.isFinite);
      heightPeak = height * .1 + (neighbours.length ? height - neighbours.reduce((a, b) => a + b, 0) / neighbours.length : 0) * 1.5;
    }
    score[p] = bright - mean + texture * .25 + heightPeak;
  }
  if (!eligiblePixels) throw Error(job.heightMetres || job.samMask ? `No tree cover satisfies the enabled CHMv2/SAM constraints and RGB filter. Check the loaded SAM output and height threshold. CHMv2: ${guidance.heightMissingPixels} missing-height pixels, ${guidance.belowHeightPixels} below threshold; ${guidance.samExcludedPixels} pixels outside SAM. Previous points are retained.` : "No textured tree cover found at these settings. Increase canopy sensitivity or use a clearer original capture.");
  const minSpacingPx = spacingPx * .85, cell = minSpacingPx, buckets = new Map<string, { x: number; y: number }[]>(), points: DenseCrownOutput["points"] = [];
  const near = (x: number, y: number, distance: number) => {
    const bx = Math.floor(x / cell), by = Math.floor(y / cell), reach = Math.ceil(distance / cell);
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) for (const q of buckets.get(`${bx + dx}:${by + dy}`) ?? []) if ((q.x - x) ** 2 + (q.y - y) ** 2 < distance ** 2) return true;
    return false;
  };
  const add = (point: DenseCrownOutput["points"][number]) => {
    if (near(point.x, point.y, minSpacingPx)) return;
    if (points.length >= (job.limit ?? 5000)) throw Error("Dense coverage exceeds 5000 points. Increase estimated tree spacing or choose a smaller polygon; coverage was not truncated.");
    if (job.heightMetres) point.canopyHeightM = job.heightMetres[Math.floor(point.y) * w + Math.floor(point.x)];
    points.push(point); const key = `${Math.floor(point.x / cell)}:${Math.floor(point.y / cell)}`, bucket = buckets.get(key) ?? []; bucket.push(point); buckets.set(key, bucket);
  };
  for (const s of job.seeds) { const x = Math.floor(s.x), y = Math.floor(s.y); if (x >= 0 && y >= 0 && x < w && y < h && allowed[y * w + x] && (s.manual || mask[y * w + x])) add({ x: s.x, y: s.y, seedIndex: s.index }); }
  const retainedCount = points.length, candidates: number[] = [];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (mask[y * w + x]) candidates.push(y * w + x);
  candidates.sort((a, b) => score[b]! - score[a]! || a - b);
  for (const p of candidates) add({ x: p % w + .5, y: Math.floor(p / w) + .5 });
  // Close residual holes, including narrow canopy strips missed by the coarse scan.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] && !near(x + .5, y + .5, spacingPx)) add({ x: x + .5, y: y + .5 });
  let coveredPixels = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] && near(x + .5, y + .5, spacingPx * 1.001)) coveredPixels++;
  return { points, mask, eligiblePixels, coveredPixels, retainedCount, minSpacingPx, guidance };
}
