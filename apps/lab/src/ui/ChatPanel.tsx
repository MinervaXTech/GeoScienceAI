import { useEffect, useRef, useState } from "react";
import { isReadOnly, SAVE_TYPES, SESSION_IMPORT, savedTo, sessionBatch, sessionImportName } from "../domain/store";
import { CHAT_DEFAULT_WIDTH, CHAT_KEY_STEP, CHAT_MIN_WIDTH } from "./chatSize";
import { ATTACH_ACCEPT, MAX_ATTACHMENTS, readAttachment } from "../domain/attachments";
import type { Attachment, ItemType, LabState, Message, Mode, Session } from "../domain/types";
import { AGENT_MODELS, agentModelLabel, type AgentModelChoice } from "../geo/mapAgent";
import type { MapChatController } from "./useMapChat";
import { KnowledgeOffer } from "./KnowledgeOffer";
import type { KnowledgeCapture } from "../domain/knowledge";
import { ChatMarkdown } from "./ChatMarkdown";
import { SampleBadge, VerdictLine } from "./Badges";
import { formatDateTime, formatSessionTime, MODE_TEXT, plural } from "./format";

interface Props {
  state: LabState;
  agent: MapChatController;
  sessionId: string | undefined;
  expanded?: boolean;
  onToggleExpanded?(): void;
  width?: number;
  onResize?(width: number): void;
  full?: boolean;
  onToggleFull?(): void;
  onSelect(id: string): void;
  onNewSession(): void;
  onResumeSession?(id: string): void;
  onRenameSession(id: string, title: string): void;
  onDeleteSession(id: string): void;
  onMode(sessionId: string, mode: Mode): void;
  onSend(sessionId: string, text: string, useAgent: boolean, attachments?: Attachment[]): void;
  onKnowledgeChange?(sessionId: string, messageId: string, value: KnowledgeCapture): void;
  onEditMessage(sessionId: string, messageId: string, text: string): void;
  onSave(input: { sessionId: string; messageId: string; batchId: string; type: ItemType }): void;
}

export function ChatPanel({ agent, state, sessionId, expanded = true, onToggleExpanded, width = CHAT_DEFAULT_WIDTH, onResize, full = false, onToggleFull, onSelect, onNewSession, onResumeSession, onRenameSession, onDeleteSession, onMode, onSend, onEditMessage, onKnowledgeChange, onSave }: Props) {
  const session = state.sessions.find((s) => s.id === sessionId);
  const ordered = [...state.sessions].reverse();
  const [useAgent, setUseAgent] = useState(true);
  const logEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { logEnd.current?.scrollIntoView?.({ block: "nearest" }); }, [session?.messages.length, agent.phase]);
  const [composer, setComposer] = useState({ sessionId, text: "" });
  const draft = composer.sessionId === sessionId ? composer.text : "";
  const setDraft = (text: string) => setComposer({ sessionId, text });
  const [saving, setSaving] = useState<string | null>(null);
  const [attached, setAttached] = useState<{ sessionId: string | undefined; items: Attachment[] }>({ sessionId, items: [] });
  const attachments = attached.sessionId === sessionId ? attached.items : [];
  const [attachError, setAttachError] = useState("");
  const [dragging, setDragging] = useState(false), drag = useRef<(() => void) | null>(null);
  useEffect(() => () => drag.current?.(), []);
  const [settingsShown, setSettingsShown] = useState(() => { try { return localStorage.getItem("lab.chat.settingsShown") !== "false"; } catch { return true; } });
  const toggleSettings = () => { const next = !settingsShown; setSettingsShown(next); try { localStorage.setItem("lab.chat.settingsShown", String(next)); } catch { /* the choice still applies to this visit */ } };
  const fileInput = useRef<HTMLInputElement>(null);
  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    setAttachError(files.length > room ? `Up to ${MAX_ATTACHMENTS} files per message.` : "");
    const added: Attachment[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      try { added.push(await readAttachment(file, `att-${crypto.randomUUID()}`)); } catch (e) { setAttachError(e instanceof Error ? e.message : "Could not read the file."); }
    }
    if (added.length) setAttached(current => ({ sessionId, items: [...(current.sessionId === sessionId ? current.items : []), ...added] }));
  };

  const optionLabel = (s: Session) => `${s.title}, ${formatSessionTime(s.createdAt)}${isReadOnly(s) ? " (read-only)" : ""}`;
  const readOnly = session ? isReadOnly(session) : false;
  const sessionDefaultName = session ? (sessionBatch(state, session.id)?.name ?? sessionImportName(session)) : "";

  return (
    <aside className={`chat${expanded ? "" : " collapsed"}${dragging ? " dragging" : ""}`} aria-label="Chat">
      {expanded && !full && onResize && <div role="separator" aria-orientation="vertical" aria-label="Resize chat" aria-valuenow={width} aria-valuemin={CHAT_MIN_WIDTH} tabIndex={0} className={`chat-resizer${dragging ? " dragging" : ""}`} title="Drag to resize, double-click to reset"
        onPointerDown={e => {
          e.preventDefault(); drag.current?.();
          const right = e.currentTarget.closest(".layout")?.getBoundingClientRect().right ?? window.innerWidth;
          const move = (ev: PointerEvent) => onResize(right - ev.clientX);
          const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); drag.current = null; setDragging(false); };
          window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop); window.addEventListener("pointercancel", stop);
          drag.current = stop; setDragging(true);
        }}
        onDoubleClick={() => onResize(CHAT_DEFAULT_WIDTH)}
        onKeyDown={e => { if (e.key === "ArrowLeft") { e.preventDefault(); onResize(width + CHAT_KEY_STEP); } else if (e.key === "ArrowRight") { e.preventDefault(); onResize(width - CHAT_KEY_STEP); } else if (e.key === "Home") { e.preventDefault(); onResize(CHAT_MIN_WIDTH); } else if (e.key === "End") { e.preventDefault(); onResize(100000); } }} />}
      <div className="chat-head">
        <h2>Chat</h2>
        <div id="chat-session-controls" className="chat-session-controls" hidden={!expanded}>
          <select aria-label="Session" value={session?.id ?? ""} onChange={(e) => onSelect(e.target.value)} disabled={!state.sessions.length || agent.busy}>
            {!state.sessions.length && <option value="">No sessions yet</option>}
            {ordered.map((s) => (
              <option key={s.id} value={s.id}>
                {optionLabel(s)}
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={agent.busy} onClick={onNewSession}>
            + New session
          </button>
        </div>
        {onToggleFull && expanded && <button type="button" className="chat-toggle chat-full-toggle" onClick={onToggleFull} aria-pressed={full} aria-label={full ? "Exit full screen chat" : "Full screen chat"} title={full ? "Exit full screen (Esc)" : "Full screen"}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={full ? "M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" : "M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"} /></svg>
        </button>}
        {onToggleExpanded && <button type="button" className="chat-toggle" onClick={onToggleExpanded} aria-expanded={expanded} aria-controls="chat-session-controls chat-panel-content" aria-label={expanded ? "Collapse chat" : "Expand chat"} title={expanded ? "Collapse chat" : "Expand chat"}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={expanded ? "m6 4 4 4-4 4" : "m10 4-4 4 4 4"} /></svg>
          {!expanded && <span className="chat-toggle-text">Expand chat</span>}
        </button>}
      </div>
      <div id="chat-panel-content" className="chat-content" hidden={!expanded}>
        <div className="muse-chat-controls">
          <button type="button" className="btn small chat-settings-toggle" aria-expanded={settingsShown} aria-controls="muse-chat-settings" onClick={toggleSettings}>{settingsShown ? "Hide chat settings" : "Show chat settings"}</button>
          <div id="muse-chat-settings" className="muse-chat-settings" hidden={!settingsShown}>
          {session && <SessionActions key={session.id} session={session} busy={agent.busy} onRename={onRenameSession} onDelete={onDeleteSession} />}
          <div className="toggle" role="group" aria-label="Chat interaction"><button type="button" disabled={agent.busy} aria-pressed={useAgent} onClick={() => setUseAgent(true)}>Muse agent</button><button type="button" disabled={agent.busy} aria-pressed={!useAgent} onClick={() => setUseAgent(false)}>Notes only</button></div>
          {useAgent && <><label>Muse model<select aria-label="Muse chat model" value={agent.modelChoice} disabled={agent.busy} onChange={e => agent.setModel(e.target.value as AgentModelChoice)}><option value="auto">Auto · choose for each message</option>{AGENT_MODELS.map(model => <option key={model} value={model}>{agentModelLabel(model)}</option>)}</select></label><ul className="hint muse-model-guide">
            {agent.modelChoice === "auto" ? <><li><strong>Spark 1.3:</strong> routine chat and map controls.</li><li><strong>Wonder 1.0:</strong> analysis and complex requests; may cost more.</li><li><strong>Model used:</strong> shown on each reply.</li></> : <li><strong>Selected model:</strong> controls the map and its analysis tools.</li>}
            <li><strong>Image generation:</strong> Muse Image 1.0.</li>
            <li><strong>Segmentation:</strong> SAM 3.1.</li>
          </ul></>}
          </div>
          {useAgent && !agent.configured && <p className="sam-error">Configure MODEL_API_KEY to enable Muse chat.</p>}
        </div>
        {session && (
          <p className="chat-meta">
            {readOnly ? `Ended ${formatDateTime(session.endedAt!)}` : "Current session"} · {MODE_TEXT[session.mode]} · {plural(session.messages.length, "message")}
            {session.sample && <> <SampleBadge /></>}
          </p>
        )}

        <div className="chat-log">
          {!session && <p className="empty">No session yet. Start one with New session.</p>}
          {session && !session.messages.length && <div className="empty"><p>{useAgent ? "Ask Muse to control or analyze the selected map." : "New session. No messages yet."}</p>{useAgent && <div className="muse-chat-examples">{["Hide SAM masks and show planning points", "Cover this map with planning points using CHMv2 and SAM", "Compare planning routes", "Analyze the selected area"].map(text => <button type="button" className="btn small" key={text} onClick={() => setDraft(text)}>{text}</button>)}</div>}</div>}
          {session?.messages.map((m) => (
            <MessageRow
              key={`${session.id}:${m.id}`}
              state={state}
              session={session}
              message={m}
              saving={saving === m.id}
              busy={agent.busy}
              canResend={!agent.busy && (!useAgent || agent.configured)}
              resendLabel={useAgent ? "Send as new message" : "Save as new note"}
              knowledgeModel={agent.model}
              onKnowledge={onKnowledgeChange ? value => onKnowledgeChange(session.id, m.id, value) : undefined}
              onEdit={text => onEditMessage(session.id, m.id, text)}
              onResend={text => onSend(session.id, text, useAgent)}
              onOpen={() => setSaving(saving === m.id ? null : m.id)}
              onSave={(batchId, type) => {
                onSave({ sessionId: session.id, messageId: m.id, batchId, type });
                setSaving(null);
              }}
            />
          ))}
          <div ref={logEnd} />
        </div>

        {session && readOnly && (
          <div className="chat-foot readonly">
            <h3>Read-only session</h3>
            <p>
              {session.title}, {formatSessionTime(session.createdAt)} ended {formatDateTime(session.endedAt!)}. You can still save its messages to notes.
            </p>
            {!session.sample && onResumeSession && <button type="button" className="btn small primary" disabled={agent.busy} onClick={() => onResumeSession(session.id)}>Continue this session</button>}
          </div>
        )}
        {session && !readOnly && (
          <form
            className="chat-foot"
            onSubmit={(e) => {
              e.preventDefault();
              if ((!draft.trim() && !attachments.length) || agent.busy || (useAgent && !agent.configured)) return;
              onSend(session.id, draft.trim() || "Shared a file", useAgent, attachments);
              setDraft("");
              setAttached({ sessionId, items: [] });
              setAttachError("");
            }}
          >
            {!useAgent && <div className="mode-row">
              <div className="toggle" role="group" aria-label="Mode">
                {(["take-notes", "reproduce"] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={session.mode === m} onClick={() => onMode(session.id, m)}>
                    {MODE_TEXT[m] === "Reproduce a method" ? "Reproduce a method" : MODE_TEXT[m]}
                  </button>
                ))}
              </div>
              <span className="hint">Saves go to {sessionDefaultName}</span>
            </div>}
            <textarea
              aria-label="Message"
              disabled={agent.busy}
              placeholder={useAgent ? "Ask Muse to work on this map…" : session.mode === "take-notes" ? "Write a note..." : "Describe the method to reproduce..."}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") e.currentTarget.form?.requestSubmit();
              }}
              onPaste={(e) => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); void addFiles(files); } }}
            />
            {attachments.length > 0 && <ul className="attachment-chips" aria-label="Attached files">{attachments.map(a => <li key={a.id}>{a.kind === "image" ? <img src={a.dataUrl} alt="" /> : <span aria-hidden="true">{"📄"}</span>}<span className="attachment-name" title={a.name}>{a.name}</span><button type="button" className="btn small" aria-label={`Remove ${a.name}`} onClick={() => setAttached({ sessionId, items: attachments.filter(x => x.id !== a.id) })}>{"×"}</button></li>)}</ul>}
            {attachError && <p className="sam-error" role="alert">{attachError}</p>}
            <div className="send-row">
              <input ref={fileInput} type="file" hidden multiple accept={ATTACH_ACCEPT} aria-label="Attach files" onChange={e => { const files = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ""; void addFiles(files); }} />
              <button type="button" className="btn" disabled={agent.busy || attachments.length >= MAX_ATTACHMENTS} onClick={() => fileInput.current?.click()}>Attach</button>
              <span className="hint" role="status">{agent.phase || (useAgent ? "Muse can run map tools. Each action is logged." : "Saves a note without a model call.")}</span>
              {agent.busy ? <button type="button" className="btn" onClick={agent.cancel}>Stop Muse</button> : <button type="submit" className="btn primary" disabled={(!draft.trim() && !attachments.length) || (useAgent && !agent.configured)}>
                {useAgent ? "Send to Muse" : "Save note"}
              </button>}
            </div>
          </form>
        )}
      </div>
    </aside>
  );
}

function SessionActions({ session, busy, onRename, onDelete }: {
  session: Session; busy: boolean;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}) {
  const [action, setAction] = useState<"rename" | "delete" | null>(null);
  const [title, setTitle] = useState(session.title);
  return <div className="session-actions">
    <div className="session-action-buttons" role="group" aria-label="Manage session">
      <button type="button" className="btn small" disabled={busy} aria-expanded={action === "rename"} onClick={() => { setTitle(session.title); setAction(action === "rename" ? null : "rename"); }}>Rename session</button>
      <button type="button" className="btn small" disabled={busy} aria-expanded={action === "delete"} onClick={() => setAction(action === "delete" ? null : "delete")}>Delete session</button>
    </div>
    {action === "rename" && <form className="session-rename" onSubmit={e => { e.preventDefault(); if (busy || !title.trim()) return; onRename(session.id, title); setAction(null); }}>
      <label htmlFor="session-title">Session name</label>
      <input id="session-title" autoFocus value={title} disabled={busy} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setAction(null); }} />
      <div className="session-action-buttons"><button type="submit" className="btn small primary" disabled={busy || !title.trim()}>Save name</button><button type="button" className="btn small" onClick={() => setAction(null)}>Cancel</button></div>
    </form>}
    {action === "delete" && <div className="session-delete" role="group" aria-label="Confirm session deletion">
      <p>Delete “{session.title}” and its {plural(session.messages.length, "message")}? Notes already saved will be kept.</p>
      <div className="session-action-buttons"><button type="button" className="btn small primary" disabled={busy} onClick={() => { if (!busy) onDelete(session.id); }}>Delete permanently</button><button type="button" className="btn small" onClick={() => setAction(null)}>Cancel</button></div>
    </div>}
  </div>;
}

function MessageRow(props: {
  state: LabState;
  session: Session;
  message: Message;
  saving: boolean;
  busy: boolean;
  canResend: boolean;
  resendLabel: string;
  knowledgeModel: string;
  onKnowledge?(value: KnowledgeCapture): void;
  onEdit(text: string): void;
  onResend(text: string): void;
  onOpen(): void;
  onSave(batchId: string, type: ItemType): void;
}) {
  const { state, session, message: m } = props;
  const saved = savedTo(state, session.id, m.id);
  const [batchId, setBatchId] = useState(SESSION_IMPORT);
  const [type, setType] = useState<ItemType>("note");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(m.text);
  const editable = m.role === "researcher" && !isReadOnly(session);
  const importName = sessionBatch(state, session.id)?.name ?? sessionImportName(session);

  return (
    <article className={`msg ${m.role}`}>
      <header>
        <strong>{m.role === "researcher" ? "Researcher" : m.agent ? "Muse" : "Model"}</strong>
        {m.replay && <span className="tag">Saved replay</span>}
        {m.editedAt && <span className="tag" title={`Edited ${formatDateTime(m.editedAt)}`}>Edited</span>}
        <span className="spacer" />
        <div className="message-actions">
          <CopyMessage text={m.text} />
          {editable && <button type="button" className="btn small" disabled={props.busy} aria-expanded={editing} onClick={() => { setEditText(m.text); setEditing(!editing); }}>Edit</button>}
        {saved ? (
          <span className="saved-mark">
            <span aria-hidden="true">{"✓"}</span> Saved to <b>{saved.batch.name}</b>
          </span>
        ) : (
          <button type="button" className="btn small" aria-expanded={props.saving} onClick={props.onOpen}>
            Save to notes
          </button>
        )}
        </div>
      </header>
      {m.agent && <p className="hint">{m.agent.modelSelection === "auto" ? "Auto → " : ""}{m.agent.model} · {m.agent.status} · {m.agent.requests} chat call(s)</p>}
      {editing && editable ? <form className="message-edit" onSubmit={e => { e.preventDefault(); if (props.busy || !editText.trim()) return; props.onEdit(editText); setEditing(false); }}>
        <label htmlFor={`edit-${m.id}`}>Edit message</label>
        <textarea id={`edit-${m.id}`} autoFocus value={editText} disabled={props.busy} onChange={e => setEditText(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setEditing(false); if ((e.metaKey || e.ctrlKey) && e.key === "Enter") e.currentTarget.form?.requestSubmit(); }} />
        <p className="hint">Save edits to this message, or send the revised text as a new turn. Earlier replies, map changes and saved notes are kept.</p>
        <div className="message-actions">
          <button type="submit" className="btn small" disabled={props.busy || !editText.trim()}>Save edit</button>
          <button type="button" className="btn small" disabled={!props.canResend || !editText.trim()} onClick={() => { if (!props.canResend || !editText.trim()) return; props.onResend(editText); setEditing(false); }}>{props.resendLabel}</button>
          <button type="button" className="btn small" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form> : m.role === "model" ? <ChatMarkdown text={m.text || (m.agent?.status === "running" ? "Working on the selected map…" : "")} /> : <p>{m.text}</p>}
      {m.attachments && m.attachments.length > 0 && <ul className="attachment-list" aria-label="Attachments">{m.attachments.map(a => <li key={a.id}>{a.kind === "image" && a.dataUrl ? <a href={a.dataUrl} target="_blank" rel="noreferrer" title={a.name}><img src={a.dataUrl} alt={a.name} /></a> : <details><summary>{"📄 "}{a.name}{a.truncated ? " (truncated)" : ""}</summary><pre>{a.text}</pre></details>}</li>)}</ul>}
      {m.role === "researcher" && <KnowledgeOffer message={m} model={props.knowledgeModel} disabled={props.busy} onChange={props.onKnowledge} />}
      {m.agent && m.agent.steps.length > 0 && <details className="muse-chat-actions" open={m.agent.status === "running"}><summary>Action log · {m.agent.steps.length}</summary><ol>{m.agent.steps.map((step, index) => <li key={index}><details><summary>{step.action.replaceAll("_", " ")} · {step.status}</summary><pre>{JSON.stringify({ parameters: step.parameters, result: step.result }, null, 2)}</pre></details></li>)}</ol></details>}
      {m.validation && <VerdictLine check={m.validation.citationCheck} modelDrafted review="pending" />}
      {!m.validation && !m.agent && m.role === "model" && <p className="hint">Citation check: Not run</p>}
      {props.saving && !saved && (
        <form
          className="save-form"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSave(batchId, type);
          }}
        >
          <label>
            Batch
            <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value={SESSION_IMPORT}>{importName}</option>
              {state.batches
                .filter((b) => b.name !== importName)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as ItemType)}>
              {SAVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t[0]!.toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn small primary">
            Save
          </button>
          <button type="button" className="btn small" onClick={props.onOpen}>
            Cancel
          </button>
        </form>
      )}
    </article>
  );
}


function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  return <>
    <button type="button" className="btn small" aria-live="polite" disabled={!text} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(text); setFailed(false); }
      catch { setCopied(null); setFailed(true); }
    }}>{copied === text ? "Copied!" : "Copy"}</button>
    {failed && <div className="message-copy-fallback"><p className="hint" role="status">Clipboard unavailable. Select and copy the text below.</p><textarea aria-label="Copy message text" readOnly autoFocus value={text} onFocus={e => e.currentTarget.select()} /><button type="button" className="btn small" onClick={() => setFailed(false)}>Close</button></div>}
  </>;
}
