import type { Item, LabState } from "../domain/types";
import { PEAKS } from "../geo/layer";
import { SampleBadge } from "./Badges";
import { formatDateTime } from "./format";

interface Props {
  state: LabState;
  snapshots: Item[];
  /** Snapshot ids currently on the map, in draw order (first is solid, second is dashed). */
  active: string[];
  expanded: boolean;
  onToggleExpanded(): void;
  onOpenUpm(): void;
  onToggle(id: string): void;
}

/** The saved UPM study map and its route snapshots across all batches. */
export function SavedMaps({ state, snapshots, active, expanded, onToggleExpanded, onOpenUpm, onToggle }: Props) {
  return (
    <nav className="saved-maps" aria-label="Saved maps">
      <h2>
        <button
          type="button"
          className="saved-maps-toggle"
          aria-label={expanded ? "Collapse saved maps" : "Expand saved maps"}
          aria-expanded={expanded}
          aria-controls="saved-maps-content"
          title={expanded ? "Collapse saved maps" : "Expand saved maps"}
          onClick={onToggleExpanded}
        >
          {expanded && <span>Saved maps</span>}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d={expanded ? "m10 4-4 4 4 4" : "m6 4 4 4-4 4"} />
          </svg>
        </button>
      </h2>
      <div id="saved-maps-content" className="saved-maps-content" hidden={!expanded}>
        <ul>
          <li>
            <button type="button" className="on" aria-current="true" aria-label="Open UPM map" onClick={onOpenUpm}>
              <strong>UPM, Selangor</strong>
              <span>CHMv2 canopy · {PEAKS.length} candidate peaks</span>
              <span>Home · Google satellite basemap</span>
              <span className="on-map">Current map</span>
            </button>
          </li>
        </ul>
        <section className="saved-map-routes" aria-label="UPM route snapshots">
          <h3>Route snapshots</h3>
          {snapshots.length === 0 ? (
            <p className="hint">No route snapshots yet. Register one from a paper batch's units.</p>
          ) : (
            <ul>
              {snapshots.map((s) => {
                const pos = active.indexOf(s.id);
                const batch = state.batches.find((b) => b.id === s.batchId);
                return (
                  <li key={s.id}>
                    <button type="button" className={pos >= 0 ? "on" : ""} aria-pressed={pos >= 0} onClick={() => onToggle(s.id)}>
                      <strong>{s.title}</strong>
                      <span>
                        {batch?.name} · {s.snapshot?.hash} · {s.snapshot?.units.length} units
                      </span>
                      <span>{s.snapshot?.route ? `Route ${s.snapshot.route}` : "No route unit"} · {formatDateTime(s.createdAt)}</span>
                      {pos >= 0 && <span className="on-map">On map: {pos === 0 ? "solid line" : "dashed line"}</span>}
                      {s.sample && <SampleBadge />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {snapshots.length > 0 && <p className="hint">Pick up to two routes to draw. A third replaces the oldest pick.</p>}
        </section>
      </div>
    </nav>
  );
}
