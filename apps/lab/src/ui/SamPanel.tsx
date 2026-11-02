import { BASEMAP_NAMES, DEFAULT_SAM_CONCEPT, type BasemapId } from "../geo/sam";
import type { SamController } from "./useSam";
import type { SamAreaController } from "./useSamArea";

export function SamPanel({ sam, basemap, area, addingMap = false, onRun, onDraw }: { sam: SamController; basemap: BasemapId; area: SamAreaController; addingMap?: boolean; onRun(): void; onDraw(): void }) {
  return (
    <section className="sam-panel" aria-label="SAM 3.1 segmentation">
      <h2>Run SAM 3.1</h2>
      <p className="hint">{addingMap ? "Save the map boundary before running SAM." : area.defaultPolygon ? "1. Use the saved map boundary, or draw a smaller SAM region." : `1. Draw a polygon on ${BASEMAP_NAMES[basemap]}.`}</p>
      <div className="sam-actions"><button type="button" className="btn" disabled={sam.busy} onClick={onDraw}>{area.usingDefault ? "Draw smaller area on map" : area.polygon ? "Redraw area on map" : "Draw area on map"}</button>{area.polygon && !area.usingDefault && <button type="button" className="btn" disabled={sam.busy} onClick={area.clear}>{area.defaultPolygon ? "Use whole map" : "Clear area"}</button>}</div>
      <p className="hint">{area.drawing ? `${area.editing ? "Editing" : "Drawing"} · ${area.vertices.length} corners. Finish the polygon on the map.` : area.polygon ? `${area.usingDefault ? "Whole map selected" : "Polygon selected"} · ${area.polygon.coordinates[0]!.length - 1} corners.` : "Select an area before running SAM."}</p>
      {area.error && <p className="sam-error" role="alert">{area.error}</p>}
      <p className="hint">2. Name the objects to segment, then run.</p>
      <form onSubmit={(e) => { e.preventDefault(); onRun(); }}>
        <label className="sam-prompt">Segment concept<input value={sam.prompt} maxLength={100} disabled={sam.busy} onChange={(e) => sam.setPrompt(e.target.value)} placeholder={DEFAULT_SAM_CONCEPT} /></label>
        <div className="sam-actions">
          <button type="submit" className="btn primary" disabled={addingMap || !sam.configured || sam.busy || !sam.prompt.trim() || basemap !== "esri" || !area.polygon || area.drawing}>{sam.loadingRunId ? "Loading result…" : sam.busy ? "Processing…" : "Run SAM 3.1"}</button>
          {sam.busy && !sam.loadingRunId && <button type="button" className="btn" onClick={sam.cancel}>Cancel</button>}
        </div>
      </form>
      <p className="hint">One image per run · <a href="https://dev.meta.ai/docs/pricing-rate-limits" target="_blank" rel="noreferrer">US$0.0025/image</a></p>
      {!sam.configured && <p className="hint">Configure MODEL_API_KEY in .env.local to run SAM.</p>}
      {basemap !== "esri" && <p className="hint">Select Esri World Imagery to run segmentation.</p>}
      {sam.phase && <p role="status">{sam.phase}</p>}
      {sam.error && <p className="sam-error" role="alert">{sam.error}</p>}
    </section>
  );
}
