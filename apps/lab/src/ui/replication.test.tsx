import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplicationPanel } from "./ReplicationPanel";
const entry = { id: "entry-0001", title: "ACO study", source: "x", sha256: "h", addedAt: "2026-11-03T00:00:00Z", models: ["muse-spark-1.3"], status: "stored" as const };
const built = { status: "spec", cached: false, markdown: "# Reproduction spec: ACO study", codexPrompt: "TASK: Re-implement", meta: { model: "muse-wonder-1.0", builtAt: "2026-11-03T10:00:00.000Z" }, usage: { total_tokens: 20000 }, spec: { steps: [1, 2, 3], equations: [1], parameters: [{ verified: true }, { verified: false }], reportedResults: [1, 2], gaps: [{ impact: "high" }, { impact: "low" }, { impact: "high" }] } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("ReplicationPanel", () => {
  it("checks for a saved spec without building, builds only on a click, and then offers Notes and the Codex prompt", async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { const body = JSON.parse(String(init!.body)); calls.push(body); return Response.json(body.peek ? { status: "none", paper: { id: entry.id } } : built); }));
    const writeText = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onSaveNote = vi.fn();
    render(<ReplicationPanel entry={entry} onSaveNote={onSaveNote} />);
    await screen.findByRole("button", { name: "Build reproduction spec" });
    expect(calls).toEqual([{ paper: "entry-0001", peek: true }]);
    fireEvent.change(screen.getByLabelText("Muse model for the spec"), { target: { value: "muse-spark-1.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Build reproduction spec" }));
    await screen.findByText(/3 steps · 1 equations · 2 parameters \(1 not verified\) · 2 results to match · 3 gaps \(2 high impact\)/);
    expect(calls[1]).toEqual({ paper: "entry-0001", model: "muse-spark-1.3" });
    fireEvent.click(screen.getByRole("button", { name: "Save to Notes" }));
    expect(onSaveNote).toHaveBeenCalledWith({ entryId: "entry-0001", paperTitle: "ACO study", label: "Replication", title: "Reproduction spec: ACO study", body: "# Reproduction spec: ACO study" });
    fireEvent.click(screen.getByRole("button", { name: "Copy Codex prompt" })); await waitFor(() => expect(writeText).toHaveBeenCalledWith("TASK: Re-implement"));
    await screen.findByText("Codex prompt copied.");
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" })); await waitFor(() => expect(calls[2]).toEqual({ paper: "entry-0001", model: "muse-spark-1.3", refresh: true }));
  });
  it("shows a saved spec straight away and reports a failed build with a way to retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { const body = JSON.parse(String(init!.body)); return body.peek ? Response.json({ ...built, cached: true }) : Response.json({ error: "Muse ran out of output space" }, { status: 400 }); }));
    render(<ReplicationPanel entry={entry} onSaveNote={() => {}} />);
    await screen.findByText(/3 steps/); expect(screen.queryByRole("button", { name: "Build reproduction spec" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Muse ran out of output space");
    fireEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByRole("button", { name: "Build reproduction spec" });
  });
});
