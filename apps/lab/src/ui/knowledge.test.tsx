import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import { emptyState, type Message } from "../domain/types";
const agent = { configured: true, model: "muse-spark-1.3" as const, modelChoice: "auto" as const, setModel() {}, phase: "", busy: false, async send() {}, cancel() {} };
const props = { agent, sessionId: "session", onSelect() {}, onNewSession() {}, onRenameSession() {}, onDeleteSession() {}, onMode() {}, onSend() {}, onEditMessage() {}, onSave() {} };
const state = (message: Message) => ({ ...emptyState(), sessions: [{ id: "session", title: "Study", createdAt: "2026-11-03", mode: "take-notes" as const, messages: [message] }] });
const paper: Message = { id: "paper", role: "researcher", text: "Study\nAbstract\nIntroduction\nReferences", createdAt: "2026-11-03" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows a paper-only offer and declining makes no network call", () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network); const changed = vi.fn();
  const { rerender } = render(<ChatPanel {...props} state={state({ ...paper, text: "Count planning points" })} onKnowledgeChange={changed} />);
  expect(screen.queryByLabelText("Paper knowledge offer")).toBeNull();
  rerender(<ChatPanel {...props} state={state(paper)} onKnowledgeChange={changed} />);
  expect(screen.getByLabelText("Paper knowledge offer")).toBeTruthy(); expect(network).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(changed).toHaveBeenLastCalledWith("session", "paper", expect.objectContaining({ status: "declined" })); expect(network).not.toHaveBeenCalled();
});
it("uploads only after confirmation and persists the stored receipt", async () => {
  const network = vi.fn().mockResolvedValue(Response.json({ entry: { id: "paper-123456", status: "stored" } })); vi.stubGlobal("fetch", network); const changed = vi.fn();
  render(<ChatPanel {...props} state={state(paper)} onKnowledgeChange={changed} />);
  expect(network).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Store in knowledge base" }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith("session", "paper", expect.objectContaining({ status: "stored", entryId: "paper-123456" })));
  expect(JSON.parse(network.mock.calls[0]![1].body)).toMatchObject({ confirmed: true, model: "muse-spark-1.3", text: paper.text });
});
it("old, declined and resumed messages never ingest automatically", () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  const declined = { ...paper, knowledge: { status: "declined" as const } };
  const saved = state(declined); saved.sessions[0]!.messages.push({ ...paper, id: "old-pdf", text: "A PDF", attachments: [{ id: "pdf", kind: "pdf", name: "paper.pdf", mime: "application/pdf", size: 200, sha256: "a".repeat(64) }] });
  render(<ChatPanel {...props} state={saved} onKnowledgeChange={() => {}} />);
  expect(screen.getByText("Paper not added to the knowledge base.")).toBeTruthy(); expect(screen.getByLabelText("Choose original paper file")).toBeTruthy(); expect(network).not.toHaveBeenCalled();
});
