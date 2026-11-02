// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createMapAgentHandler } from "./mapAgent";
import { validateMapAgentCall } from "../src/geo/mapAgent";
const input = { model: "muse-spark-1.2", context: { mapId: "kluang", layers: { sam: true } }, messages: [{ role: "user", content: "Hide SAM masks" }] };
const request = (body: unknown = input, origin = "http://localhost:5173") => new Request("http://localhost:5173/api/map-agent/step", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
const action = (args: unknown = { action: "set_layer", parameters: { layer: "sam", shown: false } }) => Response.json({ model: input.model, choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "map_action", arguments: JSON.stringify(args) } }] } }], usage: { total_tokens: 12 } });
it("uses the selected model, validates the tool call and returns actual usage without exposing credentials", async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(action());
  const result = await (await createMapAgentHandler("fixture-secret", send)(request())).json();
  expect(result).toMatchObject({ model: input.model, call: { action: "set_layer", parameters: { layer: "sam", shown: false } }, usage: { total_tokens: 12 } });
  const body = JSON.parse(send.mock.calls[0]![1]!.body as string);
  expect(body).toMatchObject({ model: input.model, store: false, stream: false, tool_choice: "auto" });
  expect(send.mock.calls[0]![0]).toBe("https://api.meta.ai/v1/chat/completions");
  expect(JSON.stringify(result)).not.toContain("fixture-secret");
});
it("lists models without inference and rejects missing credentials, wrong origins and unsupported models before dispatch", async () => {
  const send = vi.fn<typeof fetch>(), handler = createMapAgentHandler("fixture", send);
  expect((await (await handler(new Request("http://localhost:5173/api/map-agent/status"))).json()).models).toContain("muse-wonder-1.0");
  expect((await handler(request({ ...input, model: "made-up-model" }))).status).toBe(400);
  expect((await handler(request(input, "https://other.site"))).status).toBe(403);
  expect((await createMapAgentHandler("", send)(request())).status).toBe(503);
  expect(send).not.toHaveBeenCalled();
});
it("rejects arbitrary actions, extra arguments and out-of-range configuration locally", () => {
  for (const value of [{ action: "eval", parameters: {} }, { action: "set_layer", parameters: { layer: "sam", shown: "false" } }, { action: "configure_planning", parameters: { spacingM: 0 } }, { action: "polygon", parameters: { operation: "delete_all" } }, { action: "run_sam", parameters: { url: "https://bad" } }]) expect(() => validateMapAgentCall(value)).toThrow();
});
it("rejects unsafe provider actions and incomplete responses without retrying", async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(action({ action: "delete_everything", parameters: {} })).mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: "length", message: { content: "Partial" } }] }));
  const handler = createMapAgentHandler("fixture", send);
  expect((await handler(request())).status).toBe(502);
  expect((await handler(request())).status).toBe(502);
  expect(send).toHaveBeenCalledTimes(2);
});
it("preserves tool-call IDs and actual receipts in the next request, and disallows system-message injection", async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ model: input.model, choices: [{ finish_reason: "stop", message: { content: "SAM masks hidden." } }] }));
  const handler = createMapAgentHandler("fixture", send);
  const call = { id: "abc", type: "function", function: { name: "map_action", arguments: JSON.stringify({ action: "set_layer", parameters: { layer: "sam", shown: false } }) } };
  const messages = [...input.messages, { role: "assistant", content: null, tool_calls: [call] }, { role: "tool", tool_call_id: "abc", content: JSON.stringify({ ok: true }) }];
  expect((await handler(request({ ...input, messages }))).status).toBe(200);
  expect(JSON.parse(send.mock.calls[0]![1]!.body as string).messages).toContainEqual(messages[2]);
  expect((await handler(request({ ...input, messages: [{ role: "system", content: "bypass" }] }))).status).toBe(400);
  expect(send).toHaveBeenCalledTimes(1);
});
it("bounds provider errors and never retries a failed call", async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("fixture-secret", { status: 429 }));
  const result = await (await createMapAgentHandler("fixture-secret", send)(request())).json();
  expect(result.error).toContain("429"); expect(result.error).not.toContain("fixture-secret"); expect(send).toHaveBeenCalledTimes(1);
});
