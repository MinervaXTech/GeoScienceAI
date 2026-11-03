/**
 * Environments for paper reproduction runs: a small library of worlds that runs reuse. A world is either a fixed grid map
 * (for example digitised from a paper's figure) or a generator that produces random grid maps from stated parameters.
 * This file holds the shapes, the validation and the deterministic generator, so the server, the UI and tests agree.
 */
export type EnvOrigin = "digitised" | "generated-from-parameters" | "generated-from-description" | "satellite" | "manual";
export type EnvStatus = "candidate" | "approved";
export type EnvCreator = "app" | "user" | "muse" | "agent";
export type Cell = [number, number];

export interface EnvGrid { rows: number; cols: number; ascii: string[] }
export interface EnvGenerator { type: "random-obstacles"; rows: number; cols: number; density: number; seedBase: number; start: Cell; goal: Cell; instances: number }
export interface EnvSource { paperId?: string; paperTitle?: string; figure?: string; note: string }
export interface EnvironmentInput {
  name: string;
  description: string;
  origin: EnvOrigin;
  source: EnvSource;
  grid?: EnvGrid;
  generator?: EnvGenerator;
  start?: Cell;
  goal?: Cell;
  targets?: Cell[];
  dynamicObstacles?: [number, number][];
  scale?: { cellMeters?: number; note: string };
  assumptions?: string[];
}
export interface EnvChecks { solvable: boolean; notes: string[]; checkedAt: string }
export interface Environment extends EnvironmentInput {
  id: string; status: EnvStatus; version: number; hash: string; checks: EnvChecks; createdBy: EnvCreator; createdAt: string; updatedAt: string; parentId?: string;
}

export const ENV_ID = /^env-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ORIGIN_TEXT: Record<EnvOrigin, string> = { digitised: "Digitised from the paper", "generated-from-parameters": "Generated from stated parameters", "generated-from-description": "Generated from a loose description", satellite: "From satellite imagery", manual: "Made by hand" };
export const MAX_SIDE = 120;
export const MAX_INSTANCES = 50;
export const validEnvId = (id: unknown): id is string => typeof id === "string" && id.length <= 60 && ENV_ID.test(id);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const int = (v: unknown) => Number.isInteger(v) ? v as number : undefined;

function cell(v: unknown, rows: number, cols: number, name: string): Cell {
  if (!Array.isArray(v) || v.length !== 2 || !Number.isInteger(v[0]) || !Number.isInteger(v[1])) throw Error(`${name} must be [row, col] whole numbers.`);
  if (v[0] < 0 || v[0] >= rows || v[1] < 0 || v[1] >= cols) throw Error(`${name} is outside the map.`);
  return [v[0], v[1]];
}

/** Turns untrusted input into a clean environment description, or throws a message saying what is wrong. */
export function validateEnvironmentInput(value: unknown): EnvironmentInput {
  if (!isObject(value)) throw Error("An environment must be an object.");
  const name = text(value.name, 80), description = text(value.description, 600);
  if (!name) throw Error("An environment needs a name.");
  const origin = value.origin as EnvOrigin;
  if (!(origin in ORIGIN_TEXT)) throw Error("Unknown origin.");
  const src = isObject(value.source) ? value.source : {};
  const source: EnvSource = { note: text(src.note, 500), ...(text(src.paperId, 80) ? { paperId: text(src.paperId, 80) } : {}), ...(text(src.paperTitle, 200) ? { paperTitle: text(src.paperTitle, 200) } : {}), ...(text(src.figure, 80) ? { figure: text(src.figure, 80) } : {}) };
  if (!source.note) throw Error("Say where this environment came from (source.note).");
  const out: EnvironmentInput = { name, description, origin, source };
  if (value.grid !== undefined && value.generator !== undefined) throw Error("Give either a fixed grid or a generator, not both.");
  if (value.grid === undefined && value.generator === undefined) throw Error("An environment needs a grid or a generator.");
  let rows: number, cols: number;
  if (value.grid !== undefined) {
    if (!isObject(value.grid) || !Array.isArray(value.grid.ascii)) throw Error("grid.ascii must be a list of rows.");
    const ascii = value.grid.ascii as unknown[];
    rows = ascii.length; cols = typeof ascii[0] === "string" ? (ascii[0] as string).length : 0;
    if (rows < 3 || rows > MAX_SIDE || cols < 3 || cols > MAX_SIDE) throw Error(`A map is 3 to ${MAX_SIDE} cells on each side.`);
    if (ascii.some(r => typeof r !== "string" || r.length !== cols || /[^#.]/.test(r))) throw Error('Every grid row must be the same length and use only "#" (blocked) and "." (free).');
    out.grid = { rows, cols, ascii: ascii as string[] };
  } else {
    const g = value.generator as Record<string, unknown>;
    if (!isObject(g) || g.type !== "random-obstacles") throw Error('generator.type must be "random-obstacles".');
    rows = int(g.rows) ?? 0; cols = int(g.cols) ?? 0;
    if (rows < 3 || rows > MAX_SIDE || cols < 3 || cols > MAX_SIDE) throw Error(`A map is 3 to ${MAX_SIDE} cells on each side.`);
    const density = typeof g.density === "number" ? g.density : NaN, instances = int(g.instances) ?? 30;
    if (!(density >= 0 && density <= 0.6)) throw Error("generator.density must be between 0 and 0.6.");
    if (instances < 1 || instances > MAX_INSTANCES) throw Error(`generator.instances must be 1 to ${MAX_INSTANCES}.`);
    out.generator = { type: "random-obstacles", rows, cols, density, seedBase: int(g.seedBase) ?? 0, start: cell(g.start ?? [0, 0], rows, cols, "generator.start"), goal: cell(g.goal ?? [rows - 1, cols - 1], rows, cols, "generator.goal"), instances };
  }
  if (value.start !== undefined) out.start = cell(value.start, rows, cols, "start");
  if (value.goal !== undefined) out.goal = cell(value.goal, rows, cols, "goal");
  if (value.targets !== undefined) {
    if (!Array.isArray(value.targets) || value.targets.length < 2 || value.targets.length > 12) throw Error("targets must list 2 to 12 [row, col] cells in route order.");
    out.targets = value.targets.map((t, i) => cell(t, rows, cols, `targets[${i}]`));
  }
  if (value.dynamicObstacles !== undefined) {
    if (!Array.isArray(value.dynamicObstacles) || value.dynamicObstacles.length > 50) throw Error("dynamicObstacles may hold at most 50 positions.");
    out.dynamicObstacles = value.dynamicObstacles.map((p, i) => { if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== "number" || typeof p[1] !== "number" || !(p[0] >= -1 && p[0] <= rows && p[1] >= -1 && p[1] <= cols)) throw Error(`dynamicObstacles[${i}] must be [row, col] inside the map.`); return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100] as [number, number]; });
  }
  if (isObject(value.scale)) { const m = value.scale.cellMeters; out.scale = { ...(typeof m === "number" && m > 0 && m <= 1000 ? { cellMeters: m } : {}), note: text(value.scale.note, 300) }; }
  if (Array.isArray(value.assumptions)) out.assumptions = value.assumptions.slice(0, 12).map(a => text(a, 300)).filter(Boolean);
  return out;
}

// ---- grids
export const gridFromAscii = (ascii: string[]): number[][] => ascii.map(r => [...r].map(c => c === "#" ? 1 : 0));
export const asciiFromGrid = (grid: number[][]): string[] => grid.map(r => r.map(c => c ? "#" : ".").join(""));

/** Shortest 8-connected route length without cutting corners, or null when there is none. */
export function shortestRoute(grid: number[][], from: Cell, to: Cell): number | null {
  const rows = grid.length, cols = grid[0]!.length, key = (r: number, c: number) => r * cols + c;
  if (grid[from[0]]![from[1]] || grid[to[0]]![to[1]]) return null;
  const dist = new Map<number, number>([[key(...from), 0]]), open: [number, Cell][] = [[0, from]];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [g, u] = open.shift()!;
    if (g > (dist.get(key(...u)) ?? Infinity)) continue;
    if (u[0] === to[0] && u[1] === to[1]) return g;
    for (const dr of [-1, 0, 1]) for (const dc of [-1, 0, 1]) {
      if (!dr && !dc) continue;
      const r = u[0] + dr, c = u[1] + dc;
      if (r < 0 || c < 0 || r >= rows || c >= cols || grid[r]![c]) continue;
      if (dr && dc && (grid[u[0]]![c] || grid[r]![u[1]])) continue;
      const ng = g + Math.hypot(dr, dc);
      if (ng < (dist.get(key(r, c)) ?? Infinity)) { dist.set(key(r, c), ng); open.push([ng, [r, c]]); }
    }
  }
  return null;
}

/** Deterministic 32-bit generator, so the same seed gives the same map everywhere. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One random map from a generator: each cell blocked with the stated density, the start and goal (and their neighbours) kept free, retried until a route exists. */
export function materializeRandom(g: EnvGenerator, seed: number): string[] {
  const rng = mulberry32(seed);
  for (let attempt = 0; attempt < 200; attempt++) {
    const grid = Array.from({ length: g.rows }, () => Array.from({ length: g.cols }, () => rng() < g.density ? 1 : 0));
    for (const c of [g.start, g.goal]) for (let r = Math.max(0, c[0] - 1); r <= Math.min(g.rows - 1, c[0] + 1); r++) for (let k = Math.max(0, c[1] - 1); k <= Math.min(g.cols - 1, c[1] + 1); k++) grid[r]![k] = 0;
    if (shortestRoute(grid, g.start, g.goal) !== null) return asciiFromGrid(grid);
  }
  throw Error("No connected map could be generated with these parameters.");
}
export const instanceSeeds = (g: EnvGenerator) => Array.from({ length: g.instances }, (_, i) => g.seedBase + i);

/** Checks that an environment can actually be used: the route (or every leg of the targets) is open, and a generator makes connected maps. */
export function checkEnvironment(env: EnvironmentInput, now = new Date().toISOString()): EnvChecks {
  const notes: string[] = []; let solvable = true;
  if (env.grid) {
    const grid = gridFromAscii(env.grid.ascii), legs: [Cell, Cell][] = [];
    if (env.targets) for (let i = 0; i < env.targets.length - 1; i++) legs.push([env.targets[i]!, env.targets[i + 1]!]);
    else if (env.start && env.goal) legs.push([env.start, env.goal]);
    else notes.push("No start and goal or targets are given, so no route was checked.");
    legs.forEach(([a, b], i) => { const len = shortestRoute(grid, a, b); if (len === null) { solvable = false; notes.push(`Leg ${i + 1} (${a} to ${b}) has no route.`); } else notes.push(`Leg ${i + 1} shortest route: ${len.toFixed(1)} cells.`); });
    const blocked = env.grid.ascii.join("").split("#").length - 1; notes.push(`${blocked} of ${env.grid.rows * env.grid.cols} cells are blocked.`);
  } else if (env.generator) {
    let failures = 0;
    for (const seed of instanceSeeds(env.generator).slice(0, 10)) { try { materializeRandom(env.generator, seed); } catch { failures++; } }
    if (failures) { solvable = false; notes.push(`${failures} of the first 10 seeds gave no connected map.`); } else notes.push("The first 10 seeds all give connected maps.");
  }
  return { solvable, notes, checkedAt: now };
}

/** The maps a run's code should use: the fixed grid, or the generator's instances written out so any language gets identical maps. */
export function materializeEnvironment(env: Environment): { id: string; version: number; hash: string; name: string; origin: EnvOrigin; status: EnvStatus; kind: "fixed" | "instances"; rows: number; cols: number; start?: Cell; goal?: Cell; targets?: Cell[]; dynamicObstacles?: [number, number][]; scale?: { cellMeters?: number; note: string }; ascii?: string[]; instances?: { seed: number; ascii: string[] }[]; assumptions?: string[]; source: EnvSource } {
  const base = { id: env.id, version: env.version, hash: env.hash, name: env.name, origin: env.origin, status: env.status, source: env.source, ...(env.scale ? { scale: env.scale } : {}), ...(env.assumptions?.length ? { assumptions: env.assumptions } : {}), ...(env.dynamicObstacles ? { dynamicObstacles: env.dynamicObstacles } : {}) };
  if (env.grid) return { ...base, kind: "fixed", rows: env.grid.rows, cols: env.grid.cols, ascii: env.grid.ascii, ...(env.start ? { start: env.start } : {}), ...(env.goal ? { goal: env.goal } : {}), ...(env.targets ? { targets: env.targets } : {}) };
  const g = env.generator!;
  return { ...base, kind: "instances", rows: g.rows, cols: g.cols, start: g.start, goal: g.goal, instances: instanceSeeds(g).map(seed => ({ seed, ascii: materializeRandom(g, seed) })) };
}
