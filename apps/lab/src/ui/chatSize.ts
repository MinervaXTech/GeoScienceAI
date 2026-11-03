export const CHAT_DEFAULT_WIDTH = 500;
export const CHAT_MIN_WIDTH = 340;
export const CHAT_KEY_STEP = 32;
const WORK_MIN = 320;
/** Chat width kept between a readable minimum and what leaves room for the map and tools. */
export function clampChatWidth(width: number, available: number): number {
  const max = Math.max(CHAT_MIN_WIDTH, available - WORK_MIN);
  if (!Number.isFinite(width)) return Math.min(CHAT_DEFAULT_WIDTH, max);
  return Math.round(Math.min(max, Math.max(CHAT_MIN_WIDTH, width)));
}
export function loadChatWidth(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): number {
  try { const saved = Number(storage?.getItem("lab.chat.width")); return Number.isFinite(saved) && saved > 0 ? saved : CHAT_DEFAULT_WIDTH; } catch { return CHAT_DEFAULT_WIDTH; }
}
export function saveChatWidth(width: number, storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage) {
  try { storage?.setItem("lab.chat.width", String(Math.round(width))); } catch { /* the width still applies to this visit */ }
}
