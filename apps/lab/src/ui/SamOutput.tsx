import { BASEMAP_NAMES, type SamResult } from "../geo/sam";
import type { SamController } from "./useSam";
import { SamRunHistory } from "./SamRunHistory";

export function SamOutput({ sam, onFit, onUseResult }: { sam: SamController; onFit(): void; onUseResult(result: SamResult): void }) {
  const result = sam.result;
  const latestLog = sam.logs[0];
  const failedLatest = latestLog?.status === "error" && (!result || latestLog.startedAt > result.receivedAt);
  return (
    <section className="sam-output" id="sam-output" aria-label="SAM 3.1 output">
      <h2>SAM 3.1 output</h2>
      {failedLatest && <p className="sam-error" role="alert">Latest run failed. {result ? "The result below is from the previous successful run. " : ""}See the JSON run log for details.</p>}
      {!result ? <p className="hint">No output yet. Draw an area and run SAM to see results here.</p> : <>
        <div className="sam-output-summary"><strong>{result.objects}</strong><span>{result.objects === 1 ? "segment" : "segments"}<br /><span className="hint">Completed · “{result.prompt}”</span></span></div>
        {result.objects === 0 && <p className="sam-empty-output" role="status">{!result.runLog ? "This earlier run saved 0 segments. The original provider response was not retained, so this count cannot be independently verified." : result.runLog.decoding.masks > 0 ? `Provider returned ${result.runLog.decoding.masks} masks; ${result.runLog.decoding.emptyMasks} were empty and ${result.runLog.decoding.clippedAway} did not intersect the polygon. No segments were displayed.` : `Provider completed with empty segmentation output (${result.runLog.provider.outputTextLength} output characters, 0 mask records).`}</p>}
        <dl className="sam-output-meta"><dt>Source</dt><dd>{BASEMAP_NAMES[result.source]}</dd><dt>Area</dt><dd>{result.area ? "Selected polygon" : "Whole viewport (earlier run)"}</dd><dt>Input</dt><dd>{result.frame.width} × {result.frame.height} px</dd><dt>Completed</dt><dd>{new Date(result.receivedAt).toLocaleString()}</dd></dl>
        <label className="legend-route"><input type="checkbox" checked={sam.shown && result.objects > 0} disabled={result.objects === 0} onChange={(e) => sam.setShown(e.target.checked)} /><i className="sam-swatch" aria-hidden="true" />Show SAM masks</label>
        <div className="sam-actions"><button type="button" className="btn small" onClick={onFit}>Locate processed area</button><button type="button" className="btn small" onClick={sam.download}>Download GeoJSON</button></div>
        {result.objects > 0 && <div className="sam-object-list"><table><thead><tr><th>Segment</th><th>Confidence</th></tr></thead><tbody>{result.regions.features.slice(0, 20).map((feature, i) => <tr key={String(feature.properties?.objectId ?? i)}><td>{String(feature.properties?.objectId ?? i + 1)}</td><td>{typeof feature.properties?.confidence === "number" ? `${Math.round(feature.properties.confidence * 100)}%` : "Not provided"}</td></tr>)}</tbody></table>{result.objects > 20 && <p className="hint">Showing 20 of {result.objects}. Download GeoJSON for every segment.</p>}</div>}
        <p className="hint">Saved locally. Segments are model predictions.</p>
      </>}
      <SamRunHistory logs={sam.logs} activeRunId={result?.runLog?.id} loadingRunId={sam.loadingRunId} busy={sam.busy} onUse={(id) => { void sam.selectRun(id).then((chosen) => { if (chosen) onUseResult(chosen); }); }} />
      {sam.preview && <details className="sam-preview"><summary>Latest captured input ({sam.preview.width} × {sam.preview.height})</summary><img src={sam.preview.imageDataUrl} alt="Polygon-cropped satellite input for SAM 3.1" /></details>}
    </section>
  );
}
