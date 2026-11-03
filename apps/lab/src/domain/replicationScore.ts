export type StepStatus = "implemented" | "partial" | "missing";
export interface StepCoverage { n: number; status: StepStatus; note: string }
export interface ScoreRow { status: string }
export interface ReplicationScore {
  total: number;
  counts: { match: number; within_tolerance: number; mismatch: number; not_comparable: number; not_run: number };
  /** Share of ALL reported results that are a match or within tolerance. Results that could not be compared or run count as not replicated. */
  withinPercent: number | null;
  /** Share of the results that could be compared (match, within tolerance or mismatch) that are a match or within tolerance. */
  comparablePercent: number | null;
  comparable: number;
  steps: { total: number; implemented: number; partial: number; missing: number; unassessed: number; percent: number | null };
}
const pct = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 100) : null;
const KNOWN = ["implemented", "partial", "missing"];

/** Keeps Muse's per-step coverage verdicts for steps that exist, once each. Unknown steps and statuses are dropped. */
export function parseStepCoverage(value: unknown, stepCount: number): StepCoverage[] {
  const seen = new Set<number>(), out: StepCoverage[] = [];
  for (const item of Array.isArray(value) ? value.slice(0, 80) : []) {
    if (!item || typeof item !== "object") continue;
    const { n, status, note } = item as { n?: unknown; status?: unknown; note?: unknown };
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > stepCount || seen.has(n as number) || typeof status !== "string" || !KNOWN.includes(status)) continue;
    seen.add(n as number); out.push({ n: n as number, status: status as StepStatus, note: typeof note === "string" ? note.replace(/\s+/g, " ").trim().slice(0, 300) : "" });
  }
  return out.sort((a, b) => a.n - b.n);
}

/** Two honest numbers instead of one: how many reported results landed near the paper's, and how much of the method was implemented. */
export function replicationScore(rows: ScoreRow[], stepCount: number, coverage?: StepCoverage[]): ReplicationScore {
  const counts = { match: 0, within_tolerance: 0, mismatch: 0, not_comparable: 0, not_run: 0 };
  for (const r of rows) if (r.status in counts) counts[r.status as keyof typeof counts]++;
  const near = counts.match + counts.within_tolerance, comparable = near + counts.mismatch;
  const covered = coverage ?? [], implemented = covered.filter(c => c.status === "implemented").length, partial = covered.filter(c => c.status === "partial").length, missing = covered.filter(c => c.status === "missing").length;
  return { total: rows.length, counts, withinPercent: pct(near, rows.length), comparablePercent: pct(near, comparable), comparable,
    steps: { total: stepCount, implemented, partial, missing, unassessed: Math.max(0, stepCount - covered.length), percent: covered.length && stepCount ? pct(implemented + partial / 2, stepCount) : null } };
}

/** The summary in plain sentences, used by the report and the app. Facts only, no grade. */
export function scoreSentences(score: ReplicationScore): string[] {
  const out: string[] = [], c = score.counts, near = c.match + c.within_tolerance;
  if (score.total) {
    out.push(`${near} of ${score.total} reported results (${score.withinPercent}%) are within 10% of the paper's numbers${c.match ? `, ${c.match} of them within 2%` : ""}.`);
    out.push(score.comparable ? `Of the ${score.comparable} that could be compared, ${near} (${score.comparablePercent}%) are near the paper's value and ${c.mismatch} are not.` : "None of the results could be compared with the paper's numbers.");
    const other = [c.not_comparable && `${c.not_comparable} were measured on different data or settings and are not comparable`, c.not_run && `${c.not_run} could not be run`].filter(Boolean);
    if (other.length) out.push(`${other.join(" and ")}.`);
  } else out.push("No results have been compared yet.");
  const s = score.steps;
  if (s.total) out.push(s.percent === null ? `Method coverage has not been assessed (${s.total} steps in the spec).` : `${s.implemented} of ${s.total} method steps are implemented${s.partial ? `, ${s.partial} partly` : ""}${s.missing ? `, ${s.missing} missing` : ""}${s.unassessed ? `, ${s.unassessed} not assessed` : ""} (about ${s.percent}% of the method), as judged by Muse's review.`);
  return out;
}

export type Rating = "unrated" | "not_replicated" | "early" | "partial" | "close" | "replicated";
export type ActionKind = "assess" | "data" | "code" | "honesty" | "measure" | "rerun" | "verify";
export interface NextAction { priority: "high" | "medium" | "low"; kind: ActionKind; text: string }
export interface Assessment { rating: Rating; label: string; reasons: string[]; actions: NextAction[] }
export interface GapInfo { id: string; kind: string; impact: string; description: string }
export interface ResultInfo { id: string; status: string; relError?: number }
export const RATING_TEXT: Record<Rating, string> = { unrated: "Not rated yet", not_replicated: "Not replicated", early: "Early attempt", partial: "Partial replication", close: "Close to the paper", replicated: "Replicated" };
export const RATING_RULES = ["Replicated: at least 90% of the method implemented, at least 80% of results compared and 80% of those near the paper, and no high-impact missing data.", "Close: at least 75% of the method and 60% of compared results near the paper.", "Partial: at least 50% of the method and 40% of compared results near the paper.", "Early attempt: at least 25% of the method or of compared results near the paper.", "Not replicated: below that. Not rated: method coverage has not been assessed."];
const DATA_GAPS = ["figure_only", "unspecified_data"];
const short = (text: string, max: number) => { const t = text.replace(/\s+/g, " ").trim(); return t.length <= max ? t : `${t.slice(0, max - 1).replace(/[\s,;:.]+\S*$/, "")}…`; };

/** A plain verdict with the reasons behind it, and what to do next, ordered by priority. Deterministic: the same inputs always give the same answer. */
export function assessReplication(input: { results: ResultInfo[]; stepCount: number; coverage?: StepCoverage[]; gaps: GapInfo[]; concerns: string[] }): Assessment {
  const score = replicationScore(input.results, input.stepCount, input.coverage), method = score.steps.percent, near = score.comparablePercent, total = score.total;
  const comparedShare = total ? Math.round((score.comparable / total) * 100) : 0;
  const dataGaps = input.gaps.filter(g => DATA_GAPS.includes(g.kind) && g.impact === "high");
  let rating: Rating;
  if (method === null) rating = "unrated";
  else if (method >= 90 && comparedShare >= 80 && (near ?? 0) >= 80 && !dataGaps.length) rating = "replicated";
  else if (method >= 75 && (near ?? 0) >= 60) rating = "close";
  else if (method >= 50 && (near ?? 0) >= 40) rating = "partial";
  else if (method >= 25 || (near ?? 0) >= 25) rating = "early";
  else rating = "not_replicated";
  if (rating === "replicated" && dataGaps.length) rating = "close";
  const reasons: string[] = [];
  if (method === null) reasons.push("Method coverage has not been assessed, so the method cannot be rated yet.");
  else reasons.push(`${method}% of the method is implemented (${score.steps.implemented} of ${score.steps.total} steps fully${score.steps.partial ? `, ${score.steps.partial} partly` : ""}).`);
  reasons.push(score.comparable ? `${near}% of the ${score.comparable} comparable results are within 10% of the paper (${score.counts.match + score.counts.within_tolerance} of ${score.comparable}).` : total ? "No result could be compared with the paper's number." : "No results have been compared yet.");
  if (total && comparedShare < 100) reasons.push(`Only ${comparedShare}% of the reported results could be compared at all (${score.counts.not_comparable} measured on different data, ${score.counts.not_run} not run).`);
  if (dataGaps.length) reasons.push(`The paper does not give data that high-impact gaps depend on (${dataGaps.map(g => g.id).join(", ")}), so even matching numbers cannot fully confirm replication.`);
  const high = input.concerns.filter(c => c.startsWith("[high]"));
  if (high.length) reasons.push(`The review raised ${high.length} high-severity concern${high.length === 1 ? "" : "s"}.`);

  const actions: NextAction[] = [];
  if (method === null && total) actions.push({ priority: "high", kind: "assess", text: "Assess method coverage with Muse, so the rating can use how much of the method is really implemented." });
  for (const g of dataGaps.slice(0, 2)) actions.push({ priority: "high", kind: "data", text: `Supply the missing data (${g.id}): ${short(g.description, 170)} Until then, results on substituted data show only that the code runs.` });
  const weak = (input.coverage ?? []).filter(c => c.status !== "implemented");
  if (weak.length) actions.push({ priority: "high", kind: "code", text: `Fix ${weak.length} step${weak.length === 1 ? "" : "s"} that ${weak.length === 1 ? "is" : "are"} only partly implemented or missing (steps ${weak.slice(0, 6).map(c => c.n).join(", ")}${weak.length > 6 ? ", …" : ""}). First: step ${weak[0]!.n}, ${short(weak[0]!.note || weak[0]!.status, 140)}` });
  for (const c of high.slice(0, 3)) actions.push({ priority: "high", kind: "honesty", text: `Resolve this review concern: ${short(c.replace(/^\[high\]\s*/, ""), 200)}` });
  const bad = input.results.filter(r => r.status === "mismatch").sort((a, b) => (b.relError ?? 0) - (a.relError ?? 0));
  if (bad.length) actions.push({ priority: "medium", kind: "measure", text: `Investigate ${bad.length} mismatch${bad.length === 1 ? "" : "es"}, largest first: ${bad.slice(0, 4).map(r => `${r.id} (${Math.round((r.relError ?? 0) * 100)}% off)`).join(", ")}. Check the step or equation behind each before changing any parameter.` });
  const missing = input.results.filter(r => r.status === "not_run");
  if (missing.length) actions.push({ priority: "medium", kind: "measure", text: `${missing.map(r => r.id).join(", ")} produced no result. Have the code measure ${missing.length === 1 ? "it" : "them"}, or accept ${missing.length === 1 ? "it" : "them"} as not measurable from the paper.` });
  if (total && dataGaps.length && !score.counts.not_comparable) actions.push({ priority: "medium", kind: "rerun", text: "No result is marked as measured on different data, although the spec lists missing data. Re-run with the current rules so substituted-data results are reported as not comparable." });
  if (input.gaps.some(g => /garbled/i.test(g.description))) actions.push({ priority: "medium", kind: "verify", text: "Some equations are garbled in the paper's text. Check each against the PDF, or read the page image with the page transcription tool, before trusting the code." });
  const seeds = input.gaps.find(g => g.kind === "randomness");
  if (seeds) actions.push({ priority: "low", kind: "measure", text: `Report the mean and spread over many seeds (${seeds.id}), not one run, for every stochastic result.` });
  const order = { high: 0, medium: 1, low: 2 };
  return { rating, label: RATING_TEXT[rating], reasons, actions: actions.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 9) };
}
export const ratingTone = (rating: Rating): "ok" | "busy" | "bad" | "idle" => rating === "replicated" || rating === "close" ? "ok" : rating === "partial" ? "busy" : rating === "unrated" ? "idle" : "bad";
