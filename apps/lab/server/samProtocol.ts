export interface SamEvent { type: string; [key: string]: unknown }
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const laneOf = (event: SamEvent) => `${event.item_id}:${event.output_index}:${event.content_index}`;

function aggregateText(events: SamEvent[]): { text: string; itemId: string; outputIndex: number; contentIndex: number }[] {
  const completed = events.find((event) => event.type === "response.completed");
  const response = object(completed?.response);
  const output = Array.isArray(response?.output) ? response.output : events.filter((event) => event.type === "response.output_item.done").map((event) => event.item);
  const lanes = output.flatMap((item, outputIndex) => {
    const value = object(item);
    return (Array.isArray(value?.content) ? value.content : []).flatMap((part, contentIndex) => {
      const content = object(part);
      return content?.type === "output_text" && typeof content.text === "string" ? [{ text: content.text, itemId: typeof value?.id === "string" ? value.id : `final-output-${outputIndex}`, outputIndex, contentIndex }] : [];
    });
  });
  if (!lanes.length && typeof response?.output_text === "string") lanes.push({ text: response.output_text, itemId: "final-output", outputIndex: 0, contentIndex: 0 });
  return lanes;
}

export function samOutputText(events: SamEvent[]): string {
  const finals = events.flatMap((event) => {
    const part = object(event.part);
    if (event.type === "response.content_part.done" && part?.type === "output_text" && typeof part.text === "string") return [part.text];
    return event.type === "response.output_text.done" && typeof event.text === "string" ? [event.text] : [];
  });
  if (finals.length) return finals.reduce((longest, text) => text.length > longest.length ? text : longest, "");
  const deltas = events.filter((event) => event.type === "response.output_text.delta").map((event) => typeof event.delta === "string" ? event.delta : "").join("");
  return deltas || aggregateText(events).map((lane) => lane.text).join("\n") || events.flatMap((event) => { const part = object(event.part); return part?.type === "output_text" && typeof part.text === "string" ? [part.text] : []; }).join("\n");
}

/** Adapt the provider's final content event to the installed parser's text-lane finalizer. */
export function normalizeSamEvents(events: SamEvent[], normalization: string[]): SamEvent[] {
  const completed = events.find((event) => event.type === "response.completed");
  if (!completed) throw Error("SAM stream ended without response.completed.");
  for (const event of events) {
    const response = object(event.response), part = object(event.part);
    if (response?.model && response.model !== "sam-3.1") throw Error("The provider returned a different model.");
    if (["response.failed", "response.incomplete", "error", "response.refusal.delta", "response.refusal.done"].includes(event.type) || part?.type === "refusal" || (response?.status && !["completed", "in_progress", "queued"].includes(String(response.status)))) throw Error("SAM returned a failed, refused or incomplete response.");
  }
  const normalized: SamEvent[] = [], finalized = new Map<string, { text: string; types: Set<string> }>();
  let textSeen = false;
  for (const event of events) {
    const part = object(event.part);
    const text = event.type === "response.output_text.done" ? event.text : event.type === "response.content_part.done" && part?.type === "output_text" ? part.text : undefined;
    if (typeof text === "string") {
      textSeen = true;
      const key = laneOf(event), previous = finalized.get(key);
      if (previous && (previous.text !== text || previous.types.has(event.type))) throw Error("SAM text finalizers are inconsistent or duplicated.");
      if (previous) { previous.types.add(event.type); continue; }
      finalized.set(key, { text, types: new Set([event.type]) });
      if (event.type === "response.content_part.done") normalization.push("content_part.done_to_output_text.done");
      normalized.push({ ...event, type: "response.output_text.done", text });
    } else {
      if (event.type === "response.output_text.delta") textSeen = true;
      normalized.push(event);
    }
  }
  if (!textSeen) {
    const lanes = aggregateText(events);
    if (lanes.length > 1) throw Error("SAM returned multiple segmentation text lanes.");
    const lane = lanes[0];
    const response = object(completed.response);
    if (!lane && (samOutputText(events).length || (Array.isArray(response?.output) && response.output.length) || events.some((event) => event.type === "response.content_part.done" || event.type === "response.output_item.done"))) throw Error("SAM returned unrecognized output; it cannot be reported as zero matches.");
    normalization.push(lane ? "aggregate_output_to_text_lane" : "completed_without_output_empty_lane");
    normalized.splice(normalized.findIndex((event) => event.type === "response.completed"), 0, { type: "response.output_text.done", item_id: lane?.itemId ?? "empty-segmentation", output_index: lane?.outputIndex ?? 0, content_index: lane?.contentIndex ?? 0, text: lane?.text ?? "" });
  }
  return normalized;
}
