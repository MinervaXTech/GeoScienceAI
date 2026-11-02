import type { CrownImage, MatchingSettings, PixelRect } from "./templateMatch";
import type { CrownAgentRun } from "./crownAgent";
import type { CrownMatchResult } from "./templateMatch";

export const CROWN_TEMPLATE_HISTORY_LIMIT = 50;
export interface CrownTemplateEntry {
  id: string;
  selectedAt: string;
  source: "manual" | "muse";
  status: "selected" | "running" | "completed" | "error" | "cancelled";
  sample: PixelRect;
  settings: MatchingSettings;
  settingsRecovered?: boolean;
  captureKey?: string;
  thumbnail?: string;
  round?: number;
  runId?: string;
  reason?: string;
  candidates?: number;
  addedCandidates?: number;
}
const keys = new WeakMap<CrownImage, Promise<string>>();
/** Bind coordinates to the exact pixels, polygon and georeferencing, not just dimensions. */
export function crownTemplateCaptureKey(image: CrownImage): Promise<string> {
  let key = keys.get(image);
  if (!key) {
    key = crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([image.source, image.width, image.height, image.corners, image.area, image.imageDataUrl])))
      .then((bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join(""));
    keys.set(image, key);
  }
  return key;
}
export function validTemplateSample(sample: PixelRect, image: Pick<CrownImage, "width" | "height">): boolean {
  return [sample.x, sample.y, sample.width, sample.height].every(Number.isInteger) && sample.x >= 0 && sample.y >= 0 && Math.min(sample.width, sample.height) >= 6 && Math.max(sample.width, sample.height) <= 64 && sample.x + sample.width <= image.width && sample.y + sample.height <= image.height;
}
export function appendCrownTemplate(history: CrownTemplateEntry[], entry: CrownTemplateEntry): CrownTemplateEntry[] {
  return [entry, ...history.filter((item) => item.id !== entry.id)].slice(0, CROWN_TEMPLATE_HISTORY_LIMIT);
}
/** Recover the template evidence older saved runs actually retained. */
export function recoverCrownTemplates(captureKey: string, result: CrownMatchResult | null, audit: CrownAgentRun | null, sample: PixelRect | null, settings: MatchingSettings): CrownTemplateEntry[] {
  const entries: CrownTemplateEntry[] = [];
  for (const step of audit?.steps ?? []) {
    if (step.call.name !== "match_crowns") continue;
    entries.push({ id: `recovered-${audit!.id}-${step.round}`, captureKey, selectedAt: audit!.startedAt, source: "muse", status: step.outcome?.status ?? (audit!.status === "cancelled" ? "cancelled" : "selected"), sample: step.call.arguments.sample, settings: step.call.arguments.settings, round: step.round, runId: audit!.id, reason: step.call.arguments.reason, candidates: step.outcome?.count, addedCandidates: step.outcome?.coverage?.addedCandidates });
  }
  for (const [i, value] of (result?.coverage?.samples ?? (result ? [result.sample] : [])).entries()) {
    if (entries.some((e) => JSON.stringify(e.sample) === JSON.stringify(value))) continue;
    entries.push({ id: `recovered-${captureKey}-${i}`, captureKey, selectedAt: result!.receivedAt, source: result!.method === "multi-template-ncc-v1" ? "muse" : "manual", status: "selected", sample: value, settings: result!.settings, settingsRecovered: true, reason: "Recovered from saved template locations. Individual pass results and settings were not retained; settings shown come from the latest saved pass." });
  }
  if (sample && !entries.some((e) => JSON.stringify(e.sample) === JSON.stringify(sample))) entries.push({ id: `recovered-${captureKey}-selection`, captureKey, selectedAt: result?.receivedAt ?? new Date().toISOString(), source: "manual", status: "selected", sample, settings });
  return entries.reverse();
}
