import { describe, expect, it } from "vitest";
import { clampDetail, defaultDetailHeight, loadDetailLayout, maxDetailHeight, saveDetailLayout } from "./detailDock";
describe("notes detail dock", () => {
  it("starts at half the window and keeps the height between a readable minimum and most of the window", () => {
    expect(defaultDetailHeight(800)).toBe(400); expect(defaultDetailHeight(200)).toBe(260);
    expect(clampDetail({ dock: "bottom", height: 50 }, 800)).toEqual({ dock: "bottom", height: 160 });
    expect(clampDetail({ dock: "bottom", height: 9000 }, 800)).toEqual({ dock: "bottom", height: maxDetailHeight(800) });
    expect(clampDetail({ dock: "right", height: Number.NaN }, 800)).toEqual({ dock: "right", height: 400 });
    expect(clampDetail({ dock: "sideways" as never, height: 300 }, 800).dock).toBe("bottom");
  });
  it("remembers dock and height, and survives missing, invalid or blocked storage", () => {
    const store = new Map<string, string>(), storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    expect(loadDetailLayout(800, storage)).toEqual({ dock: "bottom", height: 400 });
    saveDetailLayout({ dock: "right", height: 333 }, storage); expect(loadDetailLayout(800, storage)).toEqual({ dock: "right", height: 333 });
    store.set("lab.notes.detail", "junk"); expect(loadDetailLayout(800, storage)).toEqual({ dock: "bottom", height: 400 });
    expect(loadDetailLayout(800, { getItem: () => { throw new Error("blocked"); } })).toEqual({ dock: "bottom", height: 400 });
    expect(() => saveDetailLayout({ dock: "bottom", height: 300 }, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});
