import { describe, expect, it } from "vitest";
import { appendCrownTemplate, recoverCrownTemplates, validTemplateSample, type CrownTemplateEntry } from "./crownTemplates";
import type { CrownAgentRun } from "./crownAgent";
const sample = { x: 10, y: 10, width: 8, height: 8 }, settings = { threshold: 0.7, spacing: 1, multiScale: false };
const entry: CrownTemplateEntry = { id: "selection", selectedAt: "2026-11-02T00:00:00Z", source: "manual", status: "selected", sample, settings };
describe("template history", () => {
  it("retains the latest 50 entries without duplicate IDs", () => {
    const history = Array.from({ length: 50 }, (_, i) => ({ ...entry, id: `old-${i}` }));
    expect(appendCrownTemplate(history, entry)).toHaveLength(50);
    expect(appendCrownTemplate(history, entry)[0]!.id).toBe("selection");
    const replaced = appendCrownTemplate([entry], { ...entry, status: "completed", candidates: 15 });
    expect(replaced).toHaveLength(1); expect(replaced[0]!.candidates).toBe(15);
  });
  it("recovers real Muse templates and outcomes while omitting finish assessments", () => {
    const audit: CrownAgentRun = { id: "agent-1", model: "muse-spark-1.3", objective: "Crowns", startedAt: entry.selectedAt, status: "completed", steps: [{ round: 1, call: { id: "match", name: "match_crowns", arguments: { sample, settings, reason: "Visible radial crown." } }, provider: { requestId: null, responseId: null }, outcome: { status: "completed", count: 12, durationMs: 10, selfMatchOnly: false, scores: null, matches: [], truncated: false } }, { round: 2, call: { id: "finish", name: "finish_crown_detection", arguments: { reason: "Inspected", limitations: [] } }, provider: { requestId: null, responseId: null } }] };
    const recovered = recoverCrownTemplates("capture-a", null, audit, sample, settings);
    expect(recovered).toHaveLength(1); expect(recovered[0]).toMatchObject({ source: "muse", status: "completed", round: 1, runId: audit.id, captureKey: "capture-a", sample, settings, candidates: 12 });
  });
  it("does not store invalid drag boxes as reusable templates", () => {
    expect(validTemplateSample(sample, { width: 32, height: 32 })).toBe(true);
    expect(validTemplateSample({ ...sample, width: 2 }, { width: 32, height: 32 })).toBe(false);
    expect(validTemplateSample({ ...sample, x: 30 }, { width: 32, height: 32 })).toBe(false);
  });
});
