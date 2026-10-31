// HACKATHON-NEW (2026-10-30): two registered tour algorithms over candidate
// crown peaks, plus route metrics. Both are our own implementations of
// standard methods; no third-party routing code is copied.
//
// Route shape (user-confirmed 2026-10-30): closed tour that starts and ends at
// a home point, visiting every peak exactly once. Coordinates are local metres
// (UTM zone 47N, EPSG:32647); see project.mjs.

export const ALGORITHMS = Object.freeze({
  A: Object.freeze({
    id: "A",
    name: "nearest-neighbour tour",
    version: "openpalm-nn-1.0.0",
    method:
      "From home, repeatedly move to the nearest unvisited peak (ties: lower peak id), then return home.",
    reference:
      "Rosenkrantz, Stearns & Lewis (1977), An Analysis of Several Heuristics for the Traveling Salesman Problem, SIAM J. Comput. 6(3):563-581",
    doi: "10.1137/0206041",
    licence: "Own implementation for this project; no third-party code",
    ownReimplementation: true,
  }),
  B: Object.freeze({
    id: "B",
    name: "nearest-neighbour start + 2-opt",
    version: "openpalm-nn2opt-1.0.0",
    method:
      "Start from algorithm A's tour; repeatedly apply the first improving 2-opt segment reversal in fixed (i, j) order until no reversal shortens the closed tour by more than 1e-9 m. Home stays first.",
    reference:
      "Croes (1958), A Method for Solving Traveling-Salesman Problems, Operations Research 6(6):791-812",
    doi: "10.1287/opre.6.6.791",
    licence: "Own implementation for this project; no third-party code",
    ownReimplementation: true,
  }),
});

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** points: [{ id, x, y }], home: { x, y }. Returns visiting order as point indices. */
export function nearestNeighbour(points, home) {
  const left = new Set(points.keys()),
    order = [];
  let at = home;
  while (left.size) {
    let best = -1,
      bestD = Infinity;
    for (const i of left) {
      const d = dist(at, points[i]);
      if (d < bestD - 1e-12 || (Math.abs(d - bestD) <= 1e-12 && points[i].id < points[best].id)) {
        best = i;
        bestD = d;
      }
    }
    order.push(best);
    left.delete(best);
    at = points[best];
  }
  return order;
}

export function twoOpt(points, home, start, maxPasses = 10_000) {
  // Cycle s[0] = home, s[1..n] = peaks; reversals never touch index 0.
  const s = [home, ...start.map((i) => points[i])],
    idx = [-1, ...start],
    N = s.length;
  let passes = 0,
    improved = true;
  while (improved) {
    if (++passes > maxPasses) throw Error("2-opt pass cap reached");
    improved = false;
    for (let i = 0; i < N - 2 && !improved; i++)
      for (let j = i + 2; j < N; j++) {
        if (i === 0 && j === N - 1) continue; // adjacent edges around home
        const a = s[i],
          b = s[i + 1],
          c = s[j],
          d = s[(j + 1) % N];
        if (dist(a, c) + dist(b, d) < dist(a, b) + dist(c, d) - 1e-9) {
          for (let l = i + 1, r = j; l < r; l++, r--) {
            [s[l], s[r]] = [s[r], s[l]];
            [idx[l], idx[r]] = [idx[r], idx[l]];
          }
          improved = true;
          break;
        }
      }
  }
  return { order: idx.slice(1), passes };
}

export function runAlgorithm(id, points, home) {
  if (id === "A") return { order: nearestNeighbour(points, home), passes: null };
  if (id === "B") return twoOpt(points, home, nearestNeighbour(points, home));
  throw Error(`Unknown algorithm ${id}`);
}

/** Turning angle in degrees at b between legs a->b and b->c (0 = straight on). */
export function turnDeg(a, b, c) {
  const u = [b.x - a.x, b.y - a.y],
    v = [c.x - b.x, c.y - b.y],
    nu = Math.hypot(...u),
    nv = Math.hypot(...v);
  if (!nu || !nv) return 0;
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (nu * nv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Metrics for home -> peaks in order -> home.
 * Turning is measured at peak vertices only (home is launch/landing).
 * Climb/descent is a proxy: differences of CHMv2 predicted height between
 * consecutive peaks; home legs are excluded because home has no CHMv2 value.
 * It is not an energy model and not a flight altitude profile.
 */
export function routeMetrics(points, home, order) {
  if (new Set(order).size !== points.length || order.length !== points.length)
    throw Error("Route must visit every point exactly once.");
  const path = [home, ...order.map((i) => points[i]), home];
  let lengthM = 0,
    turnSumDeg = 0,
    turnsOver45 = 0,
    climbM = 0,
    descentM = 0;
  for (let k = 1; k < path.length; k++) lengthM += dist(path[k - 1], path[k]);
  for (let k = 1; k < path.length - 1; k++) {
    const t = turnDeg(path[k - 1], path[k], path[k + 1]);
    turnSumDeg += t;
    if (t > 45) turnsOver45++;
  }
  for (let k = 1; k < order.length; k++) {
    const dh = points[order[k]].h - points[order[k - 1]].h;
    if (dh > 0) climbM += dh;
    else descentM -= dh;
  }
  return {
    pathLengthM: lengthM,
    turnSumDeg,
    turnsOver45Deg: turnsOver45,
    turnVertices: order.length,
    heightProxy: {
      climbM,
      descentM,
      legsCounted: Math.max(0, order.length - 1),
      note: "Proxy only: CHMv2 predicted-height differences between consecutive peaks; not an energy model.",
    },
  };
}
