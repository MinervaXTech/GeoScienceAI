import { useEffect, useRef, useState } from "react";
import type { PlaceResult } from "../geo/places";

interface Props {
  selected: PlaceResult | null;
  onSelect(place: PlaceResult): void;
  onClear(): void;
}

export function PlaceSearch({ selected, onSelect, onClear }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const search = async () => {
    if (loading || query.trim().length < 2) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true); setError(""); setResults(null); onClear();
    try {
      const response = await fetch(`/api/geocode/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw Error(data.error || "Place search failed.");
      if (!Array.isArray(data.places)) throw Error("Invalid place search response.");
      setResults(data.places);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Place search failed.");
    } finally {
      if (pending.current === controller) { pending.current = null; setLoading(false); }
    }
  };
  return <section className="place-search" aria-label="Place search">
    <label>Search place<input autoFocus type="search" maxLength={160} placeholder="e.g. Kluang, Johor" value={query} onChange={(event) => {
      pending.current?.abort(); pending.current = null; setLoading(false); setError(""); setResults(null); onClear(); setQuery(event.target.value);
    }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} /></label>
    <button type="button" className="btn" disabled={loading || query.trim().length < 2} onClick={() => { void search(); }}>{loading ? "Searching…" : "Search"}</button>
    {loading && <p className="hint" role="status">Finding places…</p>}
    {error && <p className="hint" role="alert">{error}</p>}
    {results?.length === 0 && <p className="hint" role="status">No places found. Try adding a state or country.</p>}
    {!!results?.length && <ul className="place-results" aria-label="Place search results">{results.map((place) => <li key={place.id}><button type="button" aria-pressed={selected?.id === place.id} onClick={() => onSelect(place)}>
      <strong>{place.name} <small>· {place.kind.replaceAll("_", " ")}</small></strong><span>{place.label}</span>
    </button></li>)}</ul>}
    {selected && <p className="hint" role="status">Map moved to {selected.label}. Zoom or pan to adjust, then save.</p>}
    <p className="hint place-credit">Search by <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">Photon</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></p>
  </section>;
}
