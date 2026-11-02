import { useRef, type ReactNode } from "react";
export type MapToolId = "planning" | "clusters" | "sam" | "muse" | "crowns";
export interface MapToolPanel { id: MapToolId; label: string; status?: string; content: ReactNode }

export function MapTools({ panels, active, onChange }: { panels: MapToolPanel[]; active: MapToolId | null; onChange(id: MapToolId | null): void }) {
  const buttons = useRef<Partial<Record<MapToolId, HTMLButtonElement | null>>>({});
  return <section id="map-tools" className={`map-tools${active ? "" : " tools-closed"}`} aria-label="Map tools">
    <div className="map-tool-toolbar">
      <div className="map-tool-tabs" role="tablist" aria-label="Map tool panels" aria-orientation="horizontal">
        {panels.map((panel, index) => <button key={panel.id} ref={(button) => { buttons.current[panel.id] = button; }} type="button" role="tab" id={`map-tool-tab-${panel.id}`} aria-label={panel.label} aria-selected={active === panel.id} aria-controls={`map-tool-panel-${panel.id}`} tabIndex={active === panel.id || (!active && index === 0) ? 0 : -1} className="map-tool-tab" onClick={() => onChange(panel.id)} onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const next = event.key === "ArrowRight" ? (index + 1) % panels.length : event.key === "ArrowLeft" ? (index + panels.length - 1) % panels.length : event.key === "Home" ? 0 : event.key === "End" ? panels.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); const target = panels[next]!; onChange(target.id); buttons.current[target.id]?.focus();
        }}>{panel.label}{panel.status && <span className="badge plain" aria-hidden="true">{panel.status}</span>}</button>)}
      </div>
      <button type="button" className="btn small map-tools-hide" disabled={!active} onClick={() => onChange(null)} aria-label="Hide map tool panel">Hide panel</button>
    </div>
    {panels.map((panel) => <div key={panel.id} id={`map-tool-panel-${panel.id}`} role="tabpanel" aria-labelledby={`map-tool-tab-${panel.id}`} className="map-tool-panel" tabIndex={0} hidden={active !== panel.id}>{panel.content}</div>)}
  </section>;
}
