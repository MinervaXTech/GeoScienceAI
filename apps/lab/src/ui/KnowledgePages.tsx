import { useCallback, useEffect, useRef, useState } from "react";
import { ChatMarkdown } from "./ChatMarkdown";
import { formatDateTime } from "./format";

interface WikiPageInfo { path: string; title: string; group: "overview" | "papers" | "replications" | "explorations" | "workshops"; modified: string }
const GROUPS: { id: WikiPageInfo["group"]; label: string }[] = [{ id: "overview", label: "Overview" }, { id: "papers", label: "Papers" }, { id: "replications", label: "Replications" }, { id: "explorations", label: "Explorations" }, { id: "workshops", label: "Workshops" }];
const PAGE_PATH = /^(?:(?:index|log)\.md|(?:papers|replications|explorations|workshops)\/[A-Za-z0-9_-]+\.md)$/;
const api = async (path: string) => { const response = await fetch(path); const data = await response.json(); if (!response.ok) throw Error(data.error ?? "The request failed."); return data; };
/** Where a relative link in a wiki page leads, as a path inside the wiki, or null when it is not a page of the wiki. */
export const wikiTarget = (from: string, href: string): string | null => { if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return null; try { const path = decodeURIComponent(new URL(href, `http://wiki.local/${from}`).pathname.slice(1)); return PAGE_PATH.test(path) ? path : null; } catch { return null; } };

/** A full page for the wiki: the pages the app wrote from what you finished, read in place, with the links between them working. */
export function WikiPage({ onClose, every = 10000 }: { onClose(): void; every?: number }) {
  const [pages, setPages] = useState<WikiPageInfo[] | null>(null), [folder, setFolder] = useState(""), [path, setPath] = useState("index.md"), [content, setContent] = useState<string | null>(null), [error, setError] = useState("");
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const loadList = useCallback(async () => { try { const d = await api("/api/wiki/pages"); if (alive.current) { setPages(d.pages); setFolder(d.folder); setError(""); } } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "The wiki is unavailable."); } }, []);
  useEffect(() => { void loadList(); const timer = setInterval(() => { void loadList(); }, every); return () => clearInterval(timer); }, [loadList, every]);
  const stamp = pages?.find(p => p.path === path)?.modified;
  useEffect(() => { if (!pages?.length) return; if (!pages.some(p => p.path === path)) { setPath(pages[0]!.path); return; } let live = true; void api(`/api/wiki/page?path=${encodeURIComponent(path)}`).then(d => { if (live && alive.current) setContent(d.content); }).catch(e => { if (live && alive.current) setError(e instanceof Error ? e.message : "Could not read that page."); }); return () => { live = false; }; }, [path, stamp, pages?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (e: React.MouseEvent) => { const a = (e.target as HTMLElement).closest("a"); if (!a) return; const target = wikiTarget(path, a.getAttribute("href") ?? ""); if (target) { e.preventDefault(); setPath(target); } };
  const body = content?.replace(/^---\n[\s\S]*?\n---\n/, "") ?? "";
  return <div className="kpage" role="region" aria-label="WikiLLM">
    <header className="kpage-bar"><div><h2>WikiLLM</h2><p className="hint">Pages the app wrote from what you finished, as plain markdown. {pages ? `${pages.length} page${pages.length === 1 ? "" : "s"}.` : ""}{folder ? ` Folder: ${folder}` : ""}</p></div><button type="button" className="btn small" onClick={onClose}>Close</button></header>
    {error && <p className="sam-error" role="alert">{error}</p>}
    {pages && !pages.length ? <p className="empty kpage-empty">Nothing in the wiki yet. A finished replication, exploration or workshop is added by itself once it has been quiet for a while, or you can save one with its Save to wiki button.</p> : <div className="kpage-body">
      <nav className="kpage-nav" aria-label="Wiki pages">{GROUPS.map(g => { const list = (pages ?? []).filter(p => p.group === g.id); return list.length ? <div key={g.id}><h3>{g.label}</h3><ul>{list.map(p => <li key={p.path}><button type="button" className={`kpage-link${p.path === path ? " selected" : ""}`} aria-current={p.path === path ? "page" : undefined} onClick={() => setPath(p.path)}>{p.title}</button></li>)}</ul></div> : null; })}</nav>
      <article className="kpage-doc" onClick={open} aria-label={pages?.find(p => p.path === path)?.title ?? "Page"}>{content === null ? <p className="empty">Opening the page…</p> : <ChatMarkdown text={body} />}{stamp && <p className="hint kpage-foot">{path} · written {formatDateTime(stamp)}</p>}</article>
    </div>}
  </div>;
}

interface Entry { id: string; status: string; origin?: { kind: string } }
/** A full page for the knowledge graph: every paper and every entry the app made, drawn as one graph. */
export function GraphPage({ onClose }: { onClose(): void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null), [size, setSize] = useState<{ nodes: number; edges: number } | null>(null), [error, setError] = useState(""), [drawn, setDrawn] = useState(false), [stamp, setStamp] = useState(() => Date.now());
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    try {
      const d = await api("/api/knowledge"); if (!alive.current) return; setEntries(d.entries);
      if ((d.entries as Entry[]).some(e => e.status === "stored")) { try { const g = await api("/api/knowledge/merged-graph/graph.json"); if (alive.current) setSize({ nodes: (g.nodes ?? []).length, edges: (g.links ?? g.edges ?? []).length }); } catch { /* the counts are a convenience */ } }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "The knowledge base is unavailable."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const stored = (entries ?? []).filter(e => e.status === "stored"), made = stored.filter(e => e.origin).length, src = `/api/knowledge/merged-graph/graph.html?v=${stamp}`;
  return <div className="kpage" role="region" aria-label="Knowledge graph">
    <header className="kpage-bar"><div><h2>Knowledge graph</h2><p className="hint">{entries === null ? "Reading the knowledge base…" : `${stored.length} entr${stored.length === 1 ? "y" : "ies"}: ${stored.length - made} paper${stored.length - made === 1 ? "" : "s"}, ${made} made by the app from a finished item.${size ? ` ${size.nodes} nodes and ${size.edges} edges.` : ""}`} The drawing library loads from unpkg.com, so this page needs an internet connection.</p></div>
      <div className="session-action-buttons">{stored.length > 0 && <><button type="button" className="btn small" onClick={() => { setDrawn(false); setStamp(Date.now()); void load(); }}>Refresh</button><a className="btn small" href={src} target="_blank" rel="noreferrer noopener">Open in a new tab</a></>}<button type="button" className="btn small" onClick={onClose}>Close</button></div></header>
    {error && <p className="sam-error" role="alert">{error}</p>}
    {entries !== null && !stored.length ? <p className="empty kpage-empty">The knowledge graph is empty. Store a paper in the Papers tab, or let a finished item be added.</p> : entries !== null && <div className="kpage-graph">
      {!drawn && <p className="hint kpage-wait" role="status">Preparing the graph. The first time can take a few seconds.</p>}
      <iframe key={stamp} title="Knowledge graph" src={src} sandbox="allow-scripts" onLoad={() => setDrawn(true)} />
    </div>}
  </div>;
}
