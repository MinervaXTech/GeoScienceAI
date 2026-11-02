import { useEffect, useRef, useState, type PointerEvent } from "react";
import { crownMatchFeatures, type PixelRect, type CrownImage } from "../geo/templateMatch";
import type { CrownMatchingController } from "./useCrownMatching";
import { CROWN_REVIEW_LABELS, crownReviewFeatures, crownReviewSummary, type CrownReviewStatus } from "../geo/crownReview";
import { CrownTemplateHistory } from "./CrownTemplateHistory";

export function CrownMatchingPanel({ matching: m, onCapture, canCapture, canAgent, museImage, earthEngineImage }: { matching: CrownMatchingController; onCapture(): void; canCapture: boolean; canAgent: boolean; museImage: CrownImage | null; earthEngineImage: CrownImage | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sampleCanvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<PixelRect | null>(null);
  const [activeSector, setActiveSector] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!m.image || !canvas.current) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled || !canvas.current) return;
      const context = canvas.current.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, m.image!.width, m.image!.height); context.drawImage(image, 0, 0);
      if (m.shown) for (const match of m.result?.matches ?? []) {
        context.strokeStyle = "#ffda00"; context.lineWidth = 1;
        if (match.radiusPx !== undefined) { context.beginPath(); context.arc(match.x + match.width / 2, match.y + match.height / 2, match.radiusPx, 0, Math.PI * 2); context.stroke(); }
        else context.strokeRect(match.x, match.y, match.width, match.height);
      }
      if (m.reviewShown) for (const sector of m.areaReview?.sectors ?? []) {
        const status = m.areaReview?.reviews.find((r) => r.id === sector.id)?.status;
        context.strokeStyle = status === "crowns_accounted_for" ? "#34d058" : status === "no_visible_palms" ? "#b9c0c9" : status === "uncertain" ? "#cb8bff" : "#ffb700";
        context.lineWidth = sector.id === activeSector ? 3 : 0.5; context.setLineDash([3, 2]); context.strokeRect(sector.x, sector.y, sector.width, sector.height); context.setLineDash([]);
        context.font = "12px sans-serif"; context.fillStyle = "#ffffff"; context.strokeStyle = "#111111"; context.lineWidth = 3;
        context.strokeText(sector.id, sector.x + 3, sector.y + 14); context.fillText(sector.id, sector.x + 3, sector.y + 14);
      }
      const sample = draft ?? m.sample;
      if (sample) { context.strokeStyle = "#00f5ff"; context.lineWidth = 2; context.strokeRect(sample.x, sample.y, sample.width, sample.height); }
      if (m.sample && sampleCanvas.current) {
        const preview = sampleCanvas.current, crop = m.sample;
        preview.width = crop.width; preview.height = crop.height;
        preview.getContext("2d")?.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      }
    };
    image.src = m.image.imageDataUrl;
    return () => { cancelled = true; };
  }, [m.image, m.sample, m.result, m.shown, m.reviewShown, m.areaReview, activeSector, draft]);
  const inspectSector = (id: string) => {
    setActiveSector(id); setZoom(2);
    requestAnimationFrame(() => {
      const sector = m.areaReview?.sectors.find((s) => s.id === id), element = canvas.current, viewport = element?.parentElement;
      if (!sector || !element || !viewport || !m.image) return;
      viewport.scrollIntoView({ behavior: "smooth", block: "center" });
      const scale = element.clientWidth / m.image.width;
      viewport.scrollTo({ left: (sector.x + sector.width / 2) * scale - viewport.clientWidth / 2, top: (sector.y + sector.height / 2) * scale - viewport.clientHeight / 2 });
    });
  };
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(event.currentTarget.width, Math.round((event.clientX - rect.left) / rect.width * event.currentTarget.width))), y: Math.max(0, Math.min(event.currentTarget.height, Math.round((event.clientY - rect.top) / rect.height * event.currentTarget.height))) };
  };
  const rectangle = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
  const finish = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!start.current) return;
    const selected = rectangle(start.current, point(event));
    start.current = null; setDraft(null);
    if (selected.width && selected.height) m.setSample(selected);
  };
  const download = () => {
    if (!m.result) return;
    const result = m.result;
    const { imageDataUrl: _bytes, ...frame } = result.image; void _bytes;
    const data = { type: "FeatureCollection", features: [...crownMatchFeatures(result).features, ...crownReviewFeatures(result.image, m.areaReview).features], matching: { ...result, image: frame }, areaReview: m.areaReview };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/geo+json" }));
    const a = document.createElement("a"); a.href = url; a.download = `crown-template-${result.receivedAt.replaceAll(":", "-")}.geojson`; a.click(); URL.revokeObjectURL(url);
  };
  return <section id="crown-matching-workspace" className="muse-workspace" aria-label="Crown template matching">
    <div className="sam-section-header"><h2>Crown detection <span className="badge plain">Local matcher + Muse agent</span></h2></div>
    <div id="crown-matching-content" className="muse-content">
      <div className="muse-controls">
        <p>Load original imagery, then let Muse choose and run crown matching, or select a template manually.</p>
        <div className="sam-actions"><button type="button" className="btn" disabled={!canCapture || m.busy} onClick={onCapture}>{m.image ? "Recapture selected area" : "Capture selected area"}</button>{museImage && <button type="button" className="btn" disabled={m.busy} onClick={() => { void m.useImage(museImage); }}>Use Muse original capture</button>}{earthEngineImage && <button type="button" className="btn" disabled={m.busy} onClick={() => { void m.useImage(earthEngineImage); }}>Use Earth Engine preview</button>}</div>
        <p className="hint">Original Esri or Earth Engine imagery, up to 1024 pixels per side. Recapture after changing the polygon. Capture a smaller region if crowns are too small to distinguish.</p>
        {m.image && <>
          <div className="crown-agent-controls">
            <h3>Muse crown-detection agent</h3>
            <p className="hint">Muse searches for missed crowns across the whole polygon using different crown templates. Each pass adds to the combined detections, removes duplicates and feeds the cumulative overlay back for review.</p>
            <label>Detection goal<textarea aria-label="Muse crown detection goal" rows={2} maxLength={1000} value={m.agentGoal} disabled={m.busy} onChange={(event) => m.setAgentGoal(event.target.value)} /></label>
            <label>Search budget<select aria-label="Muse crown search rounds" value={m.agentMaxRounds} disabled={m.busy} onChange={(event) => m.setAgentMaxRounds(Number(event.target.value))}>{[2, 4, 6, 8, 12].map((n) => <option key={n} value={n}>{n} rounds maximum</option>)}</select></label>
            <label className="legend-route"><input type="checkbox" checked={m.keepExisting} disabled={m.busy} onChange={(event) => m.setKeepExisting(event.target.checked)} />Keep existing detections and expand coverage</label>
            <button type="button" className="btn primary" disabled={!canAgent || !m.agentConfigured || m.busy || !m.agentGoal.trim() || ("earthEngine" in m.image && (m.image.earthEngine?.nativeResolutionM ?? 0) >= 10)} onClick={() => { void m.runAgent(); }}>{m.keepExisting && m.result ? "Continue coverage with Muse" : "Run Muse crown agent"}</button>
            {m.busy && m.agentRun?.status === "running" && <><button type="button" className="btn" onClick={m.cancel}>Stop coverage search</button><p role="status">{m.phase}{m.phase.startsWith("Matching") ? ` ${m.progress}%` : ""}</p></>}
            <p className="hint">Up to {m.agentMaxRounds} Muse Spark API calls, billed by tokens. The last call reviews every area. Three attempts without new candidates trigger review early. Pending or unclear sectors remain incomplete. Manual matching remains local. <a href="https://dev.meta.ai/docs/pricing-rate-limits" target="_blank" rel="noreferrer">Pricing</a></p>
            {!m.agentConfigured && <p className="hint">Configure MODEL_API_KEY and restart the app to enable the agent.</p>}
            {!canAgent && <p className="hint">Load the current finished polygon's original image to run the agent.</p>}
            {"earthEngine" in m.image && (m.image.earthEngine?.nativeResolutionM ?? 0) >= 10 && <p className="hint">This image is too coarse to resolve individual palm crowns. Choose higher-resolution original imagery.</p>}
          </div>
          <label className="crown-preview-zoom">Preview zoom <select aria-label="Preview zoom" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}><option value={1}>100%</option><option value={2}>200%</option><option value={4}>400%</option></select></label>
          <div className="crown-template-image"><canvas ref={canvas} width={m.image.width} height={m.image.height} style={{ width: `${zoom * 100}%` }} aria-label="Drag a box around one crown to use as the template" onPointerDown={(e) => { if (m.busy || e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); start.current = point(e); setDraft(rectangle(start.current, start.current)); }} onPointerMove={(e) => { if (start.current) setDraft(rectangle(start.current, point(e))); }} onPointerUp={finish} onPointerCancel={() => { start.current = null; setDraft(null); }} /></div>
          {m.sample && <div className="crown-template-sample"><canvas ref={sampleCanvas} aria-label="Selected crown sample" /><p>Sample: {m.sample.width} × {m.sample.height} px.<br /><span className="hint">Use one whole crown, 6–64 pixels per side. Drag a new box to replace it.</span></p></div>}
          <CrownTemplateHistory entries={m.templateHistory} captureKey={m.templateCaptureKey} selected={m.sample} busy={m.busy} onUse={(id) => { m.useTemplate(id); canvas.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }} />
          <div className="crown-matching-settings">
            <h3>Crown size and non-overlap</h3>
            <label>Reference crown diameter (image pixels)<input aria-label="Reference crown diameter" type="number" min="6" max="64" step="1" value={m.referenceDiameter ?? ""} placeholder="From first whole-crown sample" disabled={m.busy} onChange={(e) => m.setReferenceDiameter(e.target.value ? Number(e.target.value) : null)} /></label>
            <label>Allowed size variation: ±{Math.round(m.diameterTolerance * 100)}%<input aria-label="Crown size variation" type="range" min="0.1" max="0.5" step="0.05" value={m.diameterTolerance} disabled={m.busy} onChange={(e) => m.setDiameterTolerance(Number(e.target.value))} /></label>
            <label>Extra gap between circles: {m.circleClearance} px<input aria-label="Crown circle gap" type="range" min="0" max="16" step="1" value={m.circleClearance} disabled={m.busy} onChange={(e) => m.setCircleClearance(Number(e.target.value))} /></label>
            <div className="sam-actions"><button className="btn small" disabled={!m.sample || m.busy} onClick={() => m.sample && m.setReferenceDiameter(Math.min(m.sample.width, m.sample.height))}>Use selected sample size</button><button className="btn small" disabled={!m.result || m.busy} onClick={m.applyConstraints}>Apply crown constraints</button></div>
            <p className="hint">Choose one whole palm crown as the size reference. Oversized groups, elongated patches and overlapping circles are rejected; circles are never shrunk to pack in more detections. These are annotation footprints, not measured crown edges. Real fronds can overlap.</p>
            <label>Minimum similarity: {m.settings.threshold.toFixed(2)}<input aria-label="Minimum similarity" type="range" min="0.4" max="0.99" step="0.01" value={m.settings.threshold} disabled={m.busy} onChange={(e) => m.setSettings({ ...m.settings, threshold: Number(e.target.value) })} /></label>
            <label>Minimum spacing: {m.settings.spacing.toFixed(2)}× crown size<input aria-label="Minimum spacing" type="range" min="0.25" max="2" step="0.05" value={m.settings.spacing} disabled={m.busy} onChange={(e) => m.setSettings({ ...m.settings, spacing: Number(e.target.value) })} /></label>
            <label className="legend-route"><input type="checkbox" checked={m.settings.multiScale} disabled={m.busy} onChange={(e) => m.setSettings({ ...m.settings, multiScale: e.target.checked })} />Match size variations (80%, 100%, 120%)</label>
          </div>
          <p className="hint">Lower similarity finds more candidates and more false matches. Increase spacing to suppress nearby duplicates. Changes apply on the next run. A single sample can miss crowns with different lighting or frond orientation.</p>
          <div className="sam-actions"><button type="button" className="btn primary" disabled={!m.sample || m.busy} onClick={() => { void m.run(); }}>Find matching crowns</button></div>
        </>}
        {m.phase && <p role="status">{m.phase}{m.phase.startsWith("Matching") ? ` ${m.progress}%` : ""}</p>}
        {m.busy && <button type="button" className="btn" onClick={m.cancel}>Cancel detection</button>}
        {m.error && <p className="sam-error" role="alert">{m.error}</p>}
        {m.storageError && <p className="hint">{m.storageError}</p>}
      </div>
      {m.areaReview && <div className="muse-output" role="region" aria-label="Crown area review">
        <h3>Whole-polygon area review</h3>
        <p>{crownReviewSummary(m.areaReview.sectors, m.areaReview.reviews).resolved}/{m.areaReview.sectors.length} sectors assessed without an outstanding issue · {crownReviewSummary(m.areaReview.sectors, m.areaReview.reviews).pending} pending</p>
        <label className="legend-route"><input type="checkbox" checked={m.reviewShown} onChange={(e) => m.setReviewShown(e.target.checked)} />Show area review grid</label>
        <p className="hint">Review every sector, including empty areas. Orange: unreviewed or missed · Purple: uncertain · Green: accounted for · Grey: genuine gap. Muse assessments and user reviews are labelled separately; neither certifies field truth.</p>
        <div className="crown-review-list">{m.areaReview.sectors.map((s) => {
          const review = m.areaReview!.reviews.find((r) => r.id === s.id);
          return <div key={s.id} className="crown-review-row" data-status={review?.status ?? "unreviewed"}>
            <div className="sam-actions"><strong>{s.id} · {s.count} candidates</strong><button type="button" className="btn small" onClick={() => inspectSector(s.id)}>Inspect {s.id}</button></div>
            <label>Assessment<select aria-label={`Review sector ${s.id}`} value={review?.status ?? ""} disabled={m.busy} onChange={(e) => m.setSectorReview(s.id, e.target.value as CrownReviewStatus)}><option value="" disabled>Unreviewed</option>{Object.entries(CROWN_REVIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <p className="hint">{review ? `${review.reviewer === "user" ? "User review" : review.reviewer === "system" ? "Review invalidated" : "Muse assessment"}: ${review.reason}` : "No assessment yet. Zero detections does not prove there are no palms."}</p>
            {review && ((review.status === "no_visible_palms" && s.count > 0) || (review.status === "crowns_accounted_for" && s.count === 0)) && <p className="sam-error">Assessment conflicts with the candidate count. Inspect again; this sector remains pending.</p>}
          </div>;
        })}</div>
      </div>}
      {m.agentRun && <div className="muse-output" role="region" aria-label="Muse crown agent output">
        <h3>Muse crown agent · {m.agentRun.status}</h3>
        <p className="hint">Search budget: {m.agentRun.maxRounds ?? 2} rounds · Starting candidates: {m.agentRun.initialCandidates ?? 0}</p>
        <p>{m.agentRun.reason ?? "Inspecting the source image and tool feedback…"}</p>
        <ol>{m.agentRun.steps.map((step) => <li key={step.round}><strong>Round {step.round} · {step.call.name === "match_crowns" ? "Run crown matcher" : "Stop and assess"}</strong><p>{step.call.arguments.reason}</p>{step.outcome && <p className="hint">{step.outcome.status === "completed" ? `${step.outcome.count} pass candidates · ${(step.outcome.durationMs / 1000).toFixed(2)} s${step.outcome.selfMatchOnly ? " · only the selected sample matched" : ""}` : `Tool error: ${step.outcome.error}`}{step.outcome.coverage && ` · +${step.outcome.coverage.addedCandidates} net new · ${step.outcome.coverage.mergedCount} combined`}</p>}</li>)}</ol>
        <p className="hint">Candidates are image-similarity matches and require visual review. The agent does not certify a tree count.</p>
        <details className="muse-trace"><summary>Crown agent run log · {m.agentRun.steps.length} steps</summary><pre>{JSON.stringify(m.agentRun, null, 2)}</pre></details>
        <button type="button" className="btn small" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(m.agentRun, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `crown-agent-${m.agentRun!.id}.json`; link.click(); URL.revokeObjectURL(url); }}>Download agent log JSON</button>
      </div>}
      {m.result && <div className="muse-output" aria-label="Template matching output">
        <h3>{m.result.matches.length} candidate crown matches{m.result.truncated ? " · limit reached" : ""}</h3>
        <p className="hint">{new Date(m.result.receivedAt).toLocaleString()} · {(m.result.durationMs / 1000).toFixed(2)} s · {m.result.coverage ? `${m.result.coverage.templateCount} template passes · per-pass settings in log` : `Similarity ≥ ${m.result.settings.threshold.toFixed(2)}`} · {m.result.image.width} × {m.result.image.height} px</p>
        {m.result.coverage && <p className="hint">Candidate spread: {m.result.coverage.sectors.filter((sector) => sector.count > 0).length}/{m.result.coverage.sectors.length} nontransparent image sectors. This shows spatial distribution, not the percentage of trees detected. Continue coverage to look for missed crowns; roads and gaps can remain empty.</p>}
        <label className="legend-route"><input type="checkbox" checked={m.shown} onChange={(e) => m.setShown(e.target.checked)} /><i className="crown-match-swatch" aria-hidden="true" />Show crown matches</label>
        <p>Yellow circles show crown candidates within the chosen size range, with no overlapping circles. They require visual review and are not segmented crown boundaries.</p>
        {m.result.physical && <p className="hint">Diameter {m.result.physical.policy.minDiameterPx.toFixed(1)}–{m.result.physical.policy.maxDiameterPx.toFixed(1)} px · Rejected: {m.result.physical.sizeRejected} outside size range, {m.result.physical.shapeRejected} elongated, {m.result.physical.overlapRejected} overlapping.</p>}
        {m.result.matches.length === 0 && <p className="hint">No matches at this threshold. Choose a more distinct crown or lower similarity and run again.</p>}
        {m.result.matches.length === 1 && m.result.matches[0]!.x === m.result.sample.x && m.result.matches[0]!.y === m.result.sample.y && <p className="hint">Only the selected sample itself matched. Choose a more representative crown, reduce the sample box, or lower similarity and run again.</p>}
        {m.result.truncated && <p className="hint">A matching-pass or combined candidate limit was reached. Use a smaller area or a higher threshold.</p>}
        <div className="sam-actions"><button type="button" className="btn small" onClick={download}>Download crown matches GeoJSON</button></div>
        <details className="muse-trace"><summary>Matching summary</summary><pre>{JSON.stringify({ method: m.result.method, sample: m.result.sample, settings: m.result.settings, candidateCount: m.result.matches.length, physical: m.result.physical, truncated: m.result.truncated, durationMs: m.result.durationMs, coverage: m.result.coverage, bestScores: m.result.matches.slice(0, 10).map((hit) => Number(hit.score.toFixed(4))) }, null, 2)}</pre></details>
      </div>}
    </div>
  </section>;
}
