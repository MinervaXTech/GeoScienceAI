export interface Passage { from: number; to: number; text: string; page?: number; pages?: [number, number] }
const PAGE_BREAK = "\f";
const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "what", "how", "are", "does", "its", "paper", "about", "into", "all", "give", "show", "tell", "full", "exact"]);
const WINDOW = 1400, STEP = 900;
const heading = (line: string) => /^(?:\d+(?:\.\d+)*\.?\s+)?[A-Z][A-Za-z0-9 ,:&()/-]{2,70}$/.test(line.trim()) && !/[.!?]$/.test(line.trim());
/** Search terms from a request, including "equation 3" as the literal "(3)" PDF text uses. */
export function queryTerms(query: string): { words: string[]; literals: string[] } {
  const lower = query.toLowerCase(), literals = [...lower.matchAll(/(?:equation|eq\.?|formula)\s*\(?(\d{1,3})\)?|\((\d{1,3})\)/g)].map(m => `(${m[1] ?? m[2]})`);
  const words = [...new Set(lower.split(/[^\p{L}\p{N}]+/u).filter(w => (w.length > 2 || /^\p{N}+$/u.test(w)) && !STOP.has(w) && !/^\d+$/.test(w)))];
  return { words, literals: [...new Set(literals)] };
}
/** The best-matching passages of a paper's saved text for a section name or keywords, in reading order. Returns exact text with character offsets, never a summary. */
export function findPassages(text: string, query: string, maxChars = 6000): Passage[] {
  const range = sectionRange(text, query, maxChars);
  if (range && range.to > range.from) return withPages(text, [{ from: range.from, to: range.to, text: text.slice(range.from, range.to) }], [], new Map(), []);
  const { words, literals } = queryTerms(query);
  if (!words.length && !literals.length) return [];
  const lineStarts: number[] = []; let at = 0; for (const line of text.split("\n")) { lineStarts.push(at); at += line.length + 1; }
  const raw: { from: number; to: number; body: string; lower: string; firstLine: string }[] = [];
  for (let from = 0; from < text.length; from += STEP) {
    const start = lineStarts.find(s => s >= from) ?? from, to = Math.min(text.length, start + WINDOW);
    if (raw.at(-1)?.from === start) continue;
    const body = text.slice(start, to); raw.push({ from: start, to, body, lower: body.toLowerCase(), firstLine: body.split("\n", 1)[0] ?? "" });
    if (to >= text.length) break;
  }
  // Rare terms count more: a word in most windows (like "ants" in an ACO paper) says little about where to look.
  const weight = new Map(words.map(w => [w, Math.log(1 + raw.length / (1 + raw.filter(r => r.lower.includes(w)).length))]));
  const windows: { from: number; to: number; score: number }[] = [];
  for (const r of raw) {
    let score = 0, hit = 0;
    for (const w of words) { const n = r.lower.split(w).length - 1; if (n) { hit++; score += weight.get(w)! * (1 + Math.min(n - 1, 3) * 0.3); } }
    if (words.length > 1) score *= 0.5 + hit / words.length;
    for (const l of literals) if (r.body.includes(l)) score += 3;
    if (words.length > 1 && r.lower.includes(words.join(" "))) score += 2;
    if (score && heading(r.firstLine) && words.some(w => r.firstLine.toLowerCase().includes(w))) score += 2;
    if (score) windows.push({ from: r.from, to: r.to, score });
  }
  const chosen: typeof windows = []; let used = 0;
  for (const w of [...windows].sort((a, b) => b.score - a.score || a.from - b.from)) {
    if (chosen.some(c => w.from < c.to && c.from < w.to)) continue;
    if (used + (w.to - w.from) > maxChars && chosen.length) continue;
    chosen.push(w); used += w.to - w.from; if (used >= maxChars) break;
  }
  const merged: Passage[] = [];
  for (const w of chosen.sort((a, b) => a.from - b.from)) { const last = merged.at(-1); if (last && w.from <= last.to) { last.to = Math.max(last.to, w.to); last.text = text.slice(last.from, last.to); } else merged.push({ from: w.from, to: w.to, text: text.slice(w.from, w.to) }); }
  return withPages(text, merged, words, weight, literals);
}

/** Adds `page` and `pages` to passages when the saved text has page breaks. */
function withPages(text: string, merged: Passage[], words: string[], weight: Map<string, number>, literals: string[]): Passage[] {
  // Saved PDF text separates pages with a form feed. A passage can span two pages, so `page` is where its best match sits (a literal like "(3)", else its rarest search word) and `pages` gives the full span. Older saved text has no breaks, so no page is reported.
  if (text.includes(PAGE_BREAK)) {
    const breaks: number[] = []; for (let k = text.indexOf(PAGE_BREAK); k !== -1; k = text.indexOf(PAGE_BREAK, k + 1)) breaks.push(k);
    const pageAt = (offset: number) => breaks.filter(b => b < offset).length + 1;
    const rare = [...words].sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0));
    for (const m of merged) {
      const lower = m.text.toLowerCase(), anchors = [...literals.map(l => m.text.indexOf(l)), ...rare.map(w => lower.indexOf(w))].filter(at => at >= 0);
      m.page = pageAt(m.from + (anchors[0] ?? 0));
      const first = pageAt(m.from), last = pageAt(m.to - 1); if (last !== first) m.pages = [first, last];
    }
  }
  return merged;
}

const SECTIONS: Record<string, string[]> = {
  abstract: ["abstract", "summary"],
  introduction: ["introduction", "background"],
  methods: ["methods", "method", "materials and methods", "methodology", "proposed method", "approach"],
  results: ["results", "results and discussion", "experiments", "experimental results", "experiments and results"],
  discussion: ["discussion"],
  conclusion: ["conclusion", "conclusions", "concluding remarks", "conclusions and future work", "conclusion and future work", "conclusion and outlook"],
};
const MAJOR = new Set([...Object.values(SECTIONS).flat(), "related work", "references", "acknowledgements", "acknowledgments", "data availability", "author contributions", "funding", "competing interests", "additional information", "supplementary information", "declarations"]);
const headingName = (line: string) => line.trim().replace(/^\d+(?:\.\d+)*\.?\s+/, "").replace(/[.:]$/, "").trim().toLowerCase();
/** Names a request for a whole section ("abstract", "the conclusions"), or null for any other request. */
function sectionKey(query: string): string | null {
  const q = query.toLowerCase().replace(/\b(the|section|of|paper|a)\b/g, " ").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  return Object.entries(SECTIONS).find(([key, names]) => q === key || names.includes(q))?.[0] ?? null;
}
/** The text of a named section located by its heading line, with fallbacks for papers without that heading. Returns null when it cannot be found. */
function sectionRange(text: string, query: string, maxChars: number): { from: number; to: number } | null {
  const key = sectionKey(query); if (!key) return null;
  const lines: { at: number; name: string; short: boolean }[] = []; let at = 0;
  for (const line of text.split("\n")) { const name = headingName(line); lines.push({ at, name, short: line.trim().length > 0 && line.trim().length <= 60 }); at += line.length + 1; }
  const isHeading = (l: { name: string; short: boolean }) => l.short && MAJOR.has(l.name);
  const wanted = new Set(SECTIONS[key]);
  const endFrom = (start: number) => { const next = lines.find(l => l.at > start && isHeading(l) && !wanted.has(l.name)); return Math.min(next?.at ?? text.length, start + maxChars); };
  const found = lines.filter(l => l.short && wanted.has(l.name));
  const pick = key === "conclusion" || key === "discussion" ? found.at(-1) : found[0];
  if (pick) return { from: pick.at, to: endFrom(pick.at) };
  if (key === "conclusion") { const discussion = lines.filter(l => l.short && l.name === "discussion").at(-1); if (discussion) return { from: discussion.at, to: endFrom(discussion.at) }; const refs = lines.find(l => l.at > text.length / 2 && l.short && ["references", "acknowledgements", "acknowledgments", "data availability"].includes(l.name)); const stop = refs?.at ?? text.length; return { from: Math.max(0, stop - Math.min(maxChars, 3500)), to: stop }; }
  if (key === "abstract") { const first = lines.find(l => l.at > 200 && isHeading(l)); return { from: 0, to: Math.min(first?.at ?? text.length, 3000, maxChars) }; }
  return null;
}
