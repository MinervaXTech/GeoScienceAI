import { useEffect, useMemo, useRef, useState } from "react";
import { costReadout } from "../domain/config";
import { exportJson, importJson } from "../domain/persistence";
import { noFilters, type Filters, type Sort } from "../domain/query";
import { hasSampleData, loadSampleData } from "../domain/sample";
import { addBatch, currentSession, newSession, registerSnapshot, saveMessageToNotes, sendMessage, setReview, setSessionMode } from "../domain/store";
import { emptyState } from "../domain/types";
import { SampleBadge } from "./Badges";
import { ChatPanel } from "./ChatPanel";
import { CompareView } from "./CompareView";
import { formatDateTime } from "./format";
import { MapView, mapSummary } from "./MapView";
import { NotesView } from "./NotesView";
import { SavedMaps } from "./SavedMaps";
import { Snapshots } from "./Snapshots";
import { snapshotScope } from "./snapshotScope";
import { useLab } from "./useLab";

type Tab = "map" | "notes";

export function App() {
  const { state, apply, run, replace, notice, setNotice } = useLab();
  const [tab, setTab] = useState<Tab>("map");
  const [comparing, setComparing] = useState(false);
  const [filters, setFilters] = useState<Filters>(noFilters());
  const [sort, setSort] = useState<Sort | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [viewSession, setViewSession] = useState<string | undefined>();
  const [shown, setShown] = useState([true, true]);
  const [pick, setPick] = useState<{ a?: string; b?: string }>({});
  const [mapPick, setMapPick] = useState<string[] | undefined>();
  const [savedMapsExpanded, setSavedMapsExpanded] = useState(true);
  const [mapFocusRequest, setMapFocusRequest] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const scope = useMemo(() => snapshotScope(state, filters.batch), [state, filters.batch]);
  const sessionId = state.sessions.some((s) => s.id === viewSession) ? viewSession : (currentSession(state) ?? state.sessions.at(-1))?.id;
  const allSnapshots = useMemo(
    () => state.items.filter((i) => i.type === "snapshot" && i.snapshot).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [state.items],
  );
  const onMap = (mapPick ?? scope.snapshots.slice(0, 2).map((s) => s.id)).filter((id) => allSnapshots.some((s) => s.id === id));
  const mapSnapshots = onMap.map((id) => allSnapshots.find((s) => s.id === id)!);
  const sample = hasSampleData(state);
  const unitsInScope = scope.batch ? state.items.some((i) => i.batchId === scope.batch!.id && i.type === "unit") : false;

  useEffect(() => {
    document.title = "Lab";
  }, []);

  const compareA = scope.snapshots.find((s) => s.id === pick.a) ?? scope.snapshots[0];
  const compareB = scope.snapshots.find((s) => s.id === pick.b) ?? scope.snapshots[1];

  const download = () => {
    const blob = new Blob([exportJson(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lab-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice({ kind: "info", text: "Exported all sessions, batches and items as JSON." });
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const result = importJson(await file.text());
    if (!result.ok) {
      setNotice({ kind: "error", text: `Import refused: ${result.errors.slice(0, 3).join(" ")}` });
      return;
    }
    const nonEmpty = state.items.length + state.sessions.length + state.batches.length > 0;
    if (nonEmpty && !window.confirm("Replace the current Lab data with the imported file?")) return;
    replace(result.state);
    setFilters(noFilters());
    setSelectedId(undefined);
    setViewSession(undefined);
    setNotice({ kind: "info", text: `Imported ${result.state.items.length} items in ${result.state.batches.length} batches.` });
  };

  const goNotes = () => {
    setComparing(false);
    setTab("notes");
  };

  return (
    <div className="app">
      <header className="top">
        <h1>Lab</h1>
        <span className="subtitle">UPM, Selangor · CHMv2 window</span>
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
                setFilters(noFilters());
                setSelectedId(undefined);
              }
            }}
          >
            Reset
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="Import JSON file" onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <span className="readout off" title="Live model calls are prepared but disabled in this phase">
          <i aria-hidden="true" />
          {costReadout()}
        </span>
      </header>

      {notice && (
        <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>{"×"}</button>
        </div>
      )}

      <div className="layout">
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
                  ? mapSummary(mapSnapshots)
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
              <div className={`map-layout${savedMapsExpanded ? "" : " saved-maps-collapsed"}`}>
                <SavedMaps state={state} snapshots={allSnapshots} active={onMap} expanded={savedMapsExpanded} onToggleExpanded={() => setSavedMapsExpanded((expanded) => !expanded)} onOpenUpm={() => setMapFocusRequest((n) => n + 1)} onToggle={(id) => setMapPick(onMap.includes(id) ? onMap.filter((x) => x !== id) : [...onMap, id].slice(-2))} />
                <MapView snapshots={mapSnapshots} shown={shown} focusRequest={mapFocusRequest} onToggle={(i) => setShown((s) => s.map((v, k) => (k === i ? !v : v)))} />
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
              setPick({});
              setComparing(true);
            }}
          />
        </main>

        <ChatPanel
          state={state}
          sessionId={sessionId}
          onSelect={setViewSession}
          onNewSession={() => {
            const out = run((s) => newSession(s, currentSession(s)?.mode ?? "take-notes"));
            if (out) setViewSession(out.session.id);
          }}
          onMode={(id, mode) => apply((s) => setSessionMode(s, id, mode))}
          onSend={(id, text) => apply((s) => sendMessage(s, id, text))}
          onSave={(input) => {
            const out = run((s) => saveMessageToNotes(s, input));
            if (out) setNotice({ kind: "info", text: `Saved to ${state.batches.find((b) => b.id === out.item.batchId)?.name ?? out.state.batches.find((b) => b.id === out.item.batchId)?.name}.` });
          }}
        />
      </div>
    </div>
  );
}
