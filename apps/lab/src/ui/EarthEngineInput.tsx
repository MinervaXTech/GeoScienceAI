import { EE_DATASETS, EE_SCENE_LIMIT, EE_SENTINEL_DAYS, sceneResolution } from "../geo/earthEngine";
import type { EarthEngineController } from "./useEarthEngine";

export function EarthEngineInput({ engine: e, disabled }: { engine: EarthEngineController; disabled: boolean }) {
  const busy = disabled || !!e.phase;
  const preset = EE_DATASETS.find((item) => item.id === e.dataset);
  const native = e.scene ? sceneResolution(e.scene, e.bands, preset?.resolution ?? null) : null;
  return <fieldset className="earth-engine-input" disabled={disabled}>
    <legend>Earth Engine image input</legend>
    <p className="hint">Google Satellite can remain visible. Muse receives the selected Earth Engine image, which may have a different date and resolution.</p>
    {!e.configured ? <p className="sam-error">Configure VITE_EARTH_ENGINE_PROJECT_ID and VITE_EARTH_ENGINE_CLIENT_ID, then restart the app.</p> : <>
      <div className="sam-actions">
        {!e.connected ? <button type="button" className="btn" disabled={!e.ready || busy} onClick={e.connect}>Sign in to Earth Engine</button> : <><span className="hint">Earth Engine connected · {e.projectId}</span><button type="button" className="btn small" disabled={busy} onClick={e.disconnect}>Disconnect</button></>}
        {!e.ready && <button type="button" className="btn small" disabled={busy} onClick={e.retrySignIn}>Reload sign-in</button>}
      </div>
      <label>Imagery collection<select aria-label="Earth Engine imagery collection" value={e.dataset} disabled={busy} onChange={(event) => e.chooseDataset(event.target.value)}>
        {EE_DATASETS.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}<option value="asset">My image asset</option>
      </select></label>
      <p className="hint">{preset?.note ?? "Enter an image asset your signed-in account can access. Select its RGB bands and display range below."}{e.dataset === "sentinel2" && ` Search window: last ${EE_SENTINEL_DAYS} days.`}</p>
      {e.dataset === "asset" && <label>Earth Engine image asset ID<input aria-label="Earth Engine image asset ID" value={e.assetId} placeholder="projects/your-project/assets/your-image" disabled={busy} onChange={(event) => e.setAssetId(event.target.value)} /></label>}
      <button type="button" className="btn" disabled={!e.connected || busy || !e.hasArea || (e.dataset === "asset" && !e.assetId.trim())} onClick={() => { void e.search(); }}>{preset ? "Find images for polygon" : "Load image metadata"}</button>
      {e.searched && !e.scenes.length && <p role="status" className="hint">No images from this source overlap the selected polygon{e.dataset === "sentinel2" ? ` within the last ${EE_SENTINEL_DAYS} days` : ""}. Choose another source. No Muse request was sent.</p>}
      {!!e.scenes.length && <>
        <label>Image scene<select aria-label="Earth Engine image scene" value={e.selected} disabled={busy} onChange={(event) => e.chooseScene(event.target.value)}>{e.scenes.map((scene) => <option key={scene.name} value={scene.name}>{scene.startTime ? scene.startTime.slice(0, 10) + " · " : ""}{scene.name.split("/").at(-1)}</option>)}</select></label>
        <p className="hint">Up to {EE_SCENE_LIMIT} most recent overlapping scenes are shown. A scene may cover only part of the polygon.</p>
        <div className="earth-engine-grid">{["Red", "Green", "Blue"].map((channel, i) => <label key={channel}>{channel} band<select aria-label={`Earth Engine ${channel.toLowerCase()} band`} value={e.bands[i]} disabled={busy} onChange={(event) => { const next = [...e.bands] as [string, string, string]; next[i] = event.target.value; e.setBands(next); }}>{e.scene?.bands?.map((band) => <option key={band.id} value={band.id}>{band.id}</option>)}</select></label>)}</div>
        <div className="earth-engine-grid"><label>Display minimum<input aria-label="Earth Engine display minimum" type="number" value={e.minimum} disabled={busy} onChange={(event) => e.setMinimum(Number(event.target.value))} /></label><label>Display maximum<input aria-label="Earth Engine display maximum" type="number" value={e.maximum} disabled={busy} onChange={(event) => e.setMaximum(Number(event.target.value))} /></label></div>
        <label>Image attribution<input aria-label="Earth Engine attribution" value={e.attribution} maxLength={1000} disabled={busy} onChange={(event) => e.setAttribution(event.target.value)} /></label>
        <p className="hint">Source pixel size: {native !== null ? `approximately ${native.toFixed(2)} m` : "unknown; inspect asset metadata"}. {native !== null && native >= 10 ? "This source is too coarse to resolve individual palm crowns." : "Export dimensions are bounded to 1024 pixels per side."}</p>
        <details><summary>Scene metadata and licence information</summary><pre className="muse-trace">{JSON.stringify(e.scene, null, 2)}</pre></details>
        <button type="button" className="btn" disabled={!e.connected || busy || !e.scene || !e.attribution.trim() || !(e.minimum < e.maximum)} onClick={() => { void e.capture(); }}>Preview polygon input</button>
      </>}
      {e.phase && <p role="status">{e.phase}</p>}
      {!!e.phase && <button type="button" className="btn small" onClick={e.cancel}>Cancel Earth Engine request</button>}
      {e.error && <p role="alert" className="sam-error">{e.error}</p>}
      {e.preview && <figure className="earth-engine-preview"><figcaption>Input ready · {e.preview.width} × {e.preview.height} px · {e.preview.earthEngine?.sourceDate?.slice(0, 10) ?? "date unknown"}</figcaption><img src={e.preview.imageDataUrl} alt="Selected Earth Engine polygon input for Muse" /><p className="hint">{e.preview.earthEngine?.attribution}. This is the image the Run button sends to Muse.</p><a className="btn small" href={e.preview.imageDataUrl} download="earth-engine-polygon-input.png">Download input PNG</a></figure>}
    </>}
  </fieldset>;
}
