import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isAgentModelChoice, resolveAgentModel, validateMapAgentCall, type AgentChatMeta, type AgentModel, type AgentModelChoice, type MapAgentCall, type MapAgentHandle } from "../geo/mapAgent";
import type { Message, Session } from "../domain/types";
import type { MuseImage } from "../geo/muse";

type Bridge = Pick<MapAgentHandle, "context" | "execute" | "cancel">;
export function useMapChat(bridge: Bridge, update: (sessionId: string, message: Message) => void) {
  const [modelChoice, setModelState] = useState<AgentModelChoice>(() => { try { const saved = localStorage.getItem("lab.muse.chatModel"); return isAgentModelChoice(saved) ? saved : "auto"; } catch { return "auto"; } });
  const [autoModel, setAutoModel] = useState<AgentModel>("muse-spark-1.3");
  const model = modelChoice === "auto" ? autoModel : modelChoice;
  const [configured, setConfigured] = useState(false), [phase, setPhase] = useState("");
  const pending = useRef<AbortController | null>(null);
  const latest = useRef({ bridge, update });
  useLayoutEffect(() => { latest.current = { bridge, update }; });
  useEffect(() => { const controller = new AbortController(); void fetch("/api/map-agent/status", { signal: controller.signal }).then(r => r.json()).then(d => { if (!controller.signal.aborted) setConfigured(d.configured === true); }).catch(() => {}); return () => { controller.abort(); pending.current?.abort(); }; }, []);
  const setModel = (value: AgentModelChoice) => { if (pending.current || !isAgentModelChoice(value)) return; setModelState(value); try { localStorage.setItem("lab.muse.chatModel", value); } catch { /* session choice still works */ } };
  const cancel = () => { pending.current?.abort(); latest.current.bridge.cancel(); };
  const send = async (session: Session, text: string) => {
    if (pending.current || session.endedAt || !text.trim()) return;
    const controller = new AbortController(); pending.current = controller;
    const previousModel = session.messages.filter(m => m.agent).at(-1)?.agent?.model;
    const model = resolveAgentModel(modelChoice, text, previousModel);
    setAutoModel(model);
    const meta: AgentChatMeta = { model, modelSelection: modelChoice, mapId: String(latest.current.bridge.context().mapId ?? ""), status: "running", steps: [], requests: 0 };
    const reply: Message = { id: `msg-${crypto.randomUUID()}`, role: "model", model, text: "", createdAt: new Date().toISOString(), agent: meta };
    const publish = () => latest.current.update(session.id, { ...reply, agent: { ...meta, steps: meta.steps.map(s => ({ ...s })) } });
    const history: unknown[] = [...session.messages.slice(-12).filter(m => m.text.trim() && m.agent?.status !== "running").map(m => ({ role: m.role === "researcher" ? "user" : "assistant", content: m.text.slice(0, 18000) })), { role: "user", content: text.trim() }];
    const paidRuns = new Set<string>();
    let expectedMapId = meta.mapId;
    let inspection: MuseImage | undefined;
    publish();
    try {
      for (let index = 0; index <= 12; index++) {
        controller.signal.throwIfAborted(); setPhase(index ? "Muse is reviewing the action result…" : "Muse is thinking…");
        const requestContext = latest.current.bridge.context();
        if (requestContext.mapId !== expectedMapId || requestContext.mapUnavailable) throw Error("The selected map changed or closed. Send a new message to work on the current map.");
        if (inspection && JSON.stringify(inspection.area) !== JSON.stringify((requestContext.polygon as { area?: unknown } | undefined)?.area)) inspection = undefined;
        const response = await fetch("/api/map-agent/step", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ model, messages: history, context: requestContext, inspection, final: index === 12 }) });
        const data = await response.json(); controller.signal.throwIfAborted(); meta.requests++; meta.usage = data.usage; reply.requestId = data.requestId;
        if (!response.ok) throw Error(data.error ?? "Muse chat failed.");
        if (data.model !== model) throw Error("Muse returned a different model than the selected one.");
        if (!data.call) { if (typeof data.text !== "string" || !data.text.trim()) throw Error("Muse returned an empty reply."); reply.text = data.text; meta.status = "completed"; publish(); return; }
        if (latest.current.bridge.context().mapId !== expectedMapId) throw Error("The selected map changed while Muse was thinking. No new action was applied.");
        if (JSON.stringify(latest.current.bridge.context().polygon) !== JSON.stringify(requestContext.polygon)) throw Error("The polygon changed while Muse was thinking. Send a new message for the new selection.");
        const call: MapAgentCall = validateMapAgentCall({ action: data.call.action, parameters: data.call.parameters });
        const step: AgentChatMeta["steps"][number] = { ...call, at: new Date().toISOString(), status: "running" }; meta.steps.push(step); setPhase(`Muse · ${call.action.replaceAll("_", " ")}…`); publish();
        history.push({ role: "assistant", content: data.text || null, tool_calls: [{ id: data.call.id, type: "function", function: { name: "map_action", arguments: JSON.stringify(call) } }] });
        let result: unknown;
        try {
          if (["run_sam", "run_muse", "detect_crowns"].includes(call.action)) {
            if (paidRuns.has(call.action)) throw Error("This paid operation was already attempted in this message. Send a new message to run it again.");
            paidRuns.add(call.action);
          }
          const output = await latest.current.bridge.execute(call, controller.signal, model);
          controller.signal.throwIfAborted();
          if (call.action === "open_map") { expectedMapId = String(latest.current.bridge.context().mapId); inspection = undefined; }
          else if (latest.current.bridge.context().mapId !== expectedMapId) throw Error("The map changed during the action. Send a new message for the current map.");
          if (call.action === "inspect_area") {
            inspection = output as MuseImage; result = { ok: true, message: "Original selected-polygon image supplied for inspection.", source: inspection.source, width: inspection.width, height: inspection.height };
          } else result = { ok: true, output };
          step.status = "completed";
        } catch (e) { controller.signal.throwIfAborted(); result = { ok: false, error: e instanceof Error ? e.message : "Map action failed." }; step.status = "error"; }
        step.result = result; publish();
        history.push({ role: "tool", tool_call_id: data.call.id, content: JSON.stringify(result).slice(0, 24000) });
      }
      throw Error("Muse reached the action limit for this message. Completed changes are retained.");
    } catch (e) {
      meta.status = controller.signal.aborted ? "cancelled" : "error";
      for (const step of meta.steps) if (step.status === "running") { step.status = "error"; step.result = { error: "Cancelled; completed changes are retained." }; }
      reply.text = controller.signal.aborted ? "Stopped. Completed map changes are retained." : e instanceof Error ? e.message : "Muse chat failed."; publish();
    } finally { if (pending.current === controller) { pending.current = null; setPhase(""); } }
  };
  return { model, modelChoice, setModel, configured, phase, busy: !!phase, send, cancel };
}
export type MapChatController = ReturnType<typeof useMapChat>;
