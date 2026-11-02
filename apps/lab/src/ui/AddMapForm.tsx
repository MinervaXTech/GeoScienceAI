import { useRef, useState } from "react";
import type { SavedMap } from "../domain/types";
import { savedMapError } from "../domain/maps";
import type { MapLocation, PlaceResult } from "../geo/places";
import { PlaceSearch } from "./PlaceSearch";
import type { Polygon } from "geojson";

interface Props {
  view: Omit<SavedMap, "id" | "name"> | null;
  basemap: SavedMap["basemap"];
  onBasemap(value: SavedMap["basemap"]): void;
  onLocate(location: MapLocation): boolean;
  onReadView?(): MapLocation | null;
  area: Polygon | null;
  drawing: boolean;
  onDrawArea(): void;
  onResetArea(): void;
  onSave(map: SavedMap): void;
  onCancel(): void;
}

export function AddMapForm({ view, basemap, onBasemap, onLocate, onReadView, area, drawing, onDrawArea, onResetArea, onSave, onCancel }: Props) {
  const [source, setSource] = useState("search");
  const [selected, setSelected] = useState<PlaceResult | null>(null);
  const autoName = useRef("");
  const previewed = useRef(false);
  const [name, setName] = useState("");
  const [latitude, setLatitude] = useState(String(view?.center[1] ?? ""));
  const [longitude, setLongitude] = useState(String(view?.center[0] ?? ""));
  const [zoom, setZoom] = useState(String(view?.zoom.toFixed(2) ?? 18));
  const [error, setError] = useState("");
  return <form className="add-map-form" aria-label="Add map" onSubmit={(event) => {
    event.preventDefault();
    if (source === "search" && !selected) { setError("Search for a place and choose a result first."); return; }
    if (!area || drawing) { setError("Draw and finish the map boundary before saving."); return; }
    const currentView = onReadView?.();
    if (source !== "coordinates" && onReadView && !currentView) { setError("Wait for the map to load before saving this view."); return; }
    const location = source === "search" ? currentView ?? selected! : source === "view" ? currentView ?? view : { center: [Number(longitude), Number(latitude)] as [number, number], zoom: Number(zoom) };
    if (!location) { setError("Wait for the map to load or enter coordinates."); return; }
    const map: SavedMap = {
      id: `map-${crypto.randomUUID()}`, name: name.trim(), basemap,
      center: location.center, zoom: location.zoom,
      boundary: area, area,
    };
    const message = savedMapError(map);
    if (message) { setError(message); return; }
    onSave(map);
  }}>
    <h3>Add map</h3>
    <label>Map name<input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Field B" /></label>
    <label>Location<select aria-label="Location" value={source} onChange={(e) => { setSource(e.target.value); if (e.target.value === "coordinates") onResetArea(); }}>
      <option value="search">Search place</option>
      <option value="view" disabled={!view}>Current map view</option>
      <option value="coordinates">Coordinates</option>
    </select></label>
    {source === "search" ? <PlaceSearch selected={selected} onClear={() => { setSelected(null); setError(""); }} onSelect={(place) => {
      if (!onLocate(place)) { setError("Wait for the map to load, then choose the place again."); return; }
      onResetArea();
      previewed.current = true; setSelected(place); setError("");
      const nextName = place.name.slice(0, 80);
      const previousAutoName = autoName.current;
      setName((current) => !current || current === previousAutoName ? nextName : current);
      autoName.current = nextName;
    }} /> : source === "view" ? <p className="hint">Saves the current centre, zoom{!previewed.current && view?.area ? " and selected polygon" : ""}.</p> : <>
      <label>Latitude<input type="number" required min={-85} max={85} step="any" value={latitude} onChange={(e) => { setLatitude(e.target.value); onResetArea(); }} /></label>
      <label>Longitude<input type="number" required min={-180} max={180} step="any" value={longitude} onChange={(e) => { setLongitude(e.target.value); onResetArea(); }} /></label>
      <label>Zoom<input type="number" required min={2} max={22} step="any" value={zoom} onChange={(e) => { setZoom(e.target.value); onResetArea(); }} /></label>
    </>}
    <label>Satellite basemap<select aria-label="Satellite basemap" value={basemap} onChange={(e) => onBasemap(e.target.value as SavedMap["basemap"])}><option value="esri">Esri World Imagery</option><option value="google">Google satellite</option></select></label>
    <button type="button" className="btn" onClick={() => {
      if (source === "coordinates") {
        const center: [number, number] = [Number(longitude), Number(latitude)];
        const level = Number(zoom);
        if (!longitude || !latitude || !Number.isFinite(center[0]) || !Number.isFinite(center[1]) || Math.abs(center[0]) > 180 || Math.abs(center[1]) > 85 || !Number.isFinite(level) || level < 2 || level > 22) { setError("Enter valid coordinates and a zoom from 2 to 22."); return; }
        if (!onLocate({ center, zoom: level })) { setError("Wait for the map to load, then draw the boundary."); return; }
      }
      setError(""); onDrawArea();
    }}>{drawing ? "Restart map boundary" : area ? "Redraw map boundary" : "Draw map boundary"}</button>
    <p className="hint">{drawing ? "Click corners on the map, then right-click to finish." : area ? `Boundary ready · ${area.coordinates[0]!.length - 1} corners. This shape will be the default SAM area.` : "Draw the boundary to save this map. You can select a smaller SAM region afterward."}</p>
    {error && <p role="alert">{error}</p>}
    <div className="add-map-actions"><button className="btn primary" type="submit" disabled={!area || drawing || (source === "search" && !selected)}>Save map</button><button className="btn" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}
