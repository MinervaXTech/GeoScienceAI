export type DetailDock = "bottom" | "right";
export interface DetailLayout { dock: DetailDock; height: number }
export const DETAIL_MIN_HEIGHT = 160;
export const DETAIL_KEY_STEP = 32;
const KEY = "lab.notes.detail";
/** The bottom pane starts at half the window, and can be dragged between a readable minimum and most of the window. */
export const defaultDetailHeight = (viewportHeight: number) => Math.max(DETAIL_MIN_HEIGHT + 100, Math.round(viewportHeight * 0.5));
export const maxDetailHeight = (viewportHeight: number) => Math.max(DETAIL_MIN_HEIGHT + 80, Math.round(viewportHeight * 0.65));
export function clampDetail(layout: DetailLayout, viewportHeight: number): DetailLayout {
  const height = Number.isFinite(layout.height) ? Math.round(Math.min(maxDetailHeight(viewportHeight), Math.max(DETAIL_MIN_HEIGHT, layout.height))) : defaultDetailHeight(viewportHeight);
  return { dock: layout.dock === "right" ? "right" : "bottom", height };
}
export function loadDetailLayout(viewportHeight: number, storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): DetailLayout {
  const fallback: DetailLayout = { dock: "bottom", height: defaultDetailHeight(viewportHeight) };
  try { const saved = JSON.parse(storage?.getItem(KEY) ?? "null"); return saved && typeof saved === "object" ? clampDetail({ dock: saved.dock === "right" ? "right" : "bottom", height: Number.isFinite(saved.height) ? saved.height : fallback.height }, viewportHeight) : fallback; } catch { return fallback; }
}
export function saveDetailLayout(layout: DetailLayout, storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(layout)); } catch { /* the layout still applies to this visit */ }
}
