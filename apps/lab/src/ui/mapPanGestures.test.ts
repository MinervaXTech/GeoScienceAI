import { afterEach, describe, expect, it, vi } from "vitest";
import { bindMapPanGestures } from "./mapPanGestures";

let cleanup = () => {};
afterEach(() => { cleanup(); document.body.replaceChildren(); });
function setup() {
  const canvas = document.createElement("canvas"); canvas.tabIndex = 0; document.body.append(canvas);
  const map = { getCanvas: () => canvas, panBy: vi.fn(), stop: vi.fn() };
  const onStart = vi.fn();
  const controls = bindMapPanGestures(map, () => true, onStart);
  cleanup = controls.destroy;
  const mouse = (type: string, x: number, y: number, button = 0) => {
    const event = new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event); return event;
  };
  const key = (type: string) => {
    const event = new KeyboardEvent(type, { code: "Space", key: " ", bubbles: true, cancelable: true });
    (document.activeElement ?? canvas).dispatchEvent(event); return event;
  };
  return { canvas, map, controls, onStart, mouse, key };
}

describe("map navigation gestures", () => {
  it("pans with middle-button movement and restores drawing on release", () => {
    const { canvas, map, controls, mouse } = setup();
    mouse("mousedown", 10, 20, 1); mouse("mousemove", 40, 30, 1);
    expect(map.panBy).toHaveBeenCalledWith([-30, -10], { duration: 0 });
    expect(canvas.style.cursor).toBe("grabbing");
    mouse("mouseup", 40, 30, 1); mouse("mousemove", 50, 50);
    expect(map.panBy).toHaveBeenCalledTimes(1);
    expect(controls.active()).toBe(false);
    expect(canvas.style.cursor).toBe("crosshair");
  });
  it("pans on Space plus mouse movement without a mouse-button press or polygon click", () => {
    const { canvas, map, controls, mouse, key } = setup();
    canvas.focus(); mouse("mouseenter", 10, 20);
    expect(key("keydown").defaultPrevented).toBe(true);
    mouse("mousemove", 25, 40);
    expect(map.panBy).toHaveBeenCalledWith([-15, -20], { duration: 0 });
    const clicked = vi.fn(); canvas.addEventListener("click", clicked);
    mouse("mousedown", 25, 40); mouse("mouseup", 25, 40); key("keyup"); mouse("click", 25, 40);
    expect(clicked).not.toHaveBeenCalled();
    mouse("mousedown", 35, 50); mouse("mouseup", 35, 50); mouse("click", 35, 50);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(controls.active()).toBe(false);
  });
  it("leaves Space in text inputs alone even when the pointer is over the map", () => {
    const { map, mouse, key, controls } = setup();
    mouse("mouseenter", 10, 20);
    const input = document.createElement("input"); document.body.append(input); input.focus();
    expect(key("keydown").defaultPrevented).toBe(false);
    mouse("mousemove", 40, 60);
    expect(map.panBy).not.toHaveBeenCalled(); expect(controls.active()).toBe(false);
  });
  it("releases panning on window blur and removes handlers on cleanup", () => {
    const { canvas, map, controls, mouse, key } = setup();
    canvas.focus(); mouse("mouseenter", 10, 20); key("keydown"); window.dispatchEvent(new Event("blur"));
    mouse("mousemove", 30, 40);
    expect(map.panBy).not.toHaveBeenCalled(); expect(controls.active()).toBe(false);
    controls.destroy(); mouse("mousedown", 10, 20, 1); mouse("mousemove", 40, 40, 1);
    expect(map.panBy).not.toHaveBeenCalled(); expect(canvas.style.cursor).toBe("");
  });
});
