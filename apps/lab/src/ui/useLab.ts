import { useCallback, useEffect, useRef, useState } from "react";
import { loadState, saveState } from "../domain/persistence";
import { withDefaultMapAreas } from "../domain/maps";
import type { LabState } from "../domain/types";

export interface Notice {
  kind: "info" | "error";
  text: string;
}

/**
 * Holds the whole state, persists it after the first change, and turns thrown
 * domain errors into a notice. The first render never writes to storage, so a
 * saved state that failed to load is not overwritten until the user acts.
 */
export function useLab() {
  const [initial] = useState(() => { const saved = loadState(); return { ...saved, state: withDefaultMapAreas({ ...saved.state, sessions: saved.state.sessions.map(session => ({ ...session, messages: session.messages.map(message => message.agent?.status === "running" ? { ...message, text: message.text || "Interrupted by page reload. Completed changes are retained; no automatic retry was sent.", agent: { ...message.agent, status: "cancelled" as const, steps: message.agent.steps.map(step => step.status === "running" ? { ...step, status: "error" as const, result: { error: "Interrupted by page reload." } } : step) } } : message) })) }) }; });
  const [state, setState] = useState<LabState>(initial.state);
  const [notice, setNotice] = useState<Notice | null>(
    initial.warning ? { kind: "error", text: initial.warning } : null,
  );
  const ref = useRef(state);
  const touched = useRef(false);

  useEffect(() => {
    if (!touched.current) return;
    if (!saveState(state)) setNotice({ kind: "error", text: "Could not save to local storage. Use Export JSON to keep your data." });
  }, [state]);

  /** Runs a domain function that returns the next state plus extras, e.g. the new item. Errors become a notice. */
  const run = useCallback(<T extends { state: LabState }>(fn: (s: LabState) => T): T | undefined => {
    try {
      const out = fn(ref.current);
      ref.current = out.state;
      touched.current = true;
      setState(out.state);
      setNotice(null);
      return out;
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : String(e) });
      return undefined;
    }
  }, []);

  const apply = useCallback((fn: (s: LabState) => LabState) => run((s) => ({ state: fn(s) })) !== undefined, [run]);

  const replace = useCallback((next: LabState) => {
    ref.current = next;
    touched.current = true;
    setState(next);
  }, []);

  return { state, apply, run, replace, notice, setNotice };
}
