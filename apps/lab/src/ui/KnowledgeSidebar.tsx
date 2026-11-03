import { useCallback, useEffect, useState } from "react";
import { inCollection, type KnowledgeEntry } from "../domain/knowledge";
export function KnowledgeSidebar() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]), [error, setError] = useState(""), [deleting, setDeleting] = useState<string | null>(null), [busy, setBusy] = useState(false), [filter, setFilter] = useState(""), [adding, setAdding] = useState<{ id: string; name: string } | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { const response = await fetch("/api/knowledge", { signal }); const data = await response.json(); if (!response.ok || !Array.isArray(data.entries)) throw Error(data.error ?? "Knowledge list unavailable."); if (!signal?.aborted) { setEntries(data.entries); setError(""); } }
    catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Knowledge list unavailable."); }
  }, []);
  useEffect(() => { const controller = new AbortController(); const changed = () => { void refresh(controller.signal); }; changed(); window.addEventListener("lab-knowledge-changed", changed); return () => { controller.abort(); window.removeEventListener("lab-knowledge-changed", changed); }; }, [refresh]);
  const names = [...new Set(entries.flatMap(e => e.collections ?? []))].sort((a, b) => a.localeCompare(b));
  const shown = entries.filter(e => inCollection(e, filter || undefined));
  const setCollections = async (entry: KnowledgeEntry, collections: string[]) => {
    if (busy) return; setBusy(true); setError("");
    try { const response = await fetch("/api/knowledge/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: entry.id, collections }) }); const data = await response.json(); if (!response.ok) throw Error(data.error ?? "Collections could not be changed."); setAdding(null); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Collections could not be changed."); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (busy) return; setBusy(true); setError("");
    try { const response = await fetch(`/api/knowledge/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) }); const data = await response.json(); if (!response.ok) throw Error(data.error ?? "Paper deletion failed."); setDeleting(null); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Paper deletion failed."); } finally { setBusy(false); }
  };
  return <section className="knowledge-sidebar" aria-label="Paper knowledge base"><p className="hint">Attach a PDF, share an arXiv/DOI link or paste paper text in chat. Confirm its offer to let Muse learn it.</p>
    <button className="btn small" disabled={busy} onClick={() => { void refresh(); }}>Refresh papers</button>
    {names.length > 0 && <label className="collection-filter">Collection<select aria-label="Filter by collection" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All papers ({entries.length})</option>{names.map(name => <option key={name} value={name}>{name} ({entries.filter(e => inCollection(e, name)).length})</option>)}</select></label>}
    {!entries.length && <p className="empty">No stored papers yet.</p>}
    {entries.length > 0 && !shown.length && <p className="empty">No papers in this collection.</p>}
    <ul>{shown.map(entry => <li key={entry.id}><strong>{entry.title}</strong><p className="hint">{[entry.paperType && entry.paperType !== "other" ? `${entry.paperType} paper` : null, entry.year, entry.doi && `DOI ${entry.doi}`].filter(Boolean).join(" · ")}</p><p className="hint">{entry.status} · {entry.models.join(", ")}</p>{entry.error && <p className="sam-error">{entry.error}</p>}{entry.status === "stored" && <div className="collection-tags" aria-label="Collections">{(entry.collections ?? []).map(name => <span className="tag" key={name}>{name}<button type="button" className="collection-remove" aria-label={`Remove ${entry.title} from ${name}`} disabled={busy} onClick={() => { void setCollections(entry, (entry.collections ?? []).filter(c => c !== name)); }}>{"×"}</button></span>)}
        {adding?.id === entry.id ? <form onSubmit={e => { e.preventDefault(); if (adding.name.trim()) void setCollections(entry, [...(entry.collections ?? []), adding.name]); }}><input aria-label="Collection name" list="knowledge-collections" maxLength={60} autoFocus value={adding.name} onChange={e => setAdding({ id: entry.id, name: e.target.value })} placeholder="Collection name" /><button type="submit" className="btn small" disabled={busy || !adding.name.trim()}>Add</button><button type="button" className="btn small" onClick={() => setAdding(null)}>Cancel</button></form> : <button type="button" className="btn small" disabled={busy} onClick={() => setAdding({ id: entry.id, name: "" })}>+ Collection</button>}</div>}{entry.status === "stored" && <a href={`/api/knowledge/${entry.id}/graph.html`} target="_blank" rel="noreferrer">Open graph</a>}
      {deleting === entry.id ? <div><p>Delete this paper and its graph from the knowledge base?</p><div className="session-action-buttons"><button className="btn small" disabled={busy} onClick={() => { void remove(entry.id); }}>Delete paper</button><button className="btn small" disabled={busy} onClick={() => setDeleting(null)}>Cancel</button></div></div> : <button className="btn small" disabled={busy} onClick={() => setDeleting(entry.id)}>Delete</button>}</li>)}</ul>
    <datalist id="knowledge-collections">{names.map(name => <option key={name} value={name} />)}</datalist>
    {error && <p className="sam-error" role="alert">{error}</p>}
  </section>;
}
