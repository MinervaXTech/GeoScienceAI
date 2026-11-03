import type { Message } from "./types";
export interface PaperCandidate { kind: "pdf" | "url" | "text"; title: string; source: { attachmentId?: string; url?: string; text?: string } }
export interface KnowledgeCapture { status: "offered" | "declined" | "stored" | "failed"; entryId?: string; error?: string; candidate?: PaperCandidate }
export const PAPER_TYPES = ["review", "method", "empirical", "other"] as const;
export type PaperType = (typeof PAPER_TYPES)[number];
export interface KnowledgeEntry { collections?: string[]; paperType?: PaperType; year?: number; doi?: string; id: string; title: string; source: string; sha256: string; addedAt: string; models: string[]; status: "running" | "stored" | "failed"; error?: string; usage?: unknown[] }
const paperText = (text: string) => [/\bAbstract\b/i, /\bReferences\b/i, /\bIntroduction\b/i, /\bdoi:/i, /\bet al\./i].filter(pattern => pattern.test(text)).length >= 2;
const guess = (text: string) => text.split("\n").find(line => line.trim())?.replace(/^#+\s*/, "").slice(0, 160) || "Research paper";
export function detectPaper(message: Pick<Message, "text" | "attachments">): PaperCandidate | null {
  const pdf = message.attachments?.find(a => a.kind === "pdf");
  if (pdf) return { kind: "pdf", title: pdf.name.replace(/\.pdf$/i, ""), source: { attachmentId: pdf.id } };
  const url = message.text.match(/https:\/\/(?:arxiv\.org\/(?:abs|pdf)\/[^\s<>]+|doi\.org\/10\.\d{4,9}\/[^\s<>]+)/i)?.[0]?.replace(/[.,;)\]]+$/, "");
  if (url) return { kind: "url", title: url, source: { url } };
  const text = message.attachments?.find(a => a.kind === "text" && !/\.(?:csv|tsv|geojson|json)$/i.test(a.name) && !/(?:csv|json)/i.test(a.mime) && paperText(a.text ?? ""));
  if (text) return { kind: "text", title: text.name, source: { attachmentId: text.id } };
  return paperText(message.text) ? { kind: "text", title: guess(message.text), source: { text: message.text } } : null;
}

const authorLine = (line: string) => /[&*\u{e000}-\u{f8ff}\u00b9\u00b2\u00b3\u2070-\u2079]|\bet al\b/u.test(line) || /^(?:[A-Z][\p{L}'.-]+\s+){1,3}[A-Z][\p{L}'.-]+(?:,\s*|\s+and\s+)/u.test(line) || /^\d+\s/.test(line);
/** Crops at a word boundary with an ellipsis. */
export const cropTitle = (title: string, max = 120) => { const t = title.replace(/\s+/g, " ").trim(); if (t.length <= max) return t; const cut = t.slice(0, max - 1), space = cut.lastIndexOf(" "); return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`; };
/** The paper's own title from the start of its text: the first lines up to the authors or abstract, or the fallback. */
export function paperTitleFromText(text: string, fallback: string, max = 120): string {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean).slice(0, 8), title: string[] = [];
  for (const line of lines) {
    if (/^(abstract|introduction|keywords?|received|article|open|www\.|https?:)/i.test(line) || authorLine(line) || title.length >= 4 || (title.length && /[.!?]$/.test(title.at(-1)!))) break;
    if (line.length > 160) break;
    title.push(line);
  }
  const joined = title.join(" ").replace(/\s+/g, " ").trim();
  return joined.length >= 8 && joined.split(" ").length >= 2 ? cropTitle(joined, max) : fallback;
}

export const MAX_COLLECTIONS = 8;
/** Trims, drops empties, and removes case-insensitive duplicates while keeping the first spelling. Throws on names that are too long or too many. */
export function normalizeCollections(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw Error("Collections must be a list of names.");
  const seen = new Set<string>(), out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") throw Error("Collection names must be text.");
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (name.length > 60 || [...name].some(c => c.charCodeAt(0) < 32)) throw Error("A collection name must be 1 to 60 characters.");
    if (!seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push(name); }
  }
  if (out.length > MAX_COLLECTIONS) throw Error(`A paper can be in at most ${MAX_COLLECTIONS} collections.`);
  return out;
}
export const inCollection = (entry: Pick<KnowledgeEntry, "collections">, name: string | undefined) => !name || !!entry.collections?.some(c => c.toLowerCase() === name.trim().toLowerCase());
