import { DEFAULT_ELEVATION_WEIGHT, clusterCsv, clusterExport, clusterMethod, clusterPlan, DEFAULT_START_SETTINGS, startSettings, type ClusterMethod, type PlanningCluster } from "../geo/planningClusters";
import type { PlanningPoints } from "../geo/planningPoints";
import type { RoadReference } from "../geo/roadReference";
import type { PlanningClustersController } from "./usePlanningClusters";
const METHOD_TEXT: Record<ClusterMethod, { label: string; help: string }> = {
  normal: { label: "Normal · balanced map split", help: "Splits the map into even, tidy blocks with balanced counts. The default." },
  elevation: { label: "Elevation · similar CHMv2 height", help: "Draws ordinary compact clusters, but where points on a cluster edge could go either way they prefer the neighbouring cluster of a similar CHMv2 height (read at each point's own location). Points never jump to a distant cluster. Needs CHMv2 coverage at every point." },
  concentrated: { label: "Concentrated · nearby points together", help: "Pulls nearby points into tight, rounded groups. Counts stay within your limits but may vary more between groups." },
};
const download = (data: string, name: string, type: string) => { const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };
export function PlanningClustersPanel({ clusters: c, points, road, blocked, onGenerate, onFocus }: { clusters: PlanningClustersController; road: RoadReference | null; points: PlanningPoints | null; blocked: boolean; onGenerate(): void; onFocus(cluster: PlanningCluster): void }) {
  let preview: ReturnType<typeof clusterPlan> | null = null, issue = "";
  try { if (points?.points.length) preview = clusterPlan(points.points.length, c.settings); }
  catch (e) { issue = e instanceof Error ? e.message : "Invalid cluster settings."; }
  const method = clusterMethod(c.settings);
  const start = startSettings(c.settings), setStart = (next: Partial<typeof start>) => c.setSettings({ ...c.settings, start: { ...DEFAULT_START_SETTINGS, ...start, ...next } });
  const changed = c.result && JSON.stringify(c.result.settings) !== JSON.stringify(c.settings);
  const field = (key: "target" | "tolerance" | "min" | "max", label: string) => <label>{label}<input aria-label={label} type="number" min={key === "tolerance" ? 0 : 1} max={5000} step={1} value={Number.isFinite(c.settings[key]) ? c.settings[key] : ""} disabled={c.busy} onChange={e => c.setSettings({ ...c.settings, [key]: e.target.value === "" ? NaN : Number(e.target.value) })} /></label>;
  return <section className="planning-clusters-panel" aria-label="Planning point clusters">
    <h2>Clusters <span className="badge plain">All planning points included</span></h2>
    <p>Draw spatial groups around nearby planning points. Every point belongs to exactly one cluster.</p>
    {!points?.points.length && <p className="empty">Create planning points in the Planning points tab first.</p>}
    <label>Grouping method<select aria-label="Grouping method" value={method} disabled={c.busy} onChange={e => c.setSettings({ ...c.settings, method: e.target.value as ClusterMethod })}>{(Object.keys(METHOD_TEXT) as ClusterMethod[]).map(m => <option key={m} value={m}>{METHOD_TEXT[m].label}</option>)}</select></label>
    <p className="hint">{METHOD_TEXT[method].help}</p>
    {method === "elevation" && <label>Position only ↔ prefer similar height<input aria-label="Elevation weight" type="range" min={0.1} max={2} step={0.1} value={c.settings.elevationWeight ?? DEFAULT_ELEVATION_WEIGHT} disabled={c.busy} onChange={e => c.setSettings({ ...c.settings, elevationWeight: Number(e.target.value) })} /><span className="hint">Right pulls similar-height points on cluster edges together harder. Clusters stay compact and connected either way; CHMv2 changes tree to tree, so the gain is modest.</span></label>}
    <fieldset className="cluster-start-options" disabled={c.busy}>
      <legend>Start points</legend>
      <label className="cluster-checkbox"><input type="checkbox" checked={start.enabled} onChange={e => setStart({ enabled: e.target.checked })} />Pick a start point for each cluster</label>
      {start.enabled && <>
        <p className="hint">Each start is one of the cluster's own border points, never in the middle, and is the border point nearest the road reference. Road reference: <strong>{road?.label ?? "map boundary"}</strong>{road?.source === "map-boundary" ? "" : road?.source === "sam-road" ? "" : " (no road-specific SAM output is loaded)"}.</p>
        <label className="cluster-checkbox"><input type="checkbox" checked={start.together} onChange={e => setStart({ together: e.target.checked })} />Pull neighbouring starts close together (optional)</label>
        {start.together && <label>Allowed extra distance from the road (m)<input aria-label="Allowed extra distance from the road" type="number" min={0} max={1000} step={1} value={Number.isFinite(start.flexibilityM) ? start.flexibilityM : ""} onChange={e => setStart({ flexibilityM: e.target.value === "" ? NaN : Number(e.target.value) })} /></label>}
        {start.together && <p className="hint">Starts stay on borders. A cluster may take a border point up to this far beyond its nearest-to-road point, if that puts its start next to a neighbour's, so the drone enters several clusters from one area.</p>}
      </>}
    </fieldset>
    <label>Cluster size<select aria-label="Cluster size mode" value={c.settings.mode} disabled={c.busy} onChange={e => c.setSettings({ ...c.settings, mode: e.target.value as "target" | "range" })}><option value="target">Target count ± tolerance</option><option value="range">Minimum–maximum range</option></select></label>
    <div className="cluster-settings-grid">{c.settings.mode === "target" ? <>{field("target", "Target points per cluster")}{field("tolerance", "Allowed difference (± points)")}</> : <>{field("min", "Minimum points per cluster")}{field("max", "Maximum points per cluster")}</>}</div>
    {preview && <p className="cluster-preview" role="status">{points!.points.length.toLocaleString()} points → {preview.count} clusters · {preview.smallest === preview.largest ? preview.smallest : `${preview.smallest}–${preview.largest}`} points each · allowed {preview.min}–{preview.max}.</p>}
    {issue && <p className="sam-error" role="alert">{issue}</p>}
    {blocked && !!points?.points.length && <p className="hint">Finish point editing or the current operation first. If the planning area changed, update the planning points before grouping them.</p>}
    <div className="sam-actions"><button className="btn primary" disabled={!preview || blocked || c.busy} onClick={onGenerate}>{c.result ? "Rebuild clusters" : "Draw clusters"}</button>{c.busy && <button className="btn" onClick={c.cancel}>Cancel clustering</button>}</div>
    {c.busy && <p role="status">{method === "elevation" ? "Reading CHMv2 height at every point, then grouping…" : "Grouping every point and drawing cluster boundaries…"}</p>}
    {c.stale && <p className="sam-error" role="status">Planning points changed. Previous clusters are hidden; draw them again to include every current point.</p>}
    {c.result && points && <>
      {c.roadChanged && <p className="hint">The road reference changed (a different SAM output is loaded). Rebuild clusters to move the start points.</p>}
      <p className="cluster-summary" role="status"><strong>{c.result.clusters.length} clusters · {points.points.length.toLocaleString()} / {points.points.length.toLocaleString()} points assigned</strong><br />{clusterMethod(c.result.settings)} grouping · 0 unassigned · 0 assigned twice · {Math.min(...c.result.clusters.map(g => g.pointIds.length))}–{Math.max(...c.result.clusters.map(g => g.pointIds.length))} points per cluster.</p>
      {changed && <p className="hint">Size settings changed. Rebuild clusters to apply them; the displayed groups still use the earlier settings.</p>}
      <div className="sam-actions"><label className="cluster-checkbox"><input type="checkbox" checked={c.shown} onChange={e => c.setShown(e.target.checked)} />Show cluster boundaries and colours</label><label className="cluster-checkbox"><input type="checkbox" checked={c.labels} disabled={!c.shown} onChange={e => c.setLabels(e.target.checked)} />Show cluster IDs and counts</label></div>
      <div className="cluster-list" aria-label="Cluster counts">{c.result.clusters.map(group => <button className="cluster-item" type="button" key={group.id} onClick={() => onFocus(group)} title={`Zoom to ${group.id}`}><i style={{ background: group.color }} aria-hidden="true" /><strong>{group.id}</strong><span>{group.pointIds.length} points{group.start ? ` · start ${group.start.roadDistanceM} m from road` : ""}{group.heightM ? ` · ${group.heightM.min.toFixed(1)}–${group.heightM.max.toFixed(1)} m` : ""}</span></button>)}</div>
      <div className="sam-actions"><button className="btn small" onClick={() => download(JSON.stringify(clusterExport(points, c.result!), null, 2), "planning-clusters.geojson", "application/geo+json")}>Download clusters GeoJSON</button><button className="btn small" onClick={() => download(clusterCsv(points, c.result!), "planning-clusters.csv", "text/csv")}>Download cluster membership CSV</button></div>
    </>}
    {c.error && <p className="sam-error" role="alert">{c.error}</p>}{c.storageError && <p className="sam-error" role="status">{c.storageError}</p>}
    <p className="hint">Runs locally without a model call. Groups favour nearby points and balanced counts; they are not guaranteed to be optimal. Drawn boundaries are clipped to the planning polygon and exclusions and may contain gaps or separate pieces. They are group envelopes, not measured tree boundaries. Changes to points require rebuilding.</p>
  </section>;
}
