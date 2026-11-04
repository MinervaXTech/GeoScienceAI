import { codeStatusText, type CodeSources } from "../domain/codeSources";

const href = (url: string): string | null => { try { const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); return u.protocol === "https:" || u.protocol === "http:" ? u.href : null; } catch { return null; } };
const KIND: Record<string, string> = { repository: "repository", archive: "archive", other: "link" };
/** What the paper itself says about its code. It reads the paper's text only, so a link here may no longer work. */
export function CodeSourcesNote({ sources }: { sources?: CodeSources }) {
  if (!sources) return null;
  const links = sources.links, statements = sources.statements;
  return <div className="code-sources" aria-label="Code the paper states">
    <p><strong>Code the paper states</strong> <span className="hint">{codeStatusText(sources)}</span></p>
    {(links.length > 0 || statements.length > 0) && <ul className="pr-env-points">
      {links.map(l => { const target = href(l.url); return <li key={l.url}>{target ? <a href={target} target="_blank" rel="noreferrer noopener">{l.url}</a> : l.url} <span className="hint">· {KIND[l.kind]}{l.ownCode ? " · likely the authors' own" : l.inReferences ? " · in the reference list" : ""}{l.page ? ` · page ${l.page}` : ""}</span></li>; })}
      {statements.map(s => <li key={s.kind} className="hint">{s.kind === "on_request" ? "Code available on request" : s.kind === "data_on_request" ? "Data available on request" : s.kind === "promised" ? "Code to be released" : "Code not available"}{s.page ? ` · page ${s.page}` : ""}: “{s.quote.slice(0, 160)}”</li>)}
    </ul>}
    <p className="hint">Read from the saved paper text. The link was not opened, so check it still works.</p>
  </div>;
}
