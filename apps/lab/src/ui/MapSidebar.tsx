import { KnowledgeSidebar } from "./KnowledgeSidebar";
import { EnvironmentsSidebar, type MapChoice } from "./EnvironmentsPanel";
import type { EnvSummary } from "./paperRunUi";
import { useRef, type ReactNode } from "react";

export type MapSidebarTab = "maps" | "layers" | "snapshots" | "knowledge" | "environments";
const allTabs = [{ id: "environments", label: "Environments", heading: "Environments" }, { id: "maps", label: "Maps", heading: "Saved maps" }, { id: "layers", label: "Layers", heading: "Map layers" }, { id: "snapshots", label: "Snapshots", heading: "Snapshots" }, { id: "knowledge", label: "Knowledge", heading: "Paper knowledge base" }] as const;

export function MapSidebar({ active, expanded, onOpen, onCollapse, maps, snapshots, layerHost, viewingEnv, onViewEnv, choices, currentMapId, onOpenMap }: {
  choices: MapChoice[];
  currentMapId: string;
  onOpenMap(id: string): void;
  viewingEnv: string | null;
  onViewEnv(env: EnvSummary | null): void;
  active: MapSidebarTab;
  expanded: boolean;
  onOpen(tab: MapSidebarTab): void;
  onCollapse(): void;
  maps: ReactNode;
  snapshots: ReactNode;
  layerHost(element: HTMLDivElement | null): void;
}) {
  const buttons = useRef<Partial<Record<MapSidebarTab, HTMLButtonElement | null>>>({});
  // Layers belong to a satellite map, so the tab is hidden while a simulated environment is on show.
  const tabs = allTabs.filter(tab => tab.id !== "layers" || !viewingEnv), shown = tabs.find(tab => tab.id === active) ?? tabs[0]!;
  return <aside className={`map-sidebar${expanded ? "" : " is-collapsed"}`} aria-label="Map sidebar">
    <div className="map-sidebar-tabs" role="tablist" aria-label="Map sidebar panels" aria-orientation="vertical">
      {tabs.map((tab, index) => <button key={tab.id} ref={(button) => { buttons.current[tab.id] = button; }} type="button" role="tab" id={`map-sidebar-tab-${tab.id}`} aria-label={tab.label} title={tab.label} aria-selected={active === tab.id} aria-expanded={expanded && active === tab.id} aria-controls={`map-sidebar-panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1} onClick={() => onOpen(tab.id)} onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const next = event.key === "ArrowDown" ? (index + 1) % tabs.length : event.key === "ArrowUp" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); onOpen(tabs[next]!.id); buttons.current[tabs[next]!.id]?.focus();
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {tab.id === "maps" ? <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z" /><path d="M9 3v16M15 5v16" /></> : tab.id === "layers" ? <><path d="m12 3 10 6-10 6L2 9Z" /><path d="m2 13 10 6 10-6M2 17l10 6 10-6" /></> : tab.id === "knowledge" ? <><path d="M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3Z" /><path d="M12 6v16M6 8h3M15 8h3M6 12h3M15 12h3" /></> : tab.id === "environments" ? <><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></> : <><rect x="7" y="7" width="14" height="14" rx="1" /><path d="M17 7V3H3v14h4M11 11h6M11 15h6" /></>}
        </svg>
        <span>{tab.id === "snapshots" ? "Snaps" : tab.id === "knowledge" ? "Papers" : tab.id === "environments" ? "Envs" : tab.label}</span>
      </button>)}
    </div>
    <div className="map-sidebar-body" hidden={!expanded}>
      <header className="map-sidebar-heading"><h2>{shown.heading}</h2><button type="button" className="map-sidebar-collapse" aria-label="Collapse map sidebar" title="Collapse sidebar" onClick={() => { onCollapse(); buttons.current[active]?.focus(); }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 4-4 4 4 4" /></svg></button></header>
      <div className="map-sidebar-scroll">
        <div role="tabpanel" id="map-sidebar-panel-maps" aria-labelledby="map-sidebar-tab-maps" hidden={shown.id !== "maps"}>{maps}</div>
        <div role="tabpanel" id="map-sidebar-panel-layers" aria-labelledby="map-sidebar-tab-layers" hidden={shown.id !== "layers"}><div className="map-layer-host" ref={layerHost} /></div>
        <div role="tabpanel" id="map-sidebar-panel-knowledge" aria-labelledby="map-sidebar-tab-knowledge" hidden={shown.id !== "knowledge"}>{shown.id === "knowledge" && <KnowledgeSidebar />}</div>
        <div role="tabpanel" id="map-sidebar-panel-environments" aria-labelledby="map-sidebar-tab-environments" hidden={shown.id !== "environments"}>{shown.id === "environments" && <EnvironmentsSidebar maps={choices} currentMapId={currentMapId} viewing={viewingEnv} onOpenMap={onOpenMap} onView={onViewEnv} />}</div>
        <div role="tabpanel" id="map-sidebar-panel-snapshots" aria-labelledby="map-sidebar-tab-snapshots" hidden={shown.id !== "snapshots"}>{snapshots}</div>
      </div>
    </div>
  </aside>;
}
