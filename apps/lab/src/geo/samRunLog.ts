import type { SamRunLog } from "./sam.ts";

export const SAM_LOG_LIMIT = 50;
export function isSamRunLog(value: unknown): value is SamRunLog {
  if (!value || typeof value !== "object") return false;
  const run = value as SamRunLog;
  return typeof run.id === "string" && typeof run.mapId === "string" && typeof run.prompt === "string" && typeof run.startedAt === "string" && Number.isFinite(Date.parse(run.startedAt)) && ["capturing", "running", "completed", "error", "cancelled"].includes(run.status) && !!run.provider && typeof run.provider.eventCount === "number" && !!run.decoding && typeof run.decoding.status === "string";
}
export function newSamRunLog(id: string, mapId: string, prompt: string): SamRunLog {
  return { id, mapId, prompt, startedAt: new Date().toISOString(), status: "capturing", provider: { eventCount: 0, eventTypes: {}, outputTextLength: 0, outputTextPreview: "", outputTextTruncated: false }, decoding: { status: "not_started", normalization: [], records: 0, boxes: 0, masks: 0, emptyMasks: 0, clippedAway: 0, displayedSegments: 0, diagnostics: [] } };
}
export function mergeSamRunLogs(previous: SamRunLog[], incoming: SamRunLog[]): SamRunLog[] {
  const records = new Map(previous.map((run) => [run.id, run]));
  for (const run of incoming) {
    const before = records.get(run.id);
    if (before?.finishedAt && !run.finishedAt) continue;
    records.set(run.id, before && JSON.stringify(before) === JSON.stringify(run) ? before : run);
  }
  const next = [...records.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, SAM_LOG_LIMIT);
  return next.length === previous.length && next.every((run, index) => run === previous[index]) ? previous : next;
}
