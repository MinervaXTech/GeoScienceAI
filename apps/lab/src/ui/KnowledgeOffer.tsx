import { useEffect, useMemo, useRef, useState } from "react";
import { attachmentFile, pdfRead } from "../domain/attachments";
import { detectPaper, type KnowledgeCapture } from "../domain/knowledge";
import type { Message } from "../domain/types";
export function KnowledgeOffer({ message, model, disabled, onChange }: { message: Message; model: string; disabled: boolean; onChange?(value: KnowledgeCapture): void }) {
  const [, refresh] = useState(0);
  useEffect(() => { const update = () => refresh(n => n + 1); window.addEventListener("lab-pdf-read", update); return () => window.removeEventListener("lab-pdf-read", update); }, []);
  const found = useMemo(() => message.knowledge?.candidate ?? detectPaper(message), [message]);
  const readTitle = found?.source.attachmentId ? pdfRead(found.source.attachmentId)?.title : undefined;
  const candidate = useMemo(() => found && readTitle ? { ...found, title: readTitle } : found, [found, readTitle]);
  const [running, setRunning] = useState(false), [error, setError] = useState(""), [selected, setSelected] = useState<File | null>(null), [collection, setCollection] = useState(""), [known, setKnown] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ stage: string; percent: number; chunk: number; chunks: number } | null>(null);
  const pending = useRef<AbortController | null>(null), loaded = useRef(false);
  useEffect(() => {
    if (!running) { setProgress(null); return; }
    let live = true;
    const poll = async () => { try { const d = await (await fetch("/api/knowledge/progress")).json(); if (live && d.running && typeof d.percent === "number") setProgress({ stage: String(d.stage), percent: d.percent, chunk: Number(d.chunk) || 0, chunks: Number(d.chunks) || 0 }); } catch { /* the next poll tries again */ } };
    void poll(); const timer = setInterval(poll, 1000);
    return () => { live = false; clearInterval(timer); };
  }, [running]);
  useEffect(() => () => pending.current?.abort(), []);
  const loadCollections = () => {
    if (loaded.current) return; loaded.current = true;
    void fetch("/api/knowledge").then(r => r.json()).then(d => { if (Array.isArray(d.entries)) setKnown([...new Set((d.entries as { collections?: string[] }[]).flatMap(e => e.collections ?? []))].sort()); }).catch(() => { loaded.current = false; });
  };
  useEffect(() => { if (candidate && !message.knowledge) onChange?.({ status: "offered", candidate }); }, [candidate, message.knowledge, onChange]);
  if (!candidate) return null;
  const status = message.knowledge?.status ?? "offered";
  if (status === "declined") return <p className="hint">Paper not added to the knowledge base.</p>;
  if (status === "stored") return <p className="knowledge-offer"><strong>Stored in knowledge base.</strong> {message.knowledge?.entryId && <a href={`/api/knowledge/${message.knowledge.entryId}/graph.html`} target="_blank" rel="noreferrer">Open paper graph</a>}</p>;
  const learn = async () => {
    if (running || disabled) return;
    const controller = new AbortController(); pending.current = controller; setRunning(true); setError("");
    try {
      const chosenModel = model === "muse-wonder-1.0" ? model : "muse-spark-1.3";
      const fileId = candidate.source.attachmentId, attachment = message.attachments?.find(a => a.id === fileId);
      const file = selected ?? (fileId ? attachmentFile(fileId) : undefined);
      let body: BodyInit, headers: HeadersInit | undefined;
      if (file) {
        const form = new FormData(); form.set("confirmed", "true"); form.set("model", chosenModel); form.set("title", candidate.title); if (collection.trim()) form.set("collections", JSON.stringify([collection])); form.set("file", file); if (attachment?.sha256) form.set("sha256", attachment.sha256); body = form;
      } else {
        const text = candidate.source.text ?? (attachment?.kind === "text" && !attachment.truncated ? attachment.text : undefined);
        if (!candidate.source.url && !text) throw Error("Choose the original file below. Files are not retained in browser session storage.");
        headers = { "Content-Type": "application/json" }; body = JSON.stringify({ confirmed: true, model: chosenModel, title: candidate.title, ...(collection.trim() ? { collections: [collection] } : {}), ...(candidate.source.url ? { url: candidate.source.url } : { text }) });
      }
      const response = await fetch("/api/knowledge/ingest", { method: "POST", body, headers, signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw Error(data.error ?? "Paper could not be stored.");
      if (!/^[a-z0-9-]{8,64}$/.test(data.entry?.id) || data.entry?.status !== "stored") throw Error("Invalid knowledge receipt.");
      onChange?.({ status: "stored", entryId: data.entry.id, candidate });
      window.dispatchEvent(new Event("lab-knowledge-changed"));
    } catch (e) {
      if (controller.signal.aborted) return;
      const detail = e instanceof Error ? e.message : "Paper could not be stored."; setError(detail); onChange?.({ status: "failed", error: detail, candidate }); window.dispatchEvent(new Event("lab-knowledge-changed"));
    } finally { if (pending.current === controller) { pending.current = null; setRunning(false); } }
  };
  return <div className="knowledge-offer" aria-label="Paper knowledge offer">
    <p><strong>This looks like a paper: {candidate.title}.</strong> Muse will read it (uses Muse Spark/Wonder credits) and add it to your knowledge base.</p>
    <p className="hint">Extraction uses {model === "muse-wonder-1.0" ? "Muse Wonder 1.0" : "Muse Spark 1.3"}. The whole paper must fit the size and token budget. Nothing is learned until you confirm.</p>
    {candidate.source.attachmentId && !attachmentFile(candidate.source.attachmentId) && <label>Choose original paper file<input aria-label="Choose original paper file" type="file" accept="application/pdf,.pdf,.txt,.md" disabled={running} onChange={e => setSelected(e.target.files?.[0] ?? null)} /></label>}
    {!running && <label className="knowledge-collection">Collection (optional)<input aria-label="Collection (optional)" onFocus={loadCollections} list={`collections-${message.id}`} maxLength={60} value={collection} onChange={e => setCollection(e.target.value)} placeholder="e.g. canopy height review" /><datalist id={`collections-${message.id}`}>{known.map(name => <option key={name} value={name} />)}</datalist></label>}
    {running ? <div role="status" className="knowledge-progress"><p>{progress ? `${progress.stage}${progress.chunks ? ` · part ${progress.chunk} of ${progress.chunks}` : ""} · ${progress.percent}%` : "Starting…"}</p><progress max={100} value={progress?.percent ?? 0} aria-label="Reading progress" /><button className="btn small" onClick={() => pending.current?.abort()}>Cancel</button></div> : <div className="session-action-buttons"><button type="button" className="btn small" disabled={disabled || !onChange} onClick={() => { void learn(); }}>Store in knowledge base</button><button type="button" className="btn small" disabled={disabled || !onChange} onClick={() => onChange?.({ status: "declined", candidate })}>Not now</button></div>}
    {!running && (error || message.knowledge?.error) && <p className="sam-error" role="alert">{error || message.knowledge?.error}</p>}
  </div>;
}
