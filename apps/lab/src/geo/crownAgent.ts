import type { AgentModel } from "./mapAgent.ts";
import type { MatchingSettings, PixelRect } from "./templateMatch.ts";
import type { MuseImage } from "./muse.ts";
import { validateCoverageFeedback, type CrownCoverageFeedback } from "./crownCoverage.ts";
import { validateSectorReviews, type CrownSectorReview } from "./crownReview.ts";
import type { CrownSector } from "./crownCoverage.ts";
export const DEFAULT_CROWN_AGENT_GOAL = "Detect individual oil palm crown candidates across the entire polygon using resolved radial crown structure and consistent whole-crown size. Use diverse lighting templates within the reference size range. Keep detection circles non-overlapping. Search missed vegetated areas without filling roads, gaps or noise. Finish by assessing every image sector, including empty areas: palms accounted for, missed palms, no visible palms, or uncertain. Never claim complete coverage when any area is unreviewed or unclear.";
export interface MatchCrownsCall { id: string; name: "match_crowns"; arguments: { sample: PixelRect; settings: MatchingSettings; reason: string } }
export interface FinishCrownsCall { id: string; name: "finish_crown_detection"; arguments: { reason: string; limitations: string[]; sectorReviews?: CrownSectorReview[] } }
export type CrownAgentCall = MatchCrownsCall | FinishCrownsCall;
export interface CrownToolOutcome {
  status: "completed" | "error"; count: number; truncated: boolean; durationMs: number;
  selfMatchOnly: boolean; scores: { min: number; max: number; mean: number } | null;
  matches: (PixelRect & { score: number })[]; error?: string;
  coverage?: CrownCoverageFeedback;
}
export interface CrownAgentDecision { model: AgentModel; round: number; imageSha256: string; call: CrownAgentCall; provider: { requestId: string | null; responseId: string | null; usage?: unknown } }
export interface CrownAgentStep { round: number; call: CrownAgentCall; provider: CrownAgentDecision["provider"]; outcome?: CrownToolOutcome }
export interface CrownAgentRun { id: string; model: AgentModel; objective: string; startedAt: string; finishedAt?: string; imageSha256?: string; maxRounds?: number; initialCandidates?: number; areaReview?: { sectors: CrownSector[]; reviews: CrownSectorReview[] }; status: "running" | "completed" | "stopped" | "error" | "cancelled"; steps: CrownAgentStep[]; reason?: string }
export function validateCrownAgentCall(value: unknown, image: Pick<MuseImage, "width" | "height">): CrownAgentCall {
  const call = value as CrownAgentCall;
  const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 2000;
  if (!call || typeof call.id !== "string" || !/^[\w-]{1,200}$/.test(call.id) || !call.arguments || !text(call.arguments.reason)) throw Error("Muse returned an invalid crown tool call.");
  if (call.name === "finish_crown_detection") {
    if (!Array.isArray(call.arguments.limitations) || call.arguments.limitations.length > 8 || !call.arguments.limitations.every(text)) throw Error("Muse returned an invalid crown assessment.");
    return { id: call.id, name: call.name, arguments: { reason: call.arguments.reason, limitations: [...call.arguments.limitations], ...(call.arguments.sectorReviews ? { sectorReviews: validateSectorReviews(call.arguments.sectorReviews) } : {}) } };
  }
  if (call.name !== "match_crowns") throw Error("Muse requested an unsupported crown tool.");
  const { sample: s, settings: p } = call.arguments;
  if (!s || ![s.x, s.y, s.width, s.height].every(Number.isInteger) || s.x < 0 || s.y < 0 || Math.min(s.width, s.height) < 6 || Math.max(s.width, s.height) > 64 || s.x + s.width > image.width || s.y + s.height > image.height
    || !p || !Number.isFinite(p.threshold) || p.threshold < 0.4 || p.threshold > 0.99 || !Number.isFinite(p.spacing) || p.spacing < 0.25 || p.spacing > 2 || typeof p.multiScale !== "boolean") throw Error("Muse selected an invalid crown sample or matching settings.");
  return { id: call.id, name: call.name, arguments: { sample: { x: s.x, y: s.y, width: s.width, height: s.height }, settings: { threshold: p.threshold, spacing: p.spacing, multiScale: p.multiScale }, reason: call.arguments.reason } };
}
export function validateCrownOutcome(value: unknown, image: Pick<MuseImage, "width" | "height">): CrownToolOutcome {
  const o = value as CrownToolOutcome;
  if (!o || !["completed", "error"].includes(o.status) || !Number.isInteger(o.count) || o.count < 0 || o.count > 2000 || typeof o.truncated !== "boolean" || !Number.isFinite(o.durationMs) || o.durationMs < 0 || typeof o.selfMatchOnly !== "boolean" || !Array.isArray(o.matches) || o.matches.length > 30
    || (o.error !== undefined && (typeof o.error !== "string" || o.error.length > 2000))) throw Error("Invalid crown-tool feedback.");
  for (const m of o.matches) if (![m.x, m.y, m.width, m.height, m.score].every(Number.isFinite) || m.x < 0 || m.y < 0 || m.width <= 0 || m.height <= 0 || m.x + m.width > image.width || m.y + m.height > image.height || m.score < -1 || m.score > 1) throw Error("Invalid crown candidate feedback.");
  if (o.scores !== null && (!o.scores || ![o.scores.min, o.scores.max, o.scores.mean].every((n) => Number.isFinite(n) && n >= -1 && n <= 1))) throw Error("Invalid crown similarity feedback.");
  return { status: o.status, count: o.count, truncated: o.truncated, durationMs: o.durationMs, selfMatchOnly: o.selfMatchOnly, scores: o.scores,
    matches: o.matches.map(({ x, y, width, height, score }) => ({ x, y, width, height, score })), ...(o.error ? { error: o.error } : {}), ...(o.coverage ? { coverage: validateCoverageFeedback(o.coverage, image.width, image.height) } : {}) };
}
