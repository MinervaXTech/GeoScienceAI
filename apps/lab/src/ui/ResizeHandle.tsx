import { useEffect, useRef, useState } from "react";

interface Props {
  /** "x" resizes a side pane (grows when dragged left), "y" a bottom pane (grows when dragged up). */
  axis: "x" | "y";
  value: number;
  min: number;
  max: number;
  label: string;
  step?: number;
  onChange(value: number): void;
  onReset(): void;
  className?: string;
}

export function ResizeHandle({ axis, value, min, max, label, step = 32, onChange, onReset, className = "" }: Props) {
  const drag = useRef<(() => void) | null>(null);
  const [active, setActive] = useState(false);
  useEffect(() => () => drag.current?.(), []);
  const grow = axis === "x" ? "ArrowLeft" : "ArrowUp", shrink = axis === "x" ? "ArrowRight" : "ArrowDown";
  return <div role="separator" aria-orientation={axis === "x" ? "vertical" : "horizontal"} aria-label={label} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0} title="Drag to resize, double-click to reset"
    className={`resize-handle ${axis}${active ? " dragging" : ""} ${className}`.trim()}
    onPointerDown={e => {
      e.preventDefault(); drag.current?.();
      const startX = e.clientX, startY = e.clientY, start = value;
      const move = (ev: PointerEvent) => onChange(start + (axis === "x" ? startX - ev.clientX : startY - ev.clientY));
      const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); drag.current = null; setActive(false); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop); window.addEventListener("pointercancel", stop);
      drag.current = stop; setActive(true);
    }}
    onDoubleClick={onReset}
    onKeyDown={e => {
      if (e.key === grow) { e.preventDefault(); onChange(value + step); }
      else if (e.key === shrink) { e.preventDefault(); onChange(value - step); }
      else if (e.key === "Home") { e.preventDefault(); onChange(min); }
      else if (e.key === "End") { e.preventDefault(); onChange(max); }
    }} />;
}
