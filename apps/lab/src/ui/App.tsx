import { useEffect, useMemo, useRef, useState } from "react";
import { costReadout } from "../domain/config";
import { exportJson, importJson } from "../domain/persistence";
import { noFilters, type Filters, type Sort } from "../domain/query";
import { hasSampleData, loadSampleData } from "../domain/sample";
import { addBatch, currentSession, newSession, registerSnapshot, saveMessageToNotes, sendMessage, setReview, setSessionMode } from "../domain/store";
import { emptyState, type SavedMap } from "../domain/types";
import type { Polygon } from "geojson";
import { UPM_MAP } from "../geo/maps";
import { SampleBadge } from "./Badges";
import { ChatPanel } from "./ChatPanel";
import { CompareView } from "./CompareView";
import { formatDateTime } from "./format";
import { MapView, mapSummary } from "./MapView";
import { NotesView } from "./NotesView";
import { SavedMaps } from "./SavedMaps";
import { MapSidebar, type MapSidebarTab } from "./MapSidebar";
import { DeleteMapDialog } from "./DeleteMapDialog";
import { Snapshots } from "./Snapshots";
import { snapshotScope } from "./snapshotScope";
import { useMapChat } from "./useMapChat";
import { validateMapAgentCall, type MapAgentHandle } from "../geo/mapAgent";
import { useLab } from "./useLab";
import { useSam } from "./useSam";
import { useSamArea } from "./useSamArea";
import type { BasemapId, SatelliteMapHandle } from "../geo/sam";
import { deleteSavedMap, withDefaultMapAreas } from "../domain/maps";
import { samePolygon } from "../geo/samArea";

type Tab = "map" | "notes";

export function App() {
  const { state, apply, run, replace, notice, setNotice } = useLab();
  const currentMap = state.maps?.find((map) => map.id === state.activeMapId) ?? UPM_MAP;
  const sam = useSam(currentMap.id);
  const samArea = useSamArea(currentMap.area, currentMap.boundary);
  const [basemap, setBasemap] = useState<BasemapId>(currentMap.basemap);
  const agentRef = useRef<MapAgentHandle | null>(null);
  const mapRef = useRef<SatelliteMapHandle | null>(null);
  const mapAreas = useRef<Record<string, Polygon | null>>({});
  const [tab, setTab] = useState<Tab>("map");
  const [comparing, setComparing] = useState(false);
  const [filters, setFilters] = useState<Filters>(noFilters());
  const [sort, setSort] = useState<Sort | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [viewSession, setViewSession] = useState<string | undefined>();
  const [shown, setShown] = useState([true, true]);
  const [pick, setPick] = useState<{ a?: string; b?: string }>({});
  const [mapPick, setMapPick] = useState<string[] | undefined>();
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<MapSidebarTab>("maps");
  const [layerHost, setLayerHost] = useState<HTMLDivElement | null>(null);
  const openSidebar = (panel: MapSidebarTab) => { setSidebarTab(panel); setSidebarExpanded(true); };
  const [addMapView, setAddMapView] = useState<Omit<SavedMap, "id" | "name"> | null>(null);
  const [addingMap, setAddingMap] = useState(false);
  const [deletedMap, setDeletedMap] = useState<{ map: SavedMap; index: number; wasActive: boolean; area: Polygon | null } | null>(null);
  const [deleteMapId, setDeleteMapId] = useState<string | null>(null);
  const pendingDeleteMap = state.maps?.find((map) => map.id === deleteMapId);
  const originalBasemap = useRef(basemap);
  const originalSamArea = useRef(samArea.polygon);
  const changeAddingMap = (adding: boolean) => {
    if (adding) { const view = mapRef.current?.getView(); setAddMapView(view ? { ...view, basemap } : null); openSidebar("maps"); originalBasemap.current = basemap; originalSamArea.current = samArea.polygon; }
    else if (addingMap) { setBasemap(originalBasemap.current); samArea.restore(originalSamArea.current, currentMap.boundary); }
    setAddingMap(adding);
  };
  const [chatExpanded, setChatExpanded] = useState(true);
  const [mapFocusRequest, setMapFocusRequest] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const scope = useMemo(() => snapshotScope(state, filters.batch), [state, filters.batch]);
  const sessionId = state.sessions.some((s) => s.id === viewSession) ? viewSession : (currentSession(state) ?? state.sessions.at(-1))?.id;
  const allSnapshots = useMemo(
    () => state.items.filter((i) => i.type === "snapshot" && i.snapshot).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [state.items],
  );
  const onMap = (mapPick ?? scope.snapshots.slice(0, 2).map((s) => s.id)).filter((id) => allSnapshots.some((s) => s.id === id));
  const mapSnapshots = currentMap.id === "upm" ? onMap.map((id) => allSnapshots.find((s) => s.id === id)!) : [];
  const sample = hasSampleData(state);
  const unitsInScope = scope.batch ? state.items.some((i) => i.batchId === scope.batch!.id && i.type === "unit") : false;

  useEffect(() => {
    document.title = "Lab";
  }, []);

  useEffect(() => {
    if (addingMap || currentMap.id === "upm" || samArea.drawing || !samArea.polygon) return;
    if (currentMap.boundary && !samePolygon(samArea.defaultPolygon, currentMap.boundary)) samArea.restore(samArea.polygon, currentMap.boundary);
    if (currentMap.boundary && samePolygon(currentMap.area, samArea.polygon)) return;
    const polygon = samArea.polygon;
    apply((saved) => ({ ...saved, maps: saved.maps?.map((map) => map.id === currentMap.id ? { ...map, boundary: map.boundary ?? polygon, area: polygon } : map) }));
  }, [addingMap, currentMap, samArea, apply]);

  const compareA = scope.snapshots.find((s) => s.id === pick.a) ?? scope.snapshots[0];
  const compareB = scope.snapshots.find((s) => s.id === pick.b) ?? scope.snapshots[1];

  const openMap = (id: string, added?: SavedMap) => {
    if (sam.busy) return;
    setAddingMap(false);
    mapAreas.current[currentMap.id] = addingMap ? originalSamArea.current : samArea.polygon;
    const next = added ?? state.maps?.find((map) => map.id === id) ?? UPM_MAP;
    if (next.id !== currentMap.id) {
      samArea.restore(mapAreas.current[next.id] === undefined ? next.area ?? next.boundary ?? null : mapAreas.current[next.id]!, next.boundary);
    }
    setBasemap(next.basemap);
    apply((s) => ({ ...s, activeMapId: next.id, ...(added ? { maps: [...(s.maps ?? []), added] } : {}) }));
    setMapFocusRequest((n) => n + 1);
  };

  const removeMap = (id: string) => {
    if (sam.busy || addingMap) return;
    const index = state.maps?.findIndex((map) => map.id === id) ?? -1;
    const map = state.maps?.[index];
    if (!map) return;
    setDeleteMapId(null);
    const wasActive = currentMap.id === id;
    setDeletedMap({ map, index, wasActive, area: wasActive ? samArea.polygon : mapAreas.current[id] ?? map.area ?? map.boundary ?? null });
    delete mapAreas.current[id];
    if (wasActive) {
      samArea.restore(mapAreas.current.upm ?? null);
      setBasemap(UPM_MAP.basemap);
      setMapFocusRequest((n) => n + 1);
    }
    apply((saved) => deleteSavedMap(saved, id));
  };

  const undoDeleteMap = () => {
    if (!deletedMap || sam.busy || addingMap) return;
    const { map, index, wasActive, area } = deletedMap;
    if (state.maps?.some((entry) => entry.id === map.id)) { setDeletedMap(null); return; }
    if (wasActive) {
      mapAreas.current[currentMap.id] = samArea.polygon;
      samArea.restore(area, map.boundary);
      setBasemap(map.basemap);
      setMapFocusRequest((n) => n + 1);
    }
    mapAreas.current[map.id] = area;
    apply((saved) => { const maps = [...(saved.maps ?? [])]; maps.splice(Math.min(index, maps.length), 0, map); return { ...saved, maps, ...(wasActive ? { activeMapId: map.id } : {}) }; });
    setDeletedMap(null);
  };

  const download = () => {
    const blob = new Blob([exportJson(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lab-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice({ kind: "info", text: "Exported all maps, sessions, batches and items as JSON." });
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const result = importJson(await file.text());
    if (!result.ok) {
      setNotice({ kind: "error", text: `Import refused: ${result.errors.slice(0, 3).join(" ")}` });
      return;
    }
    const nonEmpty = state.items.length + state.sessions.length + state.batches.length + (state.maps?.length ?? 0) > 0;
    if (nonEmpty && !window.confirm("Replace the current Lab data with the imported file?")) return;
    const imported = withDefaultMapAreas(result.state);
    replace(imported);
    setDeletedMap(null);
    setAddingMap(false);
    mapAreas.current = {};
    const importedMap = imported.maps?.find((map) => map.id === imported.activeMapId) ?? UPM_MAP;
    samArea.restore(importedMap.area ?? null, importedMap.boundary);
    setBasemap(importedMap.basemap);
    setMapFocusRequest((n) => n + 1);
    setFilters(noFilters());
    setSelectedId(undefined);
    setViewSession(undefined);
    setNotice({ kind: "info", text: `Imported ${result.state.items.length} items in ${result.state.batches.length} batches.` });
  };

  const goNotes = () => {
    changeAddingMap(false);
    setComparing(false);
    setTab("notes");
  };


  const chat = useMapChat({
    context: () => ({ ...(agentRef.current?.context() ?? { mapId: currentMap.id, mapUnavailable: true }), savedMaps: [UPM_MAP, ...(state.maps ?? [])].map(map => ({ id: map.id, name: map.name })), sidebar: { tab: sidebarTab, expanded: sidebarExpanded }, awaitingDeleteConfirmation: pendingDeleteMap?.name }),
    cancel: () => agentRef.current?.cancel(),
    async execute(raw, signal, model) {
      const call = validateMapAgentCall(raw), p = call.parameters; signal.throwIfAborted();
      if (pendingDeleteMap) throw Error("Complete or cancel the typed map-name deletion dialog first.");
      if (call.action === "open_sidebar") { if (p.tab === "collapse") setSidebarExpanded(false); else openSidebar(p.tab as MapSidebarTab); }
      else if (call.action === "open_map") { if (sam.busy || addingMap) throw Error("Finish the current map operation first."); if (![UPM_MAP, ...(state.maps ?? [])].some(map => map.id === p.id)) throw Error("That saved map does not exist."); openMap(p.id as string); }
      else if (call.action === "add_map") { if (sam.busy || addingMap) throw Error("Finish the current map operation first."); changeAddingMap(true); return "Add map form opened. Waiting for the user to enter a name, location and boundary, then Save map."; }
      else if (call.action === "delete_map") { if (sam.busy || addingMap) throw Error("Finish the current map operation first."); const map = state.maps?.find(map => map.id === p.id); if (!map) throw Error("That map cannot be deleted."); setDeleteMapId(map.id); return `Waiting for the user to type ${map.name} in the existing delete confirmation dialog. No map was deleted.`; }
      else if (call.action === "locate_map") { if (sam.busy || samArea.drawing) throw Error("Finish the current operation first."); if (!mapRef.current?.locate({ center: [p.longitude as number, p.latitude as number], zoom: p.zoom as number })) throw Error("Wait for the map to load."); }
      else { if (!agentRef.current) throw Error("Open the Map view before using map tools."); return agentRef.current.execute(call, signal, model); }
      await new Promise(resolve => setTimeout(resolve, 0)); return "Applied.";
    },
  }, (id, message) => apply(saved => ({ ...saved, sessions: saved.sessions.map(session => session.id === id ? { ...session, messages: session.messages.some(m => m.id === message.id) ? session.messages.map(m => m.id === message.id ? message : m) : [...session.messages, message] } : session) })));

  return (
    <div className="app">
      <header className="top">
        <h1>Lab</h1>
        <span className="subtitle">{currentMap.name} · {currentMap.id === "upm" ? "CHMv2 window" : "Satellite map"}</span>
        {sample && <SampleBadge />}
        <span className="spacer" />
        <div className="data-actions" role="group" aria-label="Data">
          <button type="button" className="btn small" disabled={sample} onClick={() => apply(loadSampleData)} title={sample ? "Sample data is already loaded" : "Add clearly marked sample sessions, batches and items"}>
            Load sample data
          </button>
          <button type="button" className="btn small" onClick={download}>Export JSON</button>
          <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>Import JSON</button>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              if (window.confirm("Delete all Lab data in this browser? Export first if you want to keep it.")) {
                replace(emptyState());
                setDeletedMap(null);
                setAddingMap(false);
                openSidebar("maps");
                mapAreas.current = {};
                samArea.restore(null);
                setBasemap("esri");
                setMapFocusRequest((n) => n + 1);
                setFilters(noFilters());
                setSelectedId(undefined);
              }
            }}
          >
            Reset
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="Import JSON file" onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <span className="readout off" title="SAM and Muse run only when requested">
          <i aria-hidden="true" />
          {chat.busy ? "Muse working" : sam.loadingRunId ? "Loading SAM result" : sam.busy ? "SAM 3.1 running" : sam.configured ? "SAM 3.1 ready" : costReadout()}
        </span>
      </header>

      {notice && (
        <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>{"×"}</button>
        </div>
      )}
      {deletedMap && <div className="notice info" role="status"><span>Deleted “{deletedMap.map.name}”.</span><button type="button" className="btn small" disabled={sam.busy || addingMap} onClick={undoDeleteMap}>Undo delete</button><button type="button" aria-label="Dismiss deletion" onClick={() => setDeletedMap(null)}>×</button></div>}
      {pendingDeleteMap && <DeleteMapDialog key={pendingDeleteMap.id} name={pendingDeleteMap.name} busy={sam.busy || addingMap} onCancel={() => setDeleteMapId(null)} onConfirm={() => removeMap(pendingDeleteMap.id)} />}

      <div className={`layout${chatExpanded ? "" : " chat-collapsed"}`}>
        <main className="main">
          <div className="tabs-row">
            <div className="toggle big" role="tablist" aria-label="View">
              <button type="button" role="tab" aria-selected={tab === "map"} onClick={() => { setTab("map"); setComparing(false); }}>Map</button>
              <button type="button" role="tab" aria-selected={tab === "notes"} onClick={goNotes}>Notes</button>
            </div>
            <span className="summary">
              {comparing
                ? `Comparing snapshot A with snapshot B`
                : tab === "map"
                  ? mapSummary(mapSnapshots, basemap, currentMap)
                  : `Knowledge library · ${state.batches.length} batches · ${state.items.length} items`}
            </span>
          </div>

          <div className="stage">
            {comparing && compareA && compareB ? (
              <CompareView
                snapshots={scope.snapshots}
                a={compareA.id}
                b={compareB.id}
                onPick={(side, id) => setPick((p) => ({ ...p, [side]: id }))}
                onClose={() => setComparing(false)}
              />
            ) : tab === "map" ? (
              <div className={`map-layout${sidebarExpanded ? "" : " sidebar-collapsed"}`}>
                <MapSidebar active={sidebarTab} expanded={sidebarExpanded} onOpen={openSidebar} onCollapse={() => setSidebarExpanded(false)} layerHost={setLayerHost} maps={<SavedMaps view={addMapView} onDelete={setDeleteMapId} area={samArea} adding={addingMap} onAddingChange={changeAddingMap} basemap={basemap} onBasemap={setBasemap} state={state} snapshots={allSnapshots} active={onMap} currentMapId={currentMap.id} busy={sam.busy || chat.busy} onOpenMap={openMap} onLocate={(location) => !sam.busy && (mapRef.current?.locate(location) ?? false)} onGetView={() => { const view = mapRef.current?.getView(); return view ? { ...view, basemap, ...(samArea.polygon ? { area: samArea.polygon } : {}) } : null; }} onAdd={(map) => openMap(map.id, map)} onToggle={(id) => setMapPick(onMap.includes(id) ? onMap.filter((x) => x !== id) : [...onMap, id].slice(-2))} />} />
                <MapView agentRef={agentRef} agentModel={chat.model} layerHost={layerHost} legendHidden={addingMap} onOpenLayers={() => openSidebar("layers")} key={currentMap.id} savedMap={currentMap} mapRef={mapRef} snapshots={mapSnapshots} shown={shown} focusRequest={mapFocusRequest} basemap={basemap} onBasemap={(value) => { setBasemap(value); if (!addingMap && currentMap.id !== "upm") apply((s) => ({ ...s, maps: s.maps?.map((map) => map.id === currentMap.id ? { ...map, basemap: value } : map) })); }} sam={sam} samArea={samArea} onToggle={(i) => setShown((s) => s.map((v, k) => (k === i ? !v : v)))} />
              </div>
            ) : (
              <NotesView
                state={state}
                filters={filters}
                setFilters={setFilters}
                sort={sort}
                setSort={setSort}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onNewBatch={(input) => {
                  const out = run((s) => addBatch(s, input));
                  if (out) setFilters((f) => ({ ...f, batch: out.batch.id }));
                }}
                onReview={(id, review) => apply((s) => setReview(s, id, review))}
                onLoadSample={() => apply(loadSampleData)}
              />
            )}
          </div>

          <Snapshots
            batch={scope.batch}
            snapshots={scope.snapshots}
            canRegister={unitsInScope}
            selectedId={tab === "notes" ? selectedId : undefined}
            onSelect={(id) => {
              setSelectedId(id);
              if (tab === "map") setTab("notes");
              setComparing(false);
            }}
            onRegister={() => {
              if (!scope.batch) return;
              const title = `Units as of ${formatDateTime(new Date().toISOString())}`;
              const out = run((s) => registerSnapshot(s, scope.batch!.id, title));
              if (out) {
                setNotice({ kind: "info", text: `Registered snapshot ${out.item.snapshot?.hash} in ${scope.batch.name}.` });
                setSelectedId(out.item.id);
              }
            }}
            onCompare={() => {
              changeAddingMap(false);
              setPick({});
              setComparing(true);
            }}
          />
        </main>

        <ChatPanel
          agent={chat}
          state={state}
          sessionId={sessionId}
          expanded={chatExpanded}
          onToggleExpanded={() => setChatExpanded((expanded) => !expanded)}
          onSelect={setViewSession}
          onNewSession={() => {
            const out = run((s) => newSession(s, currentSession(s)?.mode ?? "take-notes"));
            if (out) setViewSession(out.session.id);
          }}
          onMode={(id, mode) => apply((s) => setSessionMode(s, id, mode))}
          onSend={(id, text, useAgent) => { const session = state.sessions.find(s => s.id === id); if (!session || session.endedAt || chat.busy) return; apply(s => sendMessage(s, id, text)); if (useAgent) void chat.send(session, text); }}
          onSave={(input) => {
            const out = run((s) => saveMessageToNotes(s, input));
            if (out) setNotice({ kind: "info", text: `Saved to ${state.batches.find((b) => b.id === out.item.batchId)?.name ?? out.state.batches.find((b) => b.id === out.item.batchId)?.name}.` });
          }}
        />
      </div>
    </div>
  );
}
