import { describe, expect, it } from "vitest";
import { exportJson, importJson, loadState, parseState, saveState, STORAGE_KEY, type StorageLike } from "./persistence";
import { SESSION_IMPORT, currentSession, newSession, saveMessageToNotes, sendMessage, setSessionMode, isReadOnly, savedTo, SAVE_TYPES } from "./store";
import { loadSampleData } from "./sample";
import { statusOf } from "./query";
import { emptyState } from "./types";

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("export and import", () => {
  it("round-trips the whole state", () => {
    let state = loadSampleData(emptyState());
    state = newSession(state).state;
    state = sendMessage(state, currentSession(state)!.id, "A note of my own");
    const text = exportJson(state, "2026-11-01T00:00:00.000Z");
    const back = importJson(text);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state).toEqual(state);
    if (back.ok) expect(exportJson(back.state, "2026-11-01T00:00:00.000Z")).toBe(text);
  });

  it("rejects bad files with a reason", () => {
    expect(importJson("not json")).toMatchObject({ ok: false });
    expect(importJson(JSON.stringify({ app: "other" }))).toMatchObject({ ok: false });
    const future = JSON.parse(exportJson(emptyState()));
    future.schemaVersion = 99;
    expect(importJson(JSON.stringify(future))).toMatchObject({ ok: false });
  });

  it("rejects an import that contains an item contradicting the label rule", () => {
    const file = JSON.parse(exportJson(loadSampleData(emptyState())));
    file.state.items.find((i: { id: string }) => i.id === "sample-u1").label = "new";
    const r = importJson(JSON.stringify(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/contradicts the label rule/);
  });

  it("rejects an item pointing to a missing batch", () => {
    const s = loadSampleData(emptyState());
    expect(parseState({ ...s, batches: [] }).ok).toBe(false);
  });
});

describe("local persistence", () => {
  it("saves and loads, and falls back to empty on broken or missing storage", () => {
    const storage = memory();
    const state = loadSampleData(emptyState());
    expect(saveState(state, storage)).toBe(true);
    expect(loadState(storage).state).toEqual(state);
    storage.data.set(STORAGE_KEY, "{broken");
    expect(loadState(storage)).toMatchObject({ state: emptyState(), warning: expect.any(String) });
    expect(loadState(null).warning).toMatch(/unavailable/);
    const throwing: StorageLike = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(loadState(throwing).state).toEqual(emptyState());
    expect(saveState(state, throwing)).toBe(false);
  });

  it("starts empty: samples never load on their own", () => {
    const { state } = loadState(memory());
    expect(state.items).toHaveLength(0);
    expect(state.sessions).toHaveLength(0);
  });
});

describe("sample data", () => {
  const s = loadSampleData(emptyState());
  it("marks every sample object, and has the documented size", () => {
    expect(s.items).toHaveLength(23);
    expect(s.batches).toHaveLength(4);
    expect([...s.items, ...s.batches, ...s.sessions].every((x) => x.sample === true)).toBe(true);
    expect(s.sessions.flatMap((x) => x.messages).every((m) => m.sample === true)).toBe(true);
  });
  it("loads only once", () => {
    expect(loadSampleData(s)).toBe(s);
  });
});

describe("sessions and save to notes", () => {
  const base = loadSampleData(emptyState());
  const read = "sample-session-3";

  it("treats ended sessions as read-only: no mode change, no messages", () => {
    const session = base.sessions.find((x) => x.id === read)!;
    expect(isReadOnly(session)).toBe(true);
    expect(sendMessage(base, read, "hello")).toBe(base);
    expect(setSessionMode(base, read, "take-notes")).toBe(base);
  });

  it("saves a message from a read-only session without changing the session", () => {
    const before = JSON.stringify(base.sessions);
    const { state, item } = saveMessageToNotes(base, { sessionId: read, messageId: "sample-msg-3-6", batchId: "sample-batch-paper-a", type: "finding" });
    expect(item.batchId).toBe("sample-batch-paper-a");
    expect(item.citationCheck).toBe("pass");
    expect(item.source).toMatchObject({ sessionId: read, messageId: "sample-msg-3-6", model: "sample-replay" });
    expect(state.items).toHaveLength(base.items.length + 1);
    expect(JSON.stringify(state.sessions)).toBe(before);
    expect(savedTo(state, read, "sample-msg-3-6")?.batch.name).toBe("Paper A");
  });

  it("keeps a message with no validation at not-run, so no verdict chip is shown", () => {
    const { item } = saveMessageToNotes(base, { sessionId: read, messageId: "sample-msg-3-5", batchId: "sample-batch-paper-a", type: "note" });
    expect(item.citationCheck).toBe("not-run");
  });

  it("does not save a message twice", () => {
    const first = saveMessageToNotes(base, { sessionId: read, messageId: "sample-msg-3-5", batchId: "sample-batch-paper-a", type: "note" });
    const again = saveMessageToNotes(first.state, { sessionId: read, messageId: "sample-msg-3-5", batchId: "sample-batch-paper-b", type: "note" });
    expect(again.state).toBe(first.state);
  });

  it("creates the session import batch on first save, and saved units get a computed label", () => {
    let s = newSession(emptyState()).state;
    const session = currentSession(s)!;
    s = sendMessage(s, session.id, "Draft unit: height filter");
    const m = currentSession(s)!.messages[0]!;
    const out = saveMessageToNotes(s, { sessionId: session.id, messageId: m.id, batchId: SESSION_IMPORT, type: "unit" });
    expect(out.state.batches).toHaveLength(1);
    expect(out.state.batches[0]).toMatchObject({ name: "Session 1 import", kind: "session", source: session.id });
    expect(out.item).toMatchObject({ type: "unit", label: "new", citationCheck: "not-run", review: "pending" });
    expect(statusOf(out.item)).toBe("spec-only");
    expect(SAVE_TYPES).not.toContain("snapshot");
  });

  it("starting a new session ends the open one and adds a new thread", () => {
    const one = newSession(emptyState());
    const two = newSession(one.state, "reproduce");
    expect(two.state.sessions).toHaveLength(2);
    expect(two.state.sessions[0]!.endedAt).toBeDefined();
    expect(two.session).toMatchObject({ title: "Session 2", mode: "reproduce", messages: [] });
    expect(two.state.sessions.filter((x) => x.endedAt === undefined)).toHaveLength(1);
  });

  it("sending adds only the researcher's message", () => {
    const s = newSession(emptyState());
    const out = sendMessage(s.state, s.session.id, "  hello  ");
    expect(out.sessions[0]!.messages).toEqual([expect.objectContaining({ role: "researcher", text: "hello" })]);
    expect(sendMessage(out, s.session.id, "   ")).toBe(out);
  });
});
