import { describe, expect, it } from "vitest";
import { clampChatWidth, loadChatWidth, saveChatWidth } from "./chatSize";
describe("chat width", () => {
  it("keeps the chat between a readable minimum and what leaves room for the map", () => {
    expect(clampChatWidth(100, 1400)).toBe(340);
    expect(clampChatWidth(600, 1400)).toBe(600);
    expect(clampChatWidth(5000, 1400)).toBe(1080);
    expect(clampChatWidth(5000, 500)).toBe(340);
    expect(clampChatWidth(Number.NaN, 1400)).toBe(500);
    expect(clampChatWidth(Number.NaN, 600)).toBe(340);
  });
  it("remembers the width and survives unavailable or invalid storage", () => {
    const store = new Map<string, string>(), storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    expect(loadChatWidth(storage)).toBe(500);
    saveChatWidth(612.4, storage); expect(loadChatWidth(storage)).toBe(612);
    store.set("lab.chat.width", "junk"); expect(loadChatWidth(storage)).toBe(500);
    expect(loadChatWidth({ getItem: () => { throw new Error("blocked"); } })).toBe(500);
    expect(() => saveChatWidth(600, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});
