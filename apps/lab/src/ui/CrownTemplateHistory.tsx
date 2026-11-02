import type { CrownTemplateEntry } from "../geo/crownTemplates";
import type { PixelRect } from "../geo/templateMatch";

export function CrownTemplateHistory({ entries, captureKey, selected, busy, onUse }: { entries: CrownTemplateEntry[]; captureKey: string | null; selected: PixelRect | null; busy: boolean; onUse(id: string): void }) {
  return <details className="crown-template-history" open>
    <summary>Template history · {entries.length}</summary>
    <p className="hint">Latest 50 selections and matching attempts for this map, including Muse templates. Use restores the sample and settings for the current capture. It does not run detection.</p>
    {!entries.length && <p className="hint">No previous templates yet. Select one crown in the preview or run the Muse crown agent.</p>}
    <div className="crown-template-history-grid">{entries.map((entry, index) => {
      const sameCapture = !!captureKey && entry.captureKey === captureKey;
      const active = sameCapture && selected && ["x", "y", "width", "height"].every((key) => selected[key as keyof PixelRect] === entry.sample[key as keyof PixelRect]);
      return <article key={entry.id} className="crown-template-history-card" aria-label={`Template ${entries.length - index}`}>
        <div className="crown-template-history-heading">{entry.thumbnail ? <img src={entry.thumbnail} alt={`${entry.source === "muse" ? "Muse" : "Manual"} crown template, ${entry.sample.width} by ${entry.sample.height} pixels`} /> : <span className="crown-template-placeholder">Preview unavailable</span>}
          <div><strong>{entry.source === "muse" ? "Muse" : "Manual"}{entry.round ? ` · Round ${entry.round}` : ""}</strong><p className="hint">{new Date(entry.selectedAt).toLocaleString()}<br />{entry.sample.width} × {entry.sample.height} px · x {entry.sample.x}, y {entry.sample.y}</p></div>
        </div>
        <p className="hint">{entry.status}{entry.candidates !== undefined ? ` · ${entry.candidates} pass candidates` : ""}{entry.addedCandidates !== undefined ? ` · +${entry.addedCandidates} net new` : ""}</p>
        <p className="hint">{entry.settingsRecovered ? "Latest saved settings · " : ""}Similarity ≥ {entry.settings.threshold.toFixed(2)} · Spacing {entry.settings.spacing.toFixed(2)}× · {entry.settings.multiScale ? "Size variations on" : "Single size"}</p>
        {entry.reason && <details><summary>Selection reason</summary><p className="hint">{entry.reason}</p></details>}
        <div className="sam-actions"><button type="button" className="btn small" aria-label={`Use template ${entries.length - index}`} disabled={busy || !sameCapture} onClick={() => onUse(entry.id)}>Use</button>{active && <span className="badge plain">Selected</span>}</div>
        {!sameCapture && <p className="hint">{entry.captureKey && captureKey ? "Earlier capture · preview only" : "Checking capture…"}</p>}
      </article>;
    })}</div>
  </details>;
}
