interface PanMap {
  getCanvas(): HTMLCanvasElement;
  stop(): unknown;
  panBy(offset: [number, number], options: { duration: number }): unknown;
}

/** Add middle-button drag and Space + mouse movement without generating map clicks. */
export function bindMapPanGestures(map: PanMap, isDrawing: () => boolean, onStart: () => void) {
  const canvas = map.getCanvas();
  const doc = canvas.ownerDocument;
  const win = doc.defaultView!;
  let space = false, middle = false, hovering = false, blockClick = false;
  let previous: [number, number] | null = null;
  let pointer: [number, number] | null = null;
  const active = () => space || middle;
  const updateCursor = () => { canvas.style.cursor = active() ? "grabbing" : isDrawing() ? "crosshair" : ""; };
  const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const reset = () => { space = false; middle = false; previous = null; blockClick = false; updateCursor(); };
  const enter = (event: MouseEvent) => { hovering = true; pointer = [event.clientX, event.clientY]; };
  const leave = () => { hovering = false; pointer = null; };
  const down = (event: MouseEvent) => {
    if (event.target !== canvas) { if (space && !middle) reset(); return; }
    if (event.button !== 1 && !(space && event.button === 0)) {
      if (event.button === 0) blockClick = false;
      return;
    }
    consume(event);
    canvas.focus({ preventScroll: true });
    if (event.button === 1) middle = true;
    else blockClick = true;
    previous = [event.clientX, event.clientY];
    map.stop(); onStart(); updateCursor();
  };
  const move = (event: MouseEvent) => {
    if (event.target === canvas) pointer = [event.clientX, event.clientY];
    if (!active()) return;
    consume(event);
    const next: [number, number] = [event.clientX, event.clientY];
    if (previous) {
      const dx = next[0] - previous[0], dy = next[1] - previous[1];
      if (dx || dy) map.panBy([-dx, -dy], { duration: 0 });
    }
    previous = next;
  };
  const up = (event: MouseEvent) => {
    if (event.button === 1 && middle) {
      consume(event); middle = false;
      previous = space ? [event.clientX, event.clientY] : null;
      updateCursor();
    } else if (event.button === 0 && (space || blockClick)) consume(event);
  };
  const click = (event: MouseEvent) => {
    if (active() || blockClick || event.button === 1) { consume(event); blockClick = false; }
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.code !== "Space" && event.key !== " ") return;
    if (event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof Element && event.target.closest("input, textarea, select, button, [contenteditable]"))) return;
    if (!hovering && doc.activeElement !== canvas) return;
    event.preventDefault();
    if (space) return;
    space = true; previous = pointer;
    map.stop(); onStart(); updateCursor();
  };
  const keyUp = (event: KeyboardEvent) => {
    if ((event.code !== "Space" && event.key !== " ") || !space) return;
    event.preventDefault(); space = false;
    if (!middle) previous = null;
    updateCursor();
  };
  const visibility = () => { if (doc.hidden) reset(); };
  const focus = (event: FocusEvent) => { if (space && event.target !== canvas) reset(); };
  canvas.addEventListener("mouseenter", enter);
  canvas.addEventListener("mouseleave", leave);
  canvas.addEventListener("click", click, true);
  canvas.addEventListener("auxclick", click, true);
  win.addEventListener("mousedown", down, true);
  win.addEventListener("mousemove", move, true);
  win.addEventListener("mouseup", up, true);
  win.addEventListener("keydown", keyDown, true);
  win.addEventListener("keyup", keyUp, true);
  win.addEventListener("blur", reset);
  doc.addEventListener("visibilitychange", visibility);
  doc.addEventListener("focusin", focus);
  updateCursor();
  return {
    active, updateCursor,
    destroy() {
      canvas.removeEventListener("mouseenter", enter);
      canvas.removeEventListener("mouseleave", leave);
      canvas.removeEventListener("click", click, true);
      canvas.removeEventListener("auxclick", click, true);
      win.removeEventListener("mousedown", down, true);
      win.removeEventListener("mousemove", move, true);
      win.removeEventListener("mouseup", up, true);
      win.removeEventListener("keydown", keyDown, true);
      win.removeEventListener("keyup", keyUp, true);
      win.removeEventListener("blur", reset);
      doc.removeEventListener("visibilitychange", visibility);
      doc.removeEventListener("focusin", focus);
      canvas.style.cursor = "";
    },
  };
}
