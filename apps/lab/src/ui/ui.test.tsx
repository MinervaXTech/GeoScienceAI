import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { costReadout, LIVE_CONFIG } from "../domain/config";
import { loadSampleData } from "../domain/sample";
import { noFilters } from "../domain/query";
import { emptyState } from "../domain/types";
import { ChatPanel } from "./ChatPanel";
import { NotesView } from "./NotesView";
import { RoadmapCard } from "./RoadmapCard";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const agent = { configured: true, model: "muse-spark-1.3" as const, modelChoice: "muse-spark-1.3" as const, setModel() {}, phase: "", busy: false, async send() {}, cancel() {} };

describe("roadmap", () => {
  it("has no link, input, button or select, so it cannot be activated", () => {
    const { container } = render(<RoadmapCard />);
    expect(container.querySelectorAll("a, input, button, select, textarea")).toHaveLength(0);
    expect(container.textContent).toContain("Export to WikiLLM");
    expect(container.querySelector("[aria-disabled='true']")).not.toBeNull();
  });

  it("stays free of links and inputs inside the Notes tab's batch list", () => {
    const state = loadSampleData(emptyState());
    const { container } = render(
      <NotesView state={state} filters={noFilters()} setFilters={() => {}} sort={undefined} setSort={() => {}} selectedId={undefined} onSelect={() => {}} onNewBatch={() => {}} onReview={() => {}} onLoadSample={() => {}} />,
    );
    const card = container.querySelector(".roadmap")!;
    expect(card.querySelectorAll("a, input, button")).toHaveLength(0);
    expect(card.closest("nav")).not.toBeNull();
  });
});

describe("cost readout", () => {
  it("shows Live calls off while the config is disabled", () => {
    expect(LIVE_CONFIG.enabled).toBe(false);
    expect(costReadout()).toBe("Live calls off");
    expect(costReadout({ enabled: true, callLimit: 10, callsUsed: 3, estimatedUsd: 0.04 })).toBe("Local mode: 3 of 10 calls used, est. USD 0.04");
  });
});

describe("chat on a read-only session", () => {
  const state = loadSampleData(emptyState());
  const props = { state, sessionId: "sample-session-3", onSelect() {}, onNewSession() {}, onRenameSession() {}, onDeleteSession() {}, onMode() {}, onSend() {}, onEditMessage() {}, onSave() {} };

  it("shows no composer, shows verdict chips only for validated messages, and offers Save to notes", () => {
    render(<ChatPanel agent={agent} {...props} />);
    expect(screen.queryByLabelText("Message")).toBeNull();
    expect(screen.getByText("Read-only session")).toBeTruthy();
    expect(screen.getAllByText(/validator verdict/i)).toHaveLength(4);
    // 8 messages: 4 saved (marked), 4 still saveable.
    expect(screen.getAllByRole("button", { name: "Save to notes" })).toHaveLength(4);
    expect(screen.getAllByText(/Saved to/)).toHaveLength(4);
  });

  it("saves from the chooser with the chosen batch and type", () => {
    const calls: unknown[] = [];
    render(<ChatPanel agent={agent} {...props} onSave={(i) => calls.push(i)} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Save to notes" })[0]!);
    const form = screen.getByText("Batch").closest("form")!;
    fireEvent.change(within(form).getByLabelText("Type"), { target: { value: "finding" } });
    fireEvent.change(within(form).getByLabelText("Batch"), { target: { value: "sample-batch-paper-a" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(calls).toEqual([{ sessionId: "sample-session-3", messageId: "sample-msg-3-1", batchId: "sample-batch-paper-a", type: "finding" }]);
  });
});

describe("two axes in the table", () => {
  it("shows the provenance label and the implementation status side by side for a spec-only unit", () => {
    const state = loadSampleData(emptyState());
    render(
      <NotesView state={state} filters={{ ...noFilters(), batch: "sample-batch-paper-a" }} setFilters={() => {}} sort={undefined} setSort={() => {}} selectedId={undefined} onSelect={() => {}} onNewBatch={() => {}} onReview={() => {}} onLoadSample={() => {}} />,
    );
    const row = screen.getByRole("button", { name: "U6 Wind-aware route cost" }).closest("tr")!;
    expect(row.textContent).toContain("Reproduced");
    expect(row.textContent).toContain("Spec only");
    expect(row.textContent).toContain("FAIL");
    // U5 is new and runnable; its check has not run, so it shows the words "Not run" and no chip.
    const u5 = screen.getByRole("button", { name: /U5 2-opt route refinement/ }).closest("tr")!;
    expect(u5.textContent).toContain("New");
    expect(u5.textContent).toContain("Runnable");
    expect(u5.textContent).toContain("Not run");
    expect(u5.querySelector(".verdict")).toBeNull();
  });

  it("shows Not run and no chip for an unvalidated model message", () => {
    const state = loadSampleData(emptyState());
    const s = { ...state, sessions: state.sessions.map((x) => (x.id === "sample-session-1" ? { ...x, messages: [{ ...x.messages[1]!, id: "m-x", validation: undefined }] } : x)) };
    const { container } = render(<ChatPanel agent={agent} state={s} sessionId="sample-session-1" onSelect={() => {}} onNewSession={() => {}} onRenameSession={() => {}} onDeleteSession={() => {}} onMode={() => {}} onSend={() => {}} onEditMessage={() => {}} onSave={() => {}} />);
    expect(container.textContent).toContain("Citation check: Not run");
    expect(container.querySelector(".verdict")).toBeNull();
  });
});


describe("session controls", () => {
  const state = loadSampleData(emptyState());
  const props = { agent, state, sessionId: "sample-session-3", onSelect() {}, onNewSession() {}, onRenameSession() {}, onDeleteSession() {}, onMode() {}, onSend() {}, onEditMessage() {}, onSave() {} };
  it("renames an ended session and requires a second click to delete it", () => {
    const onRenameSession = vi.fn(), onDeleteSession = vi.fn();
    render(<ChatPanel {...props} onRenameSession={onRenameSession} onDeleteSession={onDeleteSession} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename session" }));
    fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "Survey" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(onRenameSession).toHaveBeenCalledWith("sample-session-3", "Survey");
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    expect(onDeleteSession).not.toHaveBeenCalled();
    expect(screen.getByText(/Notes already saved will be kept/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(onDeleteSession).toHaveBeenCalledWith("sample-session-3");
  });
  it("disables management during a run and hides it when there is no session", () => {
    const { rerender } = render(<ChatPanel {...props} agent={{ ...agent, busy: true }} />);
    expect((screen.getByRole("button", { name: "Rename session" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete session" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ChatPanel {...props} state={emptyState()} sessionId={undefined} />);
    expect(screen.queryByRole("button", { name: "Delete session" })).toBeNull();
    expect(screen.getByText(/No session yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /New session/ })).toBeTruthy();
  });
  it("offers Auto alongside manual model choices", () => {
    const setModel = vi.fn();
    render(<ChatPanel {...props} agent={{ ...agent, modelChoice: "auto", setModel }} />);
    expect((screen.getByLabelText("Muse chat model") as HTMLSelectElement).value).toBe("auto");
    fireEvent.change(screen.getByLabelText("Muse chat model"), { target: { value: "muse-wonder-1.0" } });
    expect(setModel).toHaveBeenCalledWith("muse-wonder-1.0");
  });
});


describe("message actions", () => {
  const state = { ...emptyState(), sessions: [{ id: "chat", title: "Survey", createdAt: "2026-11-03T00:00:00Z", mode: "take-notes" as const, messages: [
    { id: "question", role: "researcher" as const, text: "How many planning points here?", createdAt: "2026-11-03T00:00:00Z" },
    { id: "reply", role: "model" as const, text: "**Planning points**\n\n- 42 candidates", createdAt: "2026-11-03T00:00:01Z" },
  ] }] };
  const props = { agent, state, sessionId: "chat", onSelect() {}, onNewSession() {}, onRenameSession() {}, onDeleteSession() {}, onMode() {}, onSend() {}, onEditMessage() {}, onSave() {} };
  it("resizes the chat from the keyboard and by double-click, and toggles full screen", () => {
    const onResize = vi.fn(), onToggleFull = vi.fn();
    const { rerender } = render(<ChatPanel {...props} width={500} onResize={onResize} full={false} onToggleFull={onToggleFull} />);
    const handle = screen.getByRole("separator", { name: "Resize chat" });
    expect(handle.getAttribute("aria-valuenow")).toBe("500");
    fireEvent.keyDown(handle, { key: "ArrowLeft" }); expect(onResize).toHaveBeenLastCalledWith(532);
    fireEvent.keyDown(handle, { key: "ArrowRight" }); expect(onResize).toHaveBeenLastCalledWith(468);
    fireEvent.keyDown(handle, { key: "Home" }); expect(onResize).toHaveBeenLastCalledWith(340);
    fireEvent.doubleClick(handle); expect(onResize).toHaveBeenLastCalledWith(500);
    fireEvent.click(screen.getByRole("button", { name: "Full screen chat" })); expect(onToggleFull).toHaveBeenCalledTimes(1);
    rerender(<ChatPanel {...props} width={500} onResize={onResize} full onToggleFull={onToggleFull} />);
    expect(screen.queryByRole("separator", { name: "Resize chat" })).toBeNull();
    expect(screen.getByRole("button", { name: "Exit full screen chat" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("shows a note as Markdown with a Raw toggle, and docks the detail at the bottom with a vertical resize handle only", () => {
    localStorage.removeItem("lab.notes.detail");
    const state = emptyState(); state.batches.push({ id: "b1", name: "Paper 1 import", kind: "session", source: "s1", createdAt: "2026-11-03T00:00:00Z" });
    state.items.push({ id: "n1", batchId: "b1", type: "note", title: "From the stored paper:", body: "**Main results**\n\n> a quoted line\n\n- first\n- second", review: "pending", citationCheck: "not-run", createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z" } as never);
    render(<NotesView state={state} filters={noFilters()} setFilters={() => {}} sort={undefined} setSort={() => {}} selectedId="n1" onSelect={() => {}} onNewBatch={() => {}} onReview={() => {}} onLoadSample={() => {}} />);
    const detail = screen.getByRole("complementary", { name: "Detail" });
    expect(within(detail).getByText("Main results").tagName).toBe("STRONG"); expect(detail.querySelector("blockquote")).not.toBeNull(); expect(detail.querySelectorAll("li")).toHaveLength(2);
    expect(detail.textContent).not.toContain("**Main results**");
    fireEvent.click(within(detail).getByRole("button", { name: "Raw" })); expect(detail.textContent).toContain("**Main results**"); expect(detail.querySelector("blockquote")).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Preview" })); expect(detail.querySelector("blockquote")).not.toBeNull();
    const handle = within(detail).getByRole("separator", { name: "Resize detail height" });
    expect(handle.getAttribute("aria-orientation")).toBe("horizontal");
    const before = Number(handle.getAttribute("aria-valuenow"));
    fireEvent.keyDown(handle, { key: "ArrowUp" }); expect(Number(within(detail).getByRole("separator").getAttribute("aria-valuenow"))).toBe(before + 32);
    expect(document.querySelector(".notes.dock-bottom")).not.toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Move to side" }));
    expect(document.querySelector(".notes.dock-right")).not.toBeNull(); expect(within(screen.getByRole("complementary", { name: "Detail" })).queryByRole("separator")).toBeNull();
    localStorage.removeItem("lab.notes.detail");
  });
  it("hides and shows the chat settings, and remembers the choice", () => {
    localStorage.removeItem("lab.chat.settingsShown");
    render(<ChatPanel {...props} />);
    const settings = () => document.getElementById("muse-chat-settings")!;
    expect(settings().hidden).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Hide chat settings" }));
    expect(settings().hidden).toBe(true);
    expect(localStorage.getItem("lab.chat.settingsShown")).toBe("false");
    cleanup(); render(<ChatPanel {...props} />);
    expect(settings().hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show chat settings" }));
    expect(settings().hidden).toBe(false);
    localStorage.removeItem("lab.chat.settingsShown");
  });
  it("copies the original message including Markdown, and confirms success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ChatPanel {...props} />);
    const reply = screen.getByText("Planning points").closest("article")!;
    fireEvent.click(within(reply).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(within(reply).getByRole("button", { name: "Copied!" })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith("**Planning points**\n\n- 42 candidates");
  });
  it("offers selectable text when clipboard access fails", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(Error("Denied")) } });
    render(<ChatPanel {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]!);
    await waitFor(() => expect(screen.getByLabelText("Copy message text")).toBeTruthy());
    const fallback = screen.getByLabelText("Copy message text") as HTMLTextAreaElement;
    expect(fallback.value).toBe("How many planning points here?");
    expect(fallback.selectionEnd - fallback.selectionStart).toBe(fallback.value.length);
  });
  it("saves an edit without sending a model request, and can send revised text as a separate turn", () => {
    const onEditMessage = vi.fn(), onSend = vi.fn();
    render(<ChatPanel {...props} onEditMessage={onEditMessage} onSend={onSend} />);
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit message"), { target: { value: "Count the visible points" } });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
    expect(onEditMessage).toHaveBeenCalledWith("chat", "question", "Count the visible points");
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit message"), { target: { value: "Try counting again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send as new message" }));
    expect(onSend).toHaveBeenCalledWith("chat", "Try counting again", true);
    expect(onEditMessage).toHaveBeenCalledTimes(1);
  });
  it("cancels edits, rejects empty text, and leaves ended messages copyable", () => {
    const onEditMessage = vi.fn();
    const { rerender } = render(<ChatPanel {...props} onEditMessage={onEditMessage} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit message"), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Save edit" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onEditMessage).not.toHaveBeenCalled();
    rerender(<ChatPanel {...props} state={{ ...state, sessions: state.sessions.map(s => ({ ...s, endedAt: "2026-11-03T01:00:00Z" })) }} />);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(2);
  });
  it("presents the model guidance as individual bullet points", () => {
    const { container } = render(<ChatPanel {...props} agent={{ ...agent, modelChoice: "auto" }} />);
    const guide = container.querySelector(".muse-model-guide")!;
    expect(within(guide as HTMLElement).getAllByRole("listitem")).toHaveLength(5);
    expect(guide.textContent).toContain("Spark 1.3:");
    expect(guide.textContent).toContain("Segmentation:");
  });
});
