import { sessionAttachments } from "./attachments";
import { computeLabel, isLabelled } from "./labelRule";
import { assertItem } from "./validate";
import { buildSnapshotData, DEFAULT_SNAPSHOT_PARAMETERS } from "./snapshots";
import { NO_IMPLEMENTATION } from "./registry";
import type { Attachment, Batch, Item, ItemType, LabState, Message, Mode, Session } from "./types";

/** All state changes are pure functions of (state, input), so they can be tested without React. */
export interface Clock {
  now(): string;
  id(prefix: string): string;
}

let counter = 0;
export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  id: (prefix) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
};

export type ItemDraft = Partial<Omit<Item, "label" | "id" | "createdAt" | "updatedAt">> &
  Pick<Item, "batchId" | "type" | "title">;

/** Builds an item with its label computed from the rule. A `label` in the input is ignored by type, and rejected at runtime. */
export function makeItem(draft: ItemDraft, clock: Clock = systemClock, id?: string): Item {
  if ("label" in draft && (draft as { label?: unknown }).label !== undefined)
    throw new Error("A label is computed by the label rule and cannot be set.");
  const now = clock.now();
  const base: Item = {
    body: "",
    citedSpans: [],
    citationCheck: "not-run",
    review: "pending",
    ...draft,
    id: id ?? clock.id("item"),
    createdAt: now,
    updatedAt: now,
  };
  if (isLabelled(base.type)) {
    base.implementation = base.implementation ?? NO_IMPLEMENTATION;
    base.label = computeLabel(base);
  }
  return assertItem(base);
}

export function addItem(state: LabState, item: Item): LabState {
  assertItem(item);
  if (!state.batches.some((b) => b.id === item.batchId)) throw new Error(`Unknown batch ${item.batchId}.`);
  return { ...state, items: [...state.items, item] };
}

export function addBatch(state: LabState, input: Pick<Batch, "name" | "kind" | "source">, clock: Clock = systemClock): { state: LabState; batch: Batch } {
  const name = input.name.trim();
  if (!name) throw new Error("A batch needs a name.");
  const batch: Batch = { id: clock.id("batch"), name, kind: input.kind, source: input.source.trim(), createdAt: clock.now() };
  return { state: { ...state, batches: [...state.batches, batch] }, batch };
}

export const currentSession = (state: LabState): Session | undefined => state.sessions.find((s) => s.endedAt === undefined);
export const isReadOnly = (s: Session): boolean => s.endedAt !== undefined;

const sessionNumber = (state: LabState) => Math.max(0, ...state.sessions.map(s => Number(/^Session (\d+)$/.exec(s.title)?.[1]) || 0)) + 1;

/** Ends the open session, if any, and starts a new thread. */
export function newSession(state: LabState, mode: Mode = "take-notes", clock: Clock = systemClock): { state: LabState; session: Session } {
  const now = clock.now();
  const ended = state.sessions.map((s) => (s.endedAt === undefined ? { ...s, endedAt: now } : s));
  const n = sessionNumber(state);
  const session: Session = { id: clock.id("session"), title: `Session ${n}`, createdAt: now, mode, messages: [] };
  return { state: { ...state, sessions: [...ended, session] }, session };
}

const withoutEnd = (s: Session): Session => { const open = { ...s }; delete open.endedAt; return open; };

/** Reopens an ended session so chat can continue in it. The previously open session ends, so only one stays open. Sample sessions stay read-only. */
export function resumeSession(state: LabState, sessionId: string, clock: Clock = systemClock): LabState {
  const target = state.sessions.find(s => s.id === sessionId);
  if (!target || !isReadOnly(target) || target.sample) return state;
  const now = clock.now();
  return { ...state, sessions: state.sessions.map(s => s.id === sessionId ? withoutEnd(s) : s.endedAt === undefined ? { ...s, endedAt: now } : s) };
}

export function setSessionMode(state: LabState, sessionId: string, mode: Mode): LabState {
  const s = state.sessions.find((x) => x.id === sessionId);
  if (!s || isReadOnly(s)) return state;
  return { ...state, sessions: state.sessions.map((x) => (x.id === sessionId ? { ...x, mode } : x)) };
}

/** Titles can be edited even after a session has ended. */
export function renameSession(state: LabState, sessionId: string, title: string): LabState {
  const name = title.trim();
  const session = state.sessions.find(s => s.id === sessionId);
  if (!session || !name || name === session.title) return state;
  return {
    ...state,
    sessions: state.sessions.map(s => s.id === sessionId ? { ...s, title: name } : s),
    batches: state.batches.map(b => b.kind === "session" && b.source === sessionId && b.name === sessionImportName(session) ? { ...b, name: `${name} import` } : b),
  };
}

/** Saved notes and their source identifiers survive deletion of the chat. */
export function deleteSession(state: LabState, sessionId: string): LabState {
  if (!state.sessions.some(s => s.id === sessionId)) return state;
  return { ...state, sessions: state.sessions.filter(s => s.id !== sessionId) };
}

/** Sending adds the researcher's message only. No model call is made in this phase. */
export function sendMessage(state: LabState, sessionId: string, text: string, clock: Clock = systemClock, attachments: Attachment[] = []): LabState {
  const body = text.trim();
  const s = state.sessions.find((x) => x.id === sessionId);
  if (!body || !s || isReadOnly(s)) return state;
  const message: Message = { id: clock.id("msg"), role: "researcher", text: body, createdAt: clock.now(), ...(attachments.length ? { attachments: sessionAttachments(attachments) } : {}) };
  return { ...state, sessions: state.sessions.map((x) => (x.id === sessionId ? { ...x, messages: [...x.messages, message] } : x)) };
}

/** Edits a researcher's text without rerunning tools or changing saved notes. */
export function editMessage(state: LabState, sessionId: string, messageId: string, text: string, clock: Clock = systemClock): LabState {
  const body = text.trim();
  const session = state.sessions.find(s => s.id === sessionId);
  const message = session?.messages.find(m => m.id === messageId);
  if (!body || !session || isReadOnly(session) || message?.role !== "researcher" || message.text === body) return state;
  return { ...state, sessions: state.sessions.map(s => s.id === sessionId ? { ...s, messages: s.messages.map(m => { if (m.id !== messageId) return m; const next = { ...m, text: body, editedAt: clock.now() }; delete next.knowledge; return next; }) } : s) };
}

export const sessionImportName = (s: Session) => `${s.title} import`;

/** Finds the batch a session's messages go to by default, without creating it. */
export const sessionBatch = (state: LabState, sessionId: string): Batch | undefined =>
  state.batches.find((b) => b.kind === "session" && b.source === sessionId);

export const SAVE_TYPES: readonly ItemType[] = ["note", "finding", "unit"];

/** The item (if any) a message was saved as, for the "Saved to <batch>" mark. */
export function savedTo(state: LabState, sessionId: string, messageId: string): { item: Item; batch: Batch } | undefined {
  for (const item of state.items) {
    if (item.source?.sessionId === sessionId && item.source.messageId === messageId) {
      const batch = state.batches.find((b) => b.id === item.batchId);
      if (batch) return { item, batch };
    }
  }
  return undefined;
}

export interface SaveInput {
  sessionId: string;
  messageId: string;
  /** Existing batch id, or "session-import" for this session's import batch (created when first used). */
  batchId: string;
  type: ItemType;
}

export const SESSION_IMPORT = "session-import";

/**
 * Saves a message to notes. Works for read-only sessions too: saving never
 * edits the session. The validator verdict on the message, if any, becomes the
 * item's citation check; an unvalidated message stays "not-run".
 */
export function saveMessageToNotes(state: LabState, input: SaveInput, clock: Clock = systemClock): { state: LabState; item: Item } {
  const session = state.sessions.find((s) => s.id === input.sessionId);
  const message = session?.messages.find((m) => m.id === input.messageId);
  if (!session || !message) throw new Error("Unknown message.");
  if (!SAVE_TYPES.includes(input.type)) throw new Error(`A message cannot be saved as a ${input.type}.`);
  const existing = savedTo(state, session.id, message.id);
  if (existing) return { state, item: existing.item };

  let next = state;
  let batchId = input.batchId;
  if (batchId === SESSION_IMPORT) {
    const found = sessionBatch(state, session.id);
    if (found) batchId = found.id;
    else {
      const added = addBatch(state, { name: sessionImportName(session), kind: "session", source: session.id }, clock);
      next = added.state;
      batchId = added.batch.id;
    }
  }
  const firstLine = message.text.split("\n")[0]!.trim();
  const title = firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
  const item = makeItem(
    {
      batchId,
      type: input.type,
      title,
      body: message.text,
      citationCheck: message.validation?.citationCheck ?? "not-run",
      source: { sessionId: session.id, messageId: message.id, model: message.model ?? (message.role === "model" ? "unknown" : "researcher"), requestId: message.requestId ?? "none" },
      ...(input.type === "unit" ? { unit: { purpose: message.text, inputs: "", outputs: "", parameters: "" } } : {}),
    },
    clock,
  );
  return { state: addItem(next, item), item };
}

/** Saves text generated from a stored paper (such as a reproduction spec) as a note in that paper's own batch, created on first use. */
export function addKnowledgeNote(state: LabState, input: { entryId: string; paperTitle: string; label: string; title: string; body: string }, clock: Clock = systemClock): { state: LabState; item: Item } {
  const body = input.body.trim(), title = input.title.trim();
  if (!body || !title) throw new Error("A note needs a title and text.");
  const source = `knowledge:${input.entryId}`;
  let next = state, batch = state.batches.find(b => b.kind === "paper" && b.source === source);
  if (!batch) { const added = addBatch(state, { name: `${input.label}: ${input.paperTitle}`.slice(0, 120), kind: "paper", source }, clock); next = added.state; batch = added.batch; }
  const item = makeItem({ batchId: batch.id, type: "note", title, body }, clock);
  return { state: addItem(next, item), item };
}

export function setReview(state: LabState, itemId: string, review: Item["review"], clock: Clock = systemClock): LabState {
  return { ...state, items: state.items.map((i) => (i.id === itemId ? { ...i, review, updatedAt: clock.now() } : i)) };
}

/** Registers a snapshot from the unit items of a batch. Refuses a duplicate hash and an empty unit list. */
export function registerSnapshot(
  state: LabState,
  batchId: string,
  title: string,
  clock: Clock = systemClock,
): { state: LabState; item: Item } {
  const units = state.items.filter((i) => i.batchId === batchId && i.type === "unit");
  if (!units.length) throw new Error("This batch has no units to snapshot.");
  const paperItemId = state.items.find((i) => i.batchId === batchId && i.type === "paper")?.id;
  const data = buildSnapshotData(units, DEFAULT_SNAPSHOT_PARAMETERS(), paperItemId ? { paperItemId } : {});
  const dup = state.items.find((i) => i.batchId === batchId && i.type === "snapshot" && i.snapshot?.hash === data.hash);
  if (dup) throw new Error(`The current units already match snapshot ${dup.title} (${data.hash}).`);
  const taken = state.items.filter((i) => i.batchId === batchId && i.type === "snapshot").length;
  const slot = taken === 0 ? "A" : taken === 1 ? "B" : undefined;
  const item = makeItem(
    { batchId, type: "snapshot", title: title.trim() || `Snapshot ${data.hash}`, body: "", snapshot: { ...data, ...(slot ? { slot } : {}) } },
    clock,
  );
  return { state: addItem(state, item), item };
}
