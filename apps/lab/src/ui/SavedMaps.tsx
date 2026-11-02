import type { Item, LabState, SavedMap } from "../domain/types";
import { BASEMAP_NAMES } from "../geo/sam";
import { AddMapForm } from "./AddMapForm";
import type { MapLocation } from "../geo/places";
import { PEAKS } from "../geo/layer";
import { SampleBadge } from "./Badges";
import { formatDateTime } from "./format";
import type { SamAreaController } from "./useSamArea";

interface Props {
  state: LabState;
  view: Omit<SavedMap, "id" | "name"> | null;
  snapshots: Item[];
  /** Snapshot ids currently on the map, in draw order (first is solid, second is dashed). */
  active: string[];
  adding: boolean;
  onAddingChange(adding: boolean): void;
  basemap: SavedMap["basemap"];
  onBasemap(value: SavedMap["basemap"]): void;
  area: SamAreaController;
  currentMapId: string;
  busy: boolean;
  onOpenMap(id: string): void;
  onGetView(): Omit<SavedMap, "id" | "name"> | null;
  onLocate(location: MapLocation): boolean;
  onAdd(map: SavedMap): void;
  onDelete(id: string): void;
  onToggle(id: string): void;
}

/** Named map locations, plus UPM's route snapshots across all batches. */
export function SavedMaps({ view, state, snapshots, active, adding, onAddingChange, basemap, onBasemap, area, currentMapId, busy, onOpenMap, onGetView, onLocate, onAdd, onDelete, onToggle }: Props) {
  return (
    <nav className="saved-maps" aria-label="Saved maps">
      <div className="saved-maps-content">
        <button type="button" className="btn" disabled={busy || adding} onClick={() => onAddingChange(true)}>+ Add map</button>
        {adding && <AddMapForm view={view} basemap={basemap} onBasemap={onBasemap} onLocate={onLocate} onReadView={onGetView} area={area.polygon} drawing={area.drawing} onResetArea={() => area.restore(null)} onDrawArea={() => { area.start(); document.querySelector(".satellite-map")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} onCancel={() => { if (view) onLocate(view); onAddingChange(false); }} onSave={onAdd} />}
        <ul>
          <li>
            <button type="button" disabled={busy} className={currentMapId === "upm" ? "on" : ""} aria-current={currentMapId === "upm" ? "true" : undefined} aria-label="Open UPM map" onClick={() => { onAddingChange(false); onOpenMap("upm"); }}>
              <strong>UPM, Selangor</strong>
              <span>CHMv2 canopy · {PEAKS.length} candidate peaks</span>
              <span>Home · Satellite basemap</span>
              {currentMapId === "upm" && <span className="on-map">Current map</span>}
            </button>
          </li>
          {(state.maps ?? []).map((map) => <li key={map.id} className="saved-map-entry"><button type="button" disabled={busy} className={`saved-map-open${currentMapId === map.id ? " on" : ""}`} aria-current={currentMapId === map.id ? "true" : undefined} aria-label={`Open ${map.name} map`} onClick={() => { onAddingChange(false); onOpenMap(map.id); }}>
            <strong>{map.name}</strong><span>{BASEMAP_NAMES[map.basemap]}</span><span>{map.center[1].toFixed(5)}, {map.center[0].toFixed(5)}</span>
            {currentMapId === map.id && <span className="on-map">Current map</span>}
          </button><button type="button" className="saved-map-delete" disabled={busy || adding} aria-label={`Delete ${map.name} map`} title={`Delete ${map.name} map`} onClick={() => onDelete(map.id)}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M2.5 4.5h11M6 4.5V2.5h4v2M4 4.5l.6 9h6.8l.6-9M6.5 6.5v5M9.5 6.5v5" /></svg></button></li>)}
        </ul>
        {!adding && <p className="hint place-credit">Place search: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></p>}
        {currentMapId === "upm" && <section className="saved-map-routes" aria-label="UPM route snapshots">
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
        </section>}
      </div>
    </nav>
  );
}
