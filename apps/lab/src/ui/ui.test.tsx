import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { costReadout, LIVE_CONFIG } from "../domain/config";
import { loadSampleData } from "../domain/sample";
import { noFilters } from "../domain/query";
import { emptyState } from "../domain/types";
import { ChatPanel } from "./ChatPanel";
import { NotesView } from "./NotesView";
import { RoadmapCard } from "./RoadmapCard";

afterEach(cleanup);

const agent = { configured: true, model: "muse-spark-1.3" as const, setModel() {}, phase: "", busy: false, async send() {}, cancel() {} };

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
  const props = { state, sessionId: "sample-session-3", onSelect() {}, onNewSession() {}, onMode() {}, onSend() {}, onSave() {} };

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
    const { container } = render(<ChatPanel agent={agent} state={s} sessionId="sample-session-1" onSelect={() => {}} onNewSession={() => {}} onMode={() => {}} onSend={() => {}} onSave={() => {}} />);
    expect(container.textContent).toContain("Citation check: Not run");
    expect(container.querySelector(".verdict")).toBeNull();
  });
});
