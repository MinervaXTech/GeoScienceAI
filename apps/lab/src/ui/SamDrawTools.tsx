import type { SamAreaController } from "./useSamArea";

export function SamDrawTools({ area, addingMap = false }: { area: SamAreaController; addingMap?: boolean }) {
  if (!area.drawing) return null;
  return <div className="sam-draw-tools" role="group" aria-label="SAM polygon tools">
      <strong>{area.editing ? "Edit" : "Draw"} {addingMap ? "map boundary" : "SAM area"} · {area.vertices.length} corners</strong>
      <p>{area.editing ? "Drag corners to reshape. Double-click an edge to add a corner. Right-click to finish." : "Click corners, then right-click to finish."} Pan with the middle mouse button or hold Space and move the mouse.</p>
      <button type="button" className="btn primary small" onClick={area.finish} disabled={area.vertices.length < 3}>{area.editing ? "Finish editing" : "Finish polygon"}</button>
      <button type="button" className="btn small" onClick={area.undo} disabled={!area.canUndo}>{area.editing ? "Undo edit" : "Undo corner"}</button>
      <button type="button" className="btn small" onClick={area.cancel}>{area.editing ? "Cancel editing" : "Cancel drawing"}</button>
    {area.error && <p className="sam-error" role="alert">{area.error}</p>}
  </div>;
}
