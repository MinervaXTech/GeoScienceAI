import { useRef, type ReactNode } from "react";

export type MapSidebarTab = "maps" | "layers";
const tabs = [{ id: "maps", label: "Maps" }, { id: "layers", label: "Layers" }] as const;

export function MapSidebar({ active, expanded, onOpen, onCollapse, maps, layerHost }: {
  active: MapSidebarTab;
  expanded: boolean;
  onOpen(tab: MapSidebarTab): void;
  onCollapse(): void;
  maps: ReactNode;
  layerHost(element: HTMLDivElement | null): void;
}) {
  const buttons = useRef<Partial<Record<MapSidebarTab, HTMLButtonElement | null>>>({});
  return <aside className={`map-sidebar${expanded ? "" : " is-collapsed"}`} aria-label="Map sidebar">
    <div className="map-sidebar-tabs" role="tablist" aria-label="Map sidebar panels" aria-orientation="vertical">
      {tabs.map((tab, index) => <button key={tab.id} ref={(button) => { buttons.current[tab.id] = button; }} type="button" role="tab" id={`map-sidebar-tab-${tab.id}`} aria-label={tab.label} title={tab.label} aria-selected={active === tab.id} aria-expanded={expanded && active === tab.id} aria-controls={`map-sidebar-panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1} onClick={() => onOpen(tab.id)} onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const next = event.key === "ArrowDown" ? (index + 1) % tabs.length : event.key === "ArrowUp" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); onOpen(tabs[next]!.id); buttons.current[tabs[next]!.id]?.focus();
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {tab.id === "maps" ? <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z" /><path d="M9 3v16M15 5v16" /></> : <><path d="m12 3 10 6-10 6L2 9Z" /><path d="m2 13 10 6 10-6M2 17l10 6 10-6" /></>}
        </svg>
        <span>{tab.label}</span>
      </button>)}
    </div>
    <div className="map-sidebar-body" hidden={!expanded}>
      <header className="map-sidebar-heading"><h2>{active === "maps" ? "Saved maps" : "Map layers"}</h2><button type="button" className="map-sidebar-collapse" aria-label="Collapse map sidebar" title="Collapse sidebar" onClick={() => { onCollapse(); buttons.current[active]?.focus(); }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 4-4 4 4 4" /></svg></button></header>
      <div className="map-sidebar-scroll">
        <div role="tabpanel" id="map-sidebar-panel-maps" aria-labelledby="map-sidebar-tab-maps" hidden={active !== "maps"}>{maps}</div>
        <div role="tabpanel" id="map-sidebar-panel-layers" aria-labelledby="map-sidebar-tab-layers" hidden={active !== "layers"}><div className="map-layer-host" ref={layerHost} /></div>
      </div>
    </div>
  </aside>;
}
