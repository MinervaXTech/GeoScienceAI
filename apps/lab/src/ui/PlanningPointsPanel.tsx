import type { CrownMatchResult } from "../geo/templateMatch";
import { planningCsv, planningFeatures, planningFigureSvg } from "../geo/planningPoints";
import type { PlanningController, PlanningEditMode } from "./usePlanningPoints";
export const PLANNING_MODES: [PlanningEditMode, string][] = [["exclude", "Exclude empty region"], ["add", "Add points"], ["move", "Move points"], ["delete", "Delete points"], ["home", "Set home"]];
export function PlanningPointsPanel({ planning: p, matches, available, blocked, onMode, onCover, scope, onScope }: { scope: "map" | "selection"; onScope(value: "map" | "selection"): void; onCover(): void; planning: PlanningController; matches: CrownMatchResult | null; available: boolean; blocked: boolean; onMode(mode: PlanningEditMode): void }) {
  const download = (data: string, filename: string, mime: string) => { const url = URL.createObjectURL(new Blob([data], { type: mime })); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); };
  return <section id="planning-points-workspace" className="muse-workspace" aria-label="Approximate crown planning points">
    <div className="sam-section-header"><h2>Planning points <span className="badge plain">Approximate crown centres</span></h2></div>
    <div className="muse-content">
      <div className="muse-controls">
        <h3>Cover the whole tree area</h3>
        <p>Generate a dense set of estimated tree centres across the tree-covered parts of your map. Combine RGB tree texture with numeric CHMv2 canopy heights and the loaded SAM 3.1 output polygons.</p>
        <label>Coverage area<select aria-label="Dense tree coverage area" value={scope} disabled={p.busy} onChange={(e) => onScope(e.target.value as "map" | "selection")}><option value="map">Whole saved map</option><option value="selection">Current selected polygon</option></select></label>
        <div className="earth-engine-grid"><label>Estimated tree spacing (m)<input aria-label="Estimated tree spacing" type="number" min="2" max="50" step="0.5" value={p.treeSpacing} disabled={p.busy} onChange={(e) => p.setTreeSpacing(Number(e.target.value))} /></label><label>Canopy sensitivity: {Math.round(p.sensitivity * 100)}%<input aria-label="Canopy sensitivity" type="range" min="0" max="1" step="0.05" value={p.sensitivity} disabled={p.busy} onChange={(e) => p.setSensitivity(Number(e.target.value))} /></label></div>
        <div className="planning-guidance" role="group" aria-label="Tree point guidance">
          <label className="legend-route"><input type="checkbox" checked={p.useChmv2} disabled={p.busy} onChange={(e) => p.setUseChmv2(e.target.checked)} />Use CHMv2 canopy heights</label>
          <label>Minimum CHMv2 canopy height (m)<input aria-label="Minimum CHMv2 canopy height" type="number" min="0" max="254" step="1" value={p.minimumHeightM} disabled={p.busy || !p.useChmv2} onChange={(e) => p.setMinimumHeightM(Number(e.target.value))} /></label>
          <p className="hint">Uses the numeric metre band to reject low or missing heights and favour local canopy-height peaks. Missing heights stay excluded while this option is enabled.</p>
          <label className="legend-route"><input type="checkbox" checked={p.useSam} disabled={p.busy} onChange={(e) => p.setUseSam(e.target.checked)} />Restrict points to SAM 3.1 output polygons</label>
          <p className="hint">{p.samReady ? "Uses the loaded SAM output masks, including holes and disconnected regions, intersected with the coverage area. Changing the selected SAM run applies on the next coverage pass." : "No nonempty SAM output is loaded for this map. Use a saved result in the SAM run log, or disable this constraint to run without SAM."}</p>
          <p className="hint">These settings apply when you regenerate points. They do not retroactively change an earlier point set.</p>
        </div>
        <button className="btn primary" disabled={!available || blocked || p.busy || (p.useSam && !p.samReady)} onClick={onCover}>Cover whole tree area with points</button>
        {p.coveragePhase && <p role="status">{p.coveragePhase} <button className="btn small" onClick={p.cancelCoverage}>Cancel coverage</button></p>}
        <p className="hint">Uses original imagery and fills gaps between matched centres over textured vegetation. Smaller spacing creates more points; higher sensitivity includes weaker tree texture. Review empty areas with the cover-mask checkbox and Exclude empty region. Estimated points are yellow; matched centres are green; manual points are cyan.</p>
        {p.set?.coverage && !p.set.coverage.needsRefresh && <p className="hint">{p.set.coverage.estimatedCount.toLocaleString()} estimates + {p.set.coverage.retainedCount.toLocaleString()} retained centres · {Math.round(100 * p.set.coverage.coveredPixels / p.set.coverage.eligiblePixels)}% of the estimated tree-cover mask is within one spacing of a point. This is spatial coverage of the constrained tree-cover mask, not the percentage of real trees found.</p>}
        {p.set?.coverage && <div className="hint" role="region" aria-label="Point generation guidance summary">
          <p>Last generation used: RGB{p.set.coverage.guidance?.chmv2 ? " + CHMv2" : ""}{p.set.coverage.guidance?.sam ? " + SAM output polygons" : ""}.</p>
          {p.set.coverage.guidance?.chmv2 && <p>CHMv2 ≥ {p.set.coverage.guidance.chmv2.minimumHeightM} m · {p.set.coverage.guidance.chmv2.missingPixels.toLocaleString()} missing-height pixels excluded · {p.set.coverage.guidance.chmv2.belowHeightPixels.toLocaleString()} pixels below threshold · source date: {p.set.coverage.guidance.chmv2.sourceDate ?? "varies / historical"}.</p>}
          {p.set.coverage.guidance?.sam && <p>SAM: {p.set.coverage.guidance.sam.objects} segment(s) · “{p.set.coverage.guidance.sam.prompt}” · loaded result from {new Date(p.set.coverage.guidance.sam.receivedAt).toLocaleString()}.</p>}
        </div>}
        {p.set?.coverage?.needsRefresh && <p className="hint">Points have been edited. Run coverage again to refresh the spatial coverage summary.</p>}
        <details><summary>Use sparse matches only</summary>
        <div className="earth-engine-grid"><label>Cleanup spacing (m)<input aria-label="Planning point cleanup spacing" type="number" min="0.5" max="50" step="0.5" value={p.spacing} onChange={(e) => p.setSpacing(Number(e.target.value))} /></label><label>Minimum similarity<input aria-label="Planning point minimum similarity" type="number" min="0.4" max="1" step="0.01" value={p.threshold} onChange={(e) => p.setThreshold(Number(e.target.value))} /></label></div>
        <div className="sam-actions"><button className="btn primary" disabled={!matches || !available || blocked || p.busy} onClick={() => matches && p.load(matches)}>Use crown centres for planning</button><button className="btn" disabled={!available || blocked || p.busy} onClick={() => { p.startManual(); onMode("add"); }}>Add visible crowns manually</button></div>
        <p className="hint">Uses retained crown-matching centres from the current polygon. No points are generated in empty areas. Loading centres replaces this map's planning set; Undo restores it. Spacing controls duplicate cleanup, not assumed tree size.</p>
        {!matches && <p className="hint">Crown matching is optional for dense coverage. You can also add points manually.</p>}
        </details>
        {p.set && <>
          <h3>{p.set.points.length} approximate planning points</h3>
          {!!p.set.exclusions?.length && <p className="hint">{p.set.exclusions.length} empty region(s) excluded from coverage.</p>}
          <p className="hint">This set uses {p.set.minSpacingM} m cleanup spacing. Changed cleanup settings apply when loading centres again.</p>
          {p.stale && <p className="sam-error">This point set belongs to an earlier polygon. Load current crown centres or start manual points to work on the current area.</p>}
          <div className="sam-actions">{PLANNING_MODES.map(([mode, title]) => <button key={mode} className={`btn${p.mode === mode ? " primary" : ""}`} disabled={p.stale || blocked || p.busy} onClick={() => onMode(mode)}>{title}</button>)}<button className="btn" disabled={!p.canUndo || blocked || p.busy} onClick={p.undo}>Undo point edit</button></div>
          <p className="hint">Exclude: drag a box over an empty region to remove points and keep it empty on the next coverage pass. Add: click a visible crown. Move: drag its point. Delete: click an unwanted point. Set home: click the start location. Home initially uses the first point. Editing points invalidates the previous route.</p>
          {p.set.coverage && <label className="legend-route"><input type="checkbox" checked={p.coverShown} onChange={(e) => p.setCoverShown(e.target.checked)} />Show estimated tree-cover mask</label>}
          <label className="legend-route"><input type="checkbox" checked={p.shown} onChange={(e) => p.setShown(e.target.checked)} />Show planning points</label><label className="legend-route"><input type="checkbox" checked={p.labels} onChange={(e) => p.setLabels(e.target.checked)} />Show planning point IDs</label>
          <button className="btn primary" disabled={p.set.points.length < 2 || p.busy || blocked} onClick={p.compare}>Compare planning routes</button>
          {p.busy && !p.coveragePhase && <p role="status">Calculating routes… <button className="btn small" onClick={p.cancelRoute}>Cancel route calculation</button></p>}
          {p.routes && <div role="region" aria-label="Planning route comparison"><p><strong>A · Nearest neighbour:</strong> {p.routes.A.lengthM.toFixed(1)} m<br /><strong>B · Nearest neighbour + 2-opt:</strong> {p.routes.B.lengthM.toFixed(1)} m<br />Reduction: {p.routes.A.lengthM ? (100 * (1 - p.routes.B.lengthM / p.routes.A.lengthM)).toFixed(1) : "0.0"}% · Same {p.set.points.length} points, each visited once, returning home.</p><label className="legend-route"><input type="checkbox" checked={p.showA} onChange={(e) => p.setShowA(e.target.checked)} />Show planning route A</label><label className="legend-route"><input type="checkbox" checked={p.showB} onChange={(e) => p.setShowB(e.target.checked)} />Show planning route B</label></div>}
          <div className="sam-actions"><button className="btn small" onClick={() => download(planningCsv(p.set!, p.routes), "approximate-crown-points.csv", "text/csv")}>Download planning CSV</button><button className="btn small" onClick={() => download(JSON.stringify({ ...planningFeatures(p.set, p.routes), planning: { ...p.set, routes: p.routes }, note: "Approximate crown centres for a route-planning study, not surveyed trees." }, null, 2), "approximate-crown-planning.geojson", "application/geo+json")}>Download planning GeoJSON</button><button className="btn small" disabled={!p.routes} onClick={() => p.routes && download(planningFigureSvg(p.set!, p.routes), "crown-route-comparison.svg", "image/svg+xml")}>Download paper figure SVG</button></div>
          <p className="hint">Points are approximate image-derived locations, not a verified tree inventory. Routes are straight-line study tours without obstacle avoidance or flight validation. CSV/GeoJSON retain the reviewed coordinates; the SVG is a vector comparison figure for your paper.</p>
        </>}
        {p.error && <p className="sam-error" role="alert">{p.error}</p>}
      </div>
    </div>
  </section>;
}
