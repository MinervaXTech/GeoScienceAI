import { useState } from "react";
import { isReadOnly, SAVE_TYPES, SESSION_IMPORT, savedTo, sessionBatch, sessionImportName } from "../domain/store";
import type { ItemType, LabState, Message, Mode, Session } from "../domain/types";
import { SampleBadge, VerdictLine } from "./Badges";
import { formatDateTime, formatSessionTime, MODE_TEXT, plural } from "./format";

interface Props {
  state: LabState;
  sessionId: string | undefined;
  onSelect(id: string): void;
  onNewSession(): void;
  onMode(sessionId: string, mode: Mode): void;
  onSend(sessionId: string, text: string): void;
  onSave(input: { sessionId: string; messageId: string; batchId: string; type: ItemType }): void;
}

export function ChatPanel({ state, sessionId, onSelect, onNewSession, onMode, onSend, onSave }: Props) {
  const session = state.sessions.find((s) => s.id === sessionId);
  const ordered = [...state.sessions].reverse();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const optionLabel = (s: Session) => `${s.title}, ${formatSessionTime(s.createdAt)}${isReadOnly(s) ? " (read-only)" : ""}`;
  const readOnly = session ? isReadOnly(session) : false;
  const sessionDefaultName = session ? (sessionBatch(state, session.id)?.name ?? sessionImportName(session)) : "";

  return (
    <aside className="chat" aria-label="Chat">
      <div className="chat-head">
        <h2>Chat</h2>
        <select aria-label="Session" value={session?.id ?? ""} onChange={(e) => onSelect(e.target.value)} disabled={!state.sessions.length}>
          {!state.sessions.length && <option value="">No sessions yet</option>}
          {ordered.map((s) => (
            <option key={s.id} value={s.id}>
              {optionLabel(s)}
            </option>
          ))}
        </select>
        <button type="button" className="btn" onClick={onNewSession}>
          + New session
        </button>
      </div>
      {session && (
        <p className="chat-meta">
          {readOnly ? `Ended ${formatDateTime(session.endedAt!)}` : "Current session"} · {MODE_TEXT[session.mode]} · {plural(session.messages.length, "message")}
          {session.sample && <> <SampleBadge /></>}
        </p>
      )}

      <div className="chat-log">
        {!session && <p className="empty">No session yet. Start one with New session.</p>}
        {session && !session.messages.length && <p className="empty">New session. No messages yet.</p>}
        {session?.messages.map((m) => (
          <MessageRow
            key={m.id}
            state={state}
            session={session}
            message={m}
            saving={saving === m.id}
            onOpen={() => setSaving(saving === m.id ? null : m.id)}
            onSave={(batchId, type) => {
              onSave({ sessionId: session.id, messageId: m.id, batchId, type });
              setSaving(null);
            }}
          />
        ))}
      </div>

      {session && readOnly && (
        <div className="chat-foot readonly">
          <h3>Read-only session</h3>
          <p>
            {session.title}, {formatSessionTime(session.createdAt)} ended {formatDateTime(session.endedAt!)}. You can still save its messages to notes.
          </p>
        </div>
      )}
      {session && !readOnly && (
        <form
          className="chat-foot"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            onSend(session.id, draft);
            setDraft("");
          }}
        >
          <div className="mode-row">
            <div className="toggle" role="group" aria-label="Mode">
              {(["take-notes", "reproduce"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={session.mode === m} onClick={() => onMode(session.id, m)}>
                  {MODE_TEXT[m] === "Reproduce a method" ? "Reproduce a method" : MODE_TEXT[m]}
                </button>
              ))}
            </div>
            <span className="hint">Saves go to {sessionDefaultName}</span>
          </div>
          <textarea
            aria-label="Message"
            placeholder={session.mode === "take-notes" ? "Write a note..." : "Describe the method to reproduce..."}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") e.currentTarget.form?.requestSubmit();
            }}
          />
          <div className="send-row">
            <span className="hint">Sending adds your message only. No model call in this phase.</span>
            <button type="submit" className="btn primary" disabled={!draft.trim()}>
              Send
            </button>
          </div>
        </form>
      )}
    </aside>
  );
}

function MessageRow(props: {
  state: LabState;
  session: Session;
  message: Message;
  saving: boolean;
  onOpen(): void;
  onSave(batchId: string, type: ItemType): void;
}) {
  const { state, session, message: m } = props;
  const saved = savedTo(state, session.id, m.id);
  const [batchId, setBatchId] = useState(SESSION_IMPORT);
  const [type, setType] = useState<ItemType>("note");
  const importName = sessionBatch(state, session.id)?.name ?? sessionImportName(session);

  return (
    <article className={`msg ${m.role}`}>
      <header>
        <strong>{m.role === "researcher" ? "Researcher" : "Model"}</strong>
        {m.replay && <span className="tag">Saved replay</span>}
        <span className="spacer" />
        {saved ? (
          <span className="saved-mark">
            <span aria-hidden="true">{"✓"}</span> Saved to <b>{saved.batch.name}</b>
          </span>
        ) : (
          <button type="button" className="btn small" aria-expanded={props.saving} onClick={props.onOpen}>
            Save to notes
          </button>
        )}
      </header>
      <p>{m.text}</p>
      {m.validation && <VerdictLine check={m.validation.citationCheck} modelDrafted review="pending" />}
      {!m.validation && m.role === "model" && <p className="hint">Citation check: Not run</p>}
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
