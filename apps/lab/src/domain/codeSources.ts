/**
 * Finds what a paper itself says about its code: repository links and availability statements.
 * It reads the saved paper text only. It never fetches a link, so the result says what the paper states, not whether the link still works.
 */
export type CodeLinkKind = "repository" | "archive" | "other";
export interface CodeLink { url: string; host: string; kind: CodeLinkKind; ownCode: boolean; inReferences: boolean; quote: string; page?: number }
export type CodeStatementKind = "on_request" | "promised" | "not_available" | "data_on_request";
export interface CodeStatement { kind: CodeStatementKind; quote: string; page?: number }
export type CodeStatus = "link" | "mentioned" | "on_request" | "promised" | "not_available" | "none";
export interface CodeSources { status: CodeStatus; links: CodeLink[]; statements: CodeStatement[] }

const REPOSITORY = ["github.com", "gitlab.com", "bitbucket.org", "codeberg.org", "sourceforge.net", "huggingface.co", "gitee.com"];
const ARCHIVE = ["zenodo.org", "figshare.com", "osf.io", "codeocean.com", "dataverse.harvard.edu"];
const HOSTS = [...REPOSITORY, ...ARCHIVE];
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'()[\]{}]+|\b(?:github\.com|gitlab\.com|bitbucket\.org|codeberg\.org|gitee\.com|zenodo\.org|figshare\.com|osf\.io|huggingface\.co|sourceforge\.net)\/[^\s<>"'()[\]{}]+/gi;
const OWN = /\b(our|we (?:release|provide|make|made|have (?:released|made|published))|available (?:at|on|in|from|via)|publicly available|open[- ]?source|source code|code (?:is|are|can be) (?:found|available|accessible)|implementation|supplementary|repository|reproduc|released)\b/i;
const ON_REQUEST = /\b(?:code|software|implementation|scripts?|source)\b[^.]{0,90}\b(?:available|provided|shared)\b[^.]{0,40}\b(?:upon|on)\b[^.]{0,12}request|\b(?:code|software|implementation|scripts?)\b[^.]{0,90}\bfrom the (?:corresponding )?authors?\b/i;
const DATA_ON_REQUEST = /\bdata(?:sets?)?\b[^.]{0,140}\bavailable\b[^.]{0,80}\b(?:from the (?:corresponding )?authors?|(?:upon|on)\s+reason-?\s*able\s+request|(?:upon|on) request)/i;
const PROMISED = /\b(?:code|software|implementation|source)\b[^.]{0,90}\b(?:will be|to be)\b[^.]{0,40}\b(?:released|made (?:publicly )?available|open[- ]sourced|published|shared)\b/i;
const NOT_AVAILABLE = /\b(?:code|software|implementation|source)\b[^.]{0,70}\b(?:is|are) not (?:publicly )?(?:available|released|shared)\b|\bproprietary (?:code|software)\b/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const trimUrl = (raw: string) => { let u = raw; while (/[.,;:!?'"]$/.test(u)) u = u.slice(0, -1); return u; };
const hostOf = (url: string): string => { try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const pageAt = (text: string, index: number): number | undefined => text.includes("\f") ? text.slice(0, index).split("\f").length : undefined;
const around = (text: string, start: number, end: number) => clean(text.slice(Math.max(0, start - 220), Math.min(text.length, end + 120))).slice(0, 360);
/** Where a statement's own sentence begins: after the last sentence end, or after a heading line such as "Data availability", so the quote never opens in the paragraph before it. */
const statementStart = (text: string, start: number): number => {
  const from = Math.max(0, start - 220), head = text.slice(from, start); let cut = 0;
  for (const m of head.matchAll(/[.!?]["')\]]?\s+/g)) cut = Math.max(cut, m.index! + m[0].length);
  for (const m of head.matchAll(/(?:^|\n)[^\n.;:,]{3,50}\n/g)) cut = Math.max(cut, m.index! + m[0].length);
  return from + cut;
};
/** Where the statement's sentence ends, so the quote does not run on into whatever follows. */
const statementEnd = (text: string, end: number): number => { const tail = text.slice(end, end + 160), m = /[.!?]["')\]]?(?=\s|$)/.exec(tail); return m ? end + m.index + m[0].length : Math.min(text.length, end + 120); };
/** Where the reference list starts, when the paper has one in the second half. Links after it belong to other works. */
const referencesStart = (text: string): number => { const matches = [...text.matchAll(/\n\s*(?:references|bibliography)\s*\n/gi)]; const last = matches[matches.length - 1]; return last && last.index! > text.length / 2 ? last.index! : text.length; };

export function findCodeSources(text: string): CodeSources {
  const refsAt = referencesStart(text), links: CodeLink[] = [], seen = new Set<string>();
  for (const match of text.matchAll(URL_RE)) {
    const url = trimUrl(match[0]), host = hostOf(url), index = match.index!;
    if (!host || seen.has(url.toLowerCase())) continue;
    const known = HOSTS.some(h => host === h || host.endsWith(`.${h}`)) || (/^(?:dx\.)?doi\.org$/.test(host) && /10\.5281\//.test(url)) || (host.endsWith("mathworks.com") && /fileexchange/i.test(url));
    const quote = around(text, index, index + match[0].length), inReferences = index >= refsAt;
    if (!known && !(OWN.test(quote) && /\b(?:code|software|implementation|source|toolbox|package)\b/i.test(quote) && !inReferences)) continue;
    const kind: CodeLinkKind = REPOSITORY.some(h => host === h || host.endsWith(`.${h}`)) ? "repository" : known ? "archive" : "other";
    const page = pageAt(text, index);
    seen.add(url.toLowerCase());
    links.push({ url, host, kind, ownCode: !inReferences && OWN.test(quote), inReferences, quote, ...(page ? { page } : {}) });
    if (links.length >= 8) break;
  }
  const statements: CodeStatement[] = [];
  for (const [kind, re] of [["on_request", ON_REQUEST], ["promised", PROMISED], ["not_available", NOT_AVAILABLE], ["data_on_request", DATA_ON_REQUEST]] as const) {
    const body = text.slice(0, refsAt), match = re.exec(body);
    if (match) { const page = pageAt(text, match.index); statements.push({ kind, quote: clean(text.slice(statementStart(text, match.index), statementEnd(text, match.index + match[0].length))).slice(0, 360), ...(page ? { page } : {}) }); }
  }
  const status: CodeStatus = links.some(l => l.ownCode) ? "link" : links.some(l => !l.inReferences) ? "mentioned" : ((statements.find(x => x.kind !== "data_on_request")?.kind ?? "none") as Exclude<CodeStatementKind, "data_on_request"> | "none");
  return { status, links, statements };
}

const STATUS_TEXT: Record<CodeStatus, string> = {
  link: "The paper states where its code is.",
  mentioned: "The paper mentions a code link, but it may be a tool it uses, not its own code.",
  on_request: "The paper says its code is available on request.",
  promised: "The paper says its code will be released.",
  not_available: "The paper says its code is not available.",
  none: "The paper states no code repository or availability.",
};
export const codeStatusText = (c: CodeSources) => STATUS_TEXT[c.status];

/** Plain text for briefs and prompts: what the paper states, how to treat it, and the rule about using the authors' code. */
export function codeSourcesText(c: CodeSources | undefined, who: "agent" | "muse"): string[] {
  if (!c) return [];
  const out = ["CODE THE PAPER STATES", `- ${codeStatusText(c)}`];
  for (const l of c.links) out.push(`- ${l.url} (${l.kind}${l.ownCode ? ", likely the authors' own" : l.inReferences ? ", in the reference list" : ""}${l.page ? `, page ${l.page}` : ""}): "${l.quote.slice(0, 200)}"`);
  for (const s of c.statements) out.push(`- Statement (${s.kind.replace(/_/g, " ")}${s.page ? `, page ${s.page}` : ""}): "${s.quote.slice(0, 200)}"`);
  if (!c.links.length && c.status === "none") out.push("- Nothing was found in the saved text. A figure caption or footnote the text extraction missed could still hold a link.");
  if (who === "agent") {
    if (c.links.some(l => l.ownCode || !l.inReferences)) out.push("- Look at that repository first. If you use any of its code or data, say exactly which parts in your finish summary, and note that results from the authors' own code show the code runs, not that the method was independently re-implemented.");
    else out.push("- No author repository was found in the paper. Do not assume one exists. If you find one elsewhere, say where and how you know it is the authors'.");
  } else out.push("- You cannot fetch it from the sandbox. Write the implementation from the spec yourself, and do not claim to have used the authors' code.");
  return out;
}
