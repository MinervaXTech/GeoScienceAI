// HACKATHON-NEW (2026-10-30): deterministic candidate crown peaks from a CHMv2
// predicted canopy-height grid. Outputs are "candidate crown peaks", not trees:
// no species, field validation or accuracy is implied.
//
// Method (thresholds confirmed by the user 2026-10-30):
// 1. Exclusion: 4-connected areas of raw height >= exclusionMinHeightM whose
//    ground area exceeds exclusionMinAreaM2 are treated as non-crown.
// 2. Smoothing: 3x3 mean over valid (non-NoData) neighbours.
// 3. Candidates: cells with raw height >= minHeightM, outside exclusions, whose
//    smoothed value is >= every valid 8-neighbour's smoothed value.
// 4. Suppression: candidates sorted by smoothed height, raw height, row, column;
//    a candidate is kept only if no kept peak lies within minDistanceM.
// Ground metres = EPSG:3857 metres * cos(latitude) (Web Mercator scale factor).

const R = 6378137;

export const DEFAULT_PARAMS = Object.freeze({
  minHeightM: 5,
  minDistanceM: 6,
  smoothing: "mean3x3",
  exclusionMinHeightM: 15,
  exclusionMinAreaM2: 100,
});

export const toWgs84 = (x, y) => [
  ((x / R) * 180) / Math.PI,
  ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI,
];

export function checkRaster(r) {
  if (
    r.crs !== "EPSG:3857" ||
    r.transform?.length !== 6 ||
    r.transform[1] !== 0 ||
    r.transform[3] !== 0 ||
    !(r.transform[0] > 0) ||
    !(r.transform[4] < 0) ||
    r.values?.length !== r.width * r.height
  )
    throw Error("Expected a north-up EPSG:3857 grid in Rasterio affine order.");
  for (const v of r.values)
    if (v !== null && !(Number.isFinite(v) && v >= 0))
      throw Error("Heights must be finite, non-negative or null.");
}

export function detectPeaks(r, params = DEFAULT_PARAMS) {
  checkRaster(r);
  const p = { ...DEFAULT_PARAMS, ...params };
  const { width: W, height: H, values } = r,
    [dx, , x0, , dy, y0] = r.transform,
    centre = (col, row) => [x0 + (col + 0.5) * dx, y0 + (row + 0.5) * dy],
    scaleAt = (row) => Math.cos((toWgs84(0, centre(0, row)[1])[1] * Math.PI) / 180),
    cellAreaM2 = (row) => Math.abs(dx * dy) * scaleAt(row) ** 2;

  // 1. Exclusion areas.
  const excluded = new Uint8Array(W * H),
    seen = new Uint8Array(W * H),
    exclusions = [];
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || !(values[i] >= p.exclusionMinHeightM)) continue;
    const stack = [i],
      cells = [];
    seen[i] = 1;
    let area = 0;
    while (stack.length) {
      const j = stack.pop(),
        x = j % W,
        y = (j - x) / W;
      cells.push(j);
      area += cellAreaM2(y);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + ox,
          yy = y + oy,
          k = yy * W + xx;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && !seen[k] && values[k] >= p.exclusionMinHeightM) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    if (area > p.exclusionMinAreaM2) {
      for (const j of cells) excluded[j] = 1;
      const cols = cells.map((j) => j % W),
        rows = cells.map((j) => Math.floor(j / W));
      exclusions.push({
        cells: cells.length,
        areaM2: area,
        rows: [Math.min(...rows), Math.max(...rows)],
        cols: [Math.min(...cols), Math.max(...cols)],
      });
    }
  }

  // 2. Smoothing.
  const smooth = new Array(W * H).fill(null);
  if (p.smoothing !== "mean3x3" && p.smoothing !== "none")
    throw Error("smoothing must be mean3x3 or none");
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (values[i] === null) continue;
      if (p.smoothing === "none") {
        smooth[i] = values[i];
        continue;
      }
      let s = 0,
        n = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const xx = x + ox,
            yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const v = values[yy * W + xx];
          if (v !== null) {
            s += v;
            n++;
          }
        }
      smooth[i] = s / n;
    }

  // 3. Local-maximum candidates.
  const candidates = [];
  let excludedMaxima = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (values[i] === null || values[i] < p.minHeightM) continue;
      let isMax = true;
      for (let oy = -1; oy <= 1 && isMax; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const xx = x + ox,
            yy = y + oy;
          if ((!ox && !oy) || xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const s = smooth[yy * W + xx];
          if (s !== null && s > smooth[i]) {
            isMax = false;
            break;
          }
        }
      if (!isMax) continue;
      if (excluded[i]) excludedMaxima++;
      else candidates.push({ row: y, col: x, raw: values[i], smoothed: smooth[i] });
    }

  // 4. Minimum-distance suppression in ground metres.
  candidates.sort(
    (a, b) => b.smoothed - a.smoothed || b.raw - a.raw || a.row - b.row || a.col - b.col,
  );
  const kept = [];
  for (const c of candidates) {
    const [cx, cy] = centre(c.col, c.row),
      k = scaleAt(c.row);
    if (
      kept.every(
        (q) => Math.hypot(q.x - cx, q.y - cy) * ((k + scaleAt(q.row)) / 2) >= p.minDistanceM,
      )
    )
      kept.push({ ...c, x: cx, y: cy });
  }
  kept.sort((a, b) => a.row - b.row || a.col - b.col);

  // Statistics.
  let validAreaM2 = 0,
    canopyAreaM2 = 0;
  for (let i = 0; i < W * H; i++) {
    if (values[i] === null) continue;
    const a = cellAreaM2(Math.floor(i / W));
    validAreaM2 += a;
    if (values[i] >= p.minHeightM && !excluded[i]) canopyAreaM2 += a;
  }
  const nn = kept.map((a, i) => {
    let best = Infinity;
    kept.forEach((b, j) => {
      if (i !== j)
        best = Math.min(
          best,
          Math.hypot(a.x - b.x, a.y - b.y) * ((scaleAt(a.row) + scaleAt(b.row)) / 2),
        );
    });
    return best;
  });
  return {
    params: p,
    peaks: kept.map((c, i) => ({
      id: i + 1,
      row: c.row,
      col: c.col,
      heightM: c.raw,
      smoothedHeightM: c.smoothed,
      epsg3857: [c.x, c.y],
      wgs84: toWgs84(c.x, c.y),
      nearestNeighbourM: Number.isFinite(nn[i]) ? nn[i] : null,
    })),
    exclusions,
    excludedCells: [...excluded.keys()].filter((i) => excluded[i]),
    stats: {
      count: kept.length,
      localMaximaInsideExclusions: excludedMaxima,
      validAreaHa: validAreaM2 / 1e4,
      canopyAreaHa: canopyAreaM2 / 1e4,
      perHectareOfValidArea: kept.length / (validAreaM2 / 1e4),
      perHectareOfCanopyArea: canopyAreaM2 ? kept.length / (canopyAreaM2 / 1e4) : null,
      nearestNeighbourM: summarize(nn.filter(Number.isFinite)),
    },
  };
}

export function summarize(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b),
    q = (f) => {
      const t = f * (s.length - 1),
        lo = Math.floor(t);
      return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (t - lo);
    },
    histogram = {};
  for (const v of s) {
    const bin = `${Math.floor(v)}-${Math.floor(v) + 1}`;
    histogram[bin] = (histogram[bin] ?? 0) + 1;
  }
  return {
    n: s.length,
    min: s[0],
    p10: q(0.1),
    p25: q(0.25),
    median: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
    max: s.at(-1),
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    histogram1m: histogram,
  };
}

export function toGeoJSON(result, source) {
  return {
    type: "FeatureCollection",
    name: "candidate crown peaks",
    meaning:
      "Local maxima of historical CHMv2 predicted canopy height. Not trees, species labels or field-verified crowns.",
    source,
    detector: { version: "openpalm-tree-peaks-v1", ...result.params },
    stats: result.stats,
    exclusions: result.exclusions,
    features: result.peaks.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: p.wgs84 },
      properties: {
        kind: "candidate crown peak",
        id: p.id,
        heightM: p.heightM,
        smoothedHeightM: p.smoothedHeightM,
        wgs84: p.wgs84,
        epsg3857: p.epsg3857,
        nativeRow: p.row,
        nativeCol: p.col,
        nearestNeighbourM: p.nearestNeighbourM,
        sourceId: source.sourceSubsetSha256,
        sourceDate: source.sourceDate,
        detector: { version: "openpalm-tree-peaks-v1", ...result.params },
      },
    })),
  };
}
