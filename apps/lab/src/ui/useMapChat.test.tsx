import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMapChat } from "./useMapChat";
import type { Message, Session } from "../domain/types";
const session: Session = { id: "session", title: "Session", mode: "take-notes", createdAt: "2026-11-02", messages: [] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
it("runs a real action callback, sends its result back, persists the trace, and keeps selected model stable", async () => {
  const calls: unknown[] = [], messages: Message[] = [];
  const transport = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith("/status")) return Response.json({ configured: true });
    calls.push(JSON.parse(init!.body as string));
    return calls.length === 1 ? Response.json({ model: "muse-spark-1.2", call: { id: "1", action: "set_layer", parameters: { layer: "sam", shown: false } } }) : Response.json({ model: "muse-spark-1.2", text: "SAM hidden." });
  }); vi.stubGlobal("fetch", transport);
  const execute = vi.fn().mockResolvedValue({ message: "Applied", context: { layers: { sam: false } } });
  const { result } = renderHook(() => useMapChat({ context: () => ({ mapId: "map" }), execute, cancel() {} }, (_id, msg) => messages.push(msg)));
  await waitFor(() => expect(result.current.configured).toBe(true));
  act(() => result.current.setModel("muse-spark-1.2"));
  await act(() => result.current.send(session, "Hide SAM masks"));
  expect(execute).toHaveBeenCalledTimes(1); expect(execute.mock.calls[0]![2]).toBe("muse-spark-1.2");
  expect(calls[1]).toMatchObject({ model: "muse-spark-1.2", messages: expect.arrayContaining([expect.objectContaining({ role: "tool", tool_call_id: "1", content: expect.stringContaining('"ok":true') })]) });
  expect(messages.at(-1)).toMatchObject({ text: "SAM hidden.", agent: { status: "completed", requests: 2, steps: [{ status: "completed" }] } });
  expect(localStorage.getItem("lab.muse.chatModel")).toBe("muse-spark-1.2");
});
it("never applies a response to a different map selected while Muse was thinking", async () => {
  let mapId = "first"; const execute = vi.fn(), messages: Message[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { if (url.endsWith("/status")) return Response.json({ configured: true }); mapId = "second"; return Response.json({ model: "muse-spark-1.3", call: { id: "1", action: "set_layer", parameters: { layer: "sam", shown: false } } }); }));
  const { result } = renderHook(() => useMapChat({ context: () => ({ mapId }), execute, cancel() {} }, (_id, msg) => messages.push(msg)));
  await act(() => result.current.send(session, "Hide SAM"));
  expect(execute).not.toHaveBeenCalled(); expect(messages.at(-1)?.agent?.status).toBe("error"); expect(messages.at(-1)?.text).toMatch(/map changed/);
});
it("Stop aborts the request and cancels the active map tool without claiming success", async () => {
  const messages: Message[] = [], cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/status")) return Response.json({ configured: true });
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
  }));
  const { result } = renderHook(() => useMapChat({ context: () => ({ mapId: "map" }), execute: vi.fn(), cancel }, (_id, msg) => messages.push(msg)));
  let pending: Promise<void>; act(() => { pending = result.current.send(session, "Analyze"); });
  await waitFor(() => expect(result.current.busy).toBe(true));
  act(() => result.current.cancel()); await act(() => pending!);
  expect(cancel).toHaveBeenCalledTimes(1); expect(messages.at(-1)?.agent?.status).toBe("cancelled"); expect(result.current.busy).toBe(false);
});
it("does not execute a duplicate paid operation in the same message", async () => {
  let calls = 0; const messages: Message[] = [], execute = vi.fn().mockResolvedValue({ done: true });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/status")) return Response.json({ configured: true });
    calls++;
    return Response.json(calls < 3 ? { model: "muse-spark-1.3", call: { id: String(calls), action: "run_sam", parameters: {} } } : { model: "muse-spark-1.3", text: "One SAM run completed." });
  }));
  const { result } = renderHook(() => useMapChat({ context: () => ({ mapId: "map" }), execute, cancel() {} }, (_id, msg) => messages.push(msg)));
  await act(() => result.current.send(session, "Run SAM"));
  expect(execute).toHaveBeenCalledTimes(1);
  expect(messages.at(-1)?.agent?.steps.map(step => step.status)).toEqual(["completed", "error"]);
});


it("Auto selects Wonder for analysis and keeps the same concrete model across actions and review", async () => {
  const calls: { model: string }[] = [], messages: Message[] = [];
  const execute = vi.fn().mockResolvedValue({ done: true });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/status")) return Response.json({ configured: true });
    calls.push(JSON.parse(init!.body as string));
    return Response.json(calls.length === 1 ? { model: "muse-wonder-1.0", call: { id: "1", action: "compare_routes", parameters: {} } } : { model: "muse-wonder-1.0", text: "Routes compared." });
  }));
  const { result } = renderHook(() => useMapChat({ context: () => ({ mapId: "map" }), execute, cancel() {} }, (_id, message) => messages.push(message)));
  expect(result.current.modelChoice).toBe("auto");
  await act(() => result.current.send(session, "Compare planning routes"));
  expect(calls.map(c => c.model)).toEqual(["muse-wonder-1.0", "muse-wonder-1.0"]);
  expect(execute.mock.calls[0]![2]).toBe("muse-wonder-1.0");
  expect(result.current.model).toBe("muse-wonder-1.0");
  expect(messages.at(-1)).toMatchObject({ model: "muse-wonder-1.0", agent: { modelSelection: "auto", status: "completed" } });
  act(() => result.current.setModel("muse-spark-1.3"));
  act(() => result.current.setModel("auto"));
  expect(localStorage.getItem("lab.muse.chatModel")).toBe("auto");
});

it("restores a manual model choice and rejects a mismatched response before executing any action", async () => {
  localStorage.setItem("lab.muse.chatModel", "muse-spark-1.2");
  const messages: Message[] = [], execute = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/status") ? Response.json({ configured: true }) : Response.json({ model: "muse-wonder-1.0", call: { id: "1", action: "fit_area", parameters: {} } })));
  const { result } = renderHook(() => useMapChat({ context: () => ({ mapId: "map" }), execute, cancel() {} }, (_id, message) => messages.push(message)));
  expect(result.current.modelChoice).toBe("muse-spark-1.2");
  await act(() => result.current.send(session, "Analyze this area"));
  expect(execute).not.toHaveBeenCalled();
  expect(messages.at(-1)).toMatchObject({ agent: { model: "muse-spark-1.2", status: "error" } });
});
