import { conceptKey } from "./knowledgeExtract.ts";
interface GraphNode { id: string; label: string; type: string; description?: string; paper_id?: string }
interface GraphLink { source: string; target: string; relation: string; confidence?: string; quote?: string; section?: string }
export interface OverviewPaper { id: string; title: string; paperType?: string; year?: number; doi?: string; graph: { nodes: GraphNode[]; links: GraphLink[] } }
const PER_TYPE = 8, KEY_LINKS = 10, MAX_PAPERS = 12;
const TYPE_ORDER = ["claim", "method", "dataset", "metric", "result", "limitation", "parameter", "concept", "step", "equation"];
const COMPARISON = /contradict|outperform|improves_on|compares_to|identifies_gap/i;
const cut = (value: string | undefined, max: number) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
/** A compact, read-only digest of stored papers for writing a literature review: what each says, what several share, and where they compare or disagree. Built from the saved graphs, with no model call. */
export function paperOverview(papers: OverviewPaper[]) {
  const chosen = [...papers].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title)).slice(0, MAX_PAPERS);
  const digest = chosen.map(p => {
    const byId = new Map(p.graph.nodes.map(n => [n.id, n])), label = (id: string) => byId.get(id)?.label ?? id;
    const groups: Record<string, { label: string; description: string }[]> = {};
    for (const type of TYPE_ORDER) { const nodes = p.graph.nodes.filter(n => n.type === type).slice(0, PER_TYPE); if (nodes.length) groups[type] = nodes.map(n => ({ label: cut(n.label, 120), description: cut(n.description, 180) })); }
    const links = p.graph.links.filter(l => l.quote || COMPARISON.test(l.relation)).slice(0, KEY_LINKS).map(l => ({ from: cut(label(l.source), 80), relation: cut(l.relation, 60), to: cut(label(l.target), 80), classification: l.confidence ?? "INFERRED", ...(l.quote ? { quote: cut(l.quote, 200) } : {}), ...(l.section ? { section: cut(l.section, 60) } : {}) }));
    return { id: p.id, title: p.title, ...(p.paperType ? { paperType: p.paperType } : {}), ...(p.year ? { year: p.year } : {}), ...(p.doi ? { doi: p.doi } : {}), nodes: p.graph.nodes.length, links: p.graph.links.length, byType: groups, keyLinks: links };
  });
  const seen = new Map<string, { label: string; type: string; papers: Set<string> }>();
  for (const p of chosen) for (const n of p.graph.nodes) { if (["step", "equation", "parameter"].includes(n.type)) continue; const key = conceptKey(n), at = seen.get(key) ?? { label: n.label, type: n.type, papers: new Set<string>() }; at.papers.add(p.title); seen.set(key, at); }
  const shared = [...seen.values()].filter(c => c.papers.size > 1).sort((a, b) => b.papers.size - a.papers.size).slice(0, 30).map(c => ({ label: cut(c.label, 100), type: c.type, papers: [...c.papers] }));
  const comparisons = chosen.flatMap(p => { const byId = new Map(p.graph.nodes.map(n => [n.id, n])); return p.graph.links.filter(l => COMPARISON.test(l.relation)).slice(0, 5).map(l => ({ paper: p.title, from: cut(byId.get(l.source)?.label, 80), relation: cut(l.relation, 60), to: cut(byId.get(l.target)?.label, 80), classification: l.confidence ?? "INFERRED", ...(l.quote ? { quote: cut(l.quote, 200) } : {}) })); }).slice(0, 15);
  return { status: digest.length ? "overview" : "no_match", papers: digest, sharedConcepts: shared, comparisons, ...(papers.length > MAX_PAPERS ? { omitted: papers.length - MAX_PAPERS, note: `Only the ${MAX_PAPERS} earliest papers are included; ask for a narrower collection.` } : {}) };
}
