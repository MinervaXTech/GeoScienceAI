import type { BasemapId } from "../geo/sam";
import type { MuseController } from "./useMuse";
import type { SamAreaController } from "./useSamArea";
import type { MusePyramidController } from "./useMusePyramid";
import { museSourceLabel } from "../geo/muse";
import { EarthEngineInput } from "./EarthEngineInput";
import type { EarthEngineController } from "./useEarthEngine";

export function MusePanel({ muse, pyramid, onUse, onRun, basemap, area, blocked, inputSource, onInputSource, engine }: { muse: MuseController; pyramid: MusePyramidController; onUse(): void; onRun(): void; basemap: BasemapId; area: SamAreaController; blocked: boolean; inputSource: "esri" | "earth-engine"; onInputSource(source: "esri" | "earth-engine"): void; engine: EarthEngineController }) {
  const result = muse.result;
  const analysis = result?.analysis;
  const generative = result?.method === "generative";
  const downloadLog = () => {
    if (!result) return;
    const { input, enhancedImageDataUrl: _image, ...summary } = result;
    void _image;
    const { imageDataUrl: _original, ...frame } = input;
    void _original;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...summary, input: frame }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `muse-${result.id}.json`; link.click(); URL.revokeObjectURL(url);
  };
  return <section id="muse-workspace" className="muse-workspace" aria-label="Muse map agent">
    <div className="sam-section-header">
      <h2>Muse map agent <span className="badge plain">{muse.busy ? "Working" : muse.configured ? "Ready" : "Not configured"}</span></h2>
    </div>
    <div id="muse-content" className="muse-content">
      <form className="muse-controls" onSubmit={(e) => { e.preventDefault(); onRun(); }}>
        <label>Muse image source<select aria-label="Muse image source" value={inputSource} disabled={blocked || muse.busy || !!engine.phase} onChange={(event) => onInputSource(event.target.value === "earth-engine" ? "earth-engine" : "esri")}><option value="esri" disabled={basemap !== "esri"}>Current Esri satellite view</option><option value="earth-engine">Earth Engine image · independent of viewing basemap</option></select></label>
        {inputSource === "earth-engine" && <EarthEngineInput engine={engine} disabled={blocked || muse.busy || area.drawing} />}
        <label>Enhancement technique<select aria-label="Enhancement technique" value={muse.method} disabled={muse.busy} onChange={(event) => muse.setMethod(event.target.value === "generative" ? "generative" : "adjustments")}><option value="generative">GenAI reconstruction · Muse Image</option><option value="adjustments">Tonal adjustments · Muse Spark</option></select></label>
        <p className="hint">{muse.method === "generative" ? "Requests conservative restoration: suppress noise, preserve observed crown sizes and spacing, and leave unresolved patches uncertain. Spark reviews crown scale, invented texture and shifted features against the original. Model compliance is unverified; this remains a visual preview." : "Muse Spark chooses brightness, contrast, saturation and unsharp masking. This mode does not generate detail or increase true resolution."}</p>
        <label>Goal<textarea value={muse.objective} maxLength={1000} rows={3} disabled={muse.busy} onChange={(e) => muse.setObjective(e.target.value)} /></label>
        <div className="sam-actions">
          <button type="submit" className="btn primary" disabled={blocked || !muse.configured || muse.busy || !!engine.phase || !muse.objective.trim() || (inputSource === "earth-engine" ? !engine.preview : basemap !== "esri") || !area.polygon || area.drawing}>{muse.method === "generative" ? "Run GenAI enhancement" : "Run tonal enhancement"}</button>
          {muse.busy && <button type="button" className="btn" onClick={muse.cancel}>Cancel Muse</button>}
        </div>
        <p className="hint">{muse.method === "generative" ? `Muse Image 1.0 + ${muse.model} review · 1 image request + 1 review · US$0.01/image plus review tokens` : `${muse.model} · Up to 2 token-billed calls per run`} · <a href="https://dev.meta.ai/docs/pricing-rate-limits" target="_blank" rel="noreferrer">Pricing</a></p>
        {inputSource === "esri" && basemap !== "esri" && <p className="hint">Choose Earth Engine as the Muse image source to keep viewing Google Satellite, or switch the viewing basemap to Esri.</p>}
        {inputSource === "earth-engine" && !engine.preview && <p className="hint">Sign in, find a scene covering the polygon, then preview its input to enable Run. No Muse call is made by search or preview.</p>}
        {!area.polygon && <p className="hint">Draw and finish a polygon on the map first.</p>}
        {area.drawing && <p className="hint">Finish editing the polygon before running Muse.</p>}
        {muse.phase && <p role="status">{muse.phase}</p>}
        {muse.error && <p className="sam-error" role="alert">{muse.error}</p>}
      </form>
      {result ? <div className="muse-output" aria-label="Muse output">
        <header><h3>{result.mapName} · {result.status === "completed" ? "Muse output" : "Enhancement ready; analysis incomplete"}</h3><span className="hint">{new Date(result.receivedAt).toLocaleString()} · {(result.durationMs / 1000).toFixed(1)} s</span></header>
        <p className="hint">Goal: {result.objective}</p>
        <div className="muse-comparison">
          <figure><figcaption>Original · {museSourceLabel(result.input)}</figcaption><img src={result.input.imageDataUrl} alt="Original selected satellite area" /><a className="btn small" href={result.input.imageDataUrl} download={`muse-${result.id}-original.png`}>Download original</a></figure>
          <figure><figcaption>{generative ? "GenAI reconstruction · unverified preview" : "Muse-guided tonal enhancement"}</figcaption><img src={result.enhancedImageDataUrl} alt="Enhanced selected satellite area" /><div className="sam-actions"><button type="button" className="btn small primary" disabled={blocked || muse.busy || pyramid.loading || (pyramid.layer?.runId === result.id && pyramid.shown)} onClick={onUse}>{pyramid.loading ? "Building pyramid…" : pyramid.layer?.runId === result.id && pyramid.shown ? "In use" : "Use"}</button><a className="btn small" href={result.enhancedImageDataUrl} download={`muse-${result.id}-enhanced.png`}>Download enhanced PNG</a></div><p className="hint">Use builds and loads {generative ? "this GenAI preview" : "the tonal enhancement"} as a tile pyramid. No new Muse call.</p></figure>
        </div>
        {result.settings && <p>{result.settings.reason}</p>}
        {result.input.earthEngine && <p className="hint">Source date: {result.input.earthEngine.sourceDate?.slice(0, 10) ?? "unknown"} · Native pixel size: {result.input.earthEngine.nativeResolutionM !== null ? `${result.input.earthEngine.nativeResolutionM.toFixed(2)} m` : "unknown"} · RGB bands: {result.input.earthEngine.bands.join(", ")} · {result.input.earthEngine.attribution}</p>}
        {pyramid.error && <p className="sam-error" role="alert">{pyramid.error}</p>}
        {pyramid.layer?.runId === result.id && <p className="hint">Pyramid ready · {pyramid.layer.tileCount} tiles · zoom {pyramid.layer.minzoom}–{pyramid.layer.maxzoom}. Toggle the Muse enhancement in the map legend.</p>}
        {result.settings && <p className="hint">Brightness {result.settings.brightness > 0 ? "+" : ""}{result.settings.brightness} · Contrast {result.settings.contrast}× · Saturation {result.settings.saturation}× · Sharpen {result.settings.sharpen}. Pixel positions and the polygon are preserved. These filters do not recover new ground detail.</p>}
        {generative && <p className="hint">{result.model} · Native output {result.generation?.nativeWidth} × {result.generation?.nativeHeight} · Map preview {result.enhancedFrame?.width} × {result.enhancedFrame?.height}. Original polygon crop reapplied. Generated feature positions are unverified; SAM and template matching continue to use original imagery.</p>}
        {result.error && <p className="sam-error" role="alert">{result.error} The enhanced image is still available.</p>}
        {analysis && <>
          <h3>Map analysis</h3><p>{analysis.summary}</p>
          <ul>{analysis.observations.map((item, i) => <li key={i}>{item}</li>)}</ul>
          <h3>Suggested improvements</h3><ol>{analysis.improvements.map((item, i) => <li key={i}><strong>{item.title}</strong><p>{item.action}</p><p className="hint">{item.reason}</p></li>)}</ol>
          <h3>Enhancement review</h3><p>{analysis.enhancementReview}</p>
          <h3>Uncertainty and data needed</h3><ul>{analysis.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </>}
        <div className="sam-actions"><button type="button" className="btn small" onClick={downloadLog}>Download Muse JSON</button></div>
        <details className="muse-trace"><summary>Agent run log · {result.trace.length} steps</summary><pre>{JSON.stringify({ runId: result.id, model: result.model, inputSha256: result.inputSha256, enhancedSha256: result.enhancedSha256, trace: result.trace }, null, 2)}</pre></details>
        <p className="hint">Saved for this map. Map observations use the original RGB image; the review compares the displayed enhancement. Suggestions have not changed map layers.</p>
      </div> : <p className="empty">Run Muse to see the original, enhanced image, analysis and suggestions here.</p>}
      {muse.failedTrace.length > 0 && <details className="muse-trace"><summary>Failed run log</summary><pre>{JSON.stringify(muse.failedTrace, null, 2)}</pre></details>}
    </div>
  </section>;
}
