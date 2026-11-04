import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoSyncControl, autoLabel } from "./AutoSyncControl";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const base = { activeToday: true, settings: { wiki: true, graph: true, quietMinutes: 10, graphDailyLimit: 20 }, today: { graphAttempts: 3, limit: 20 }, lastScanAt: "2026-11-04T05:00:00.000Z", recent: [{ at: "2026-11-04T04:59:00.000Z", destination: "graph", kind: "exploration", id: "desc-1", result: "replaced" }, { at: "2026-11-04T04:58:00.000Z", destination: "graph", kind: "workshop", id: "ws-1", result: "failed", note: "Muse extraction failed" }], waiting: [{ kind: "workshop", id: "ws-1", title: "Can ACO go to the real world?", destination: "graph", reason: "changed since it was saved", dueAt: "2026-11-04T05:10:00.000Z" }] };
function stub(over: Record<string, unknown> = {}, fail = false) {
  const state = { ...base, ...over } as typeof base, calls: { path: string; body?: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path: url, ...(body ? { body } : {}) });
    if (fail) return Response.json({ error: "Auto-sync failed." }, { status: 500 });
    if (url === "/api/autosync") return Response.json(state);
    if (url === "/api/autosync/settings") { state.settings = { ...state.settings, ...body }; return Response.json({ settings: state.settings }); }
    if (url === "/api/autosync/run") return Response.json({ events: [], waiting: [] });
    return Response.json({ error: "unexpected" }, { status: 404 });
  }));
  return { state, calls };
}
describe("AutoSyncControl", () => {
  it("says how auto-sync is set in the header, and how much is waiting", async () => {
    stub(); render(<AutoSyncControl />);
    expect((await screen.findByLabelText("Auto-sync settings")).textContent).toBe("Auto-sync: on · 1 waiting");
    expect(["on", "wiki only", "graph only", "off"]).toEqual([autoLabel({ wiki: true, graph: true, quietMinutes: 1, graphDailyLimit: 1 }), autoLabel({ wiki: true, graph: false, quietMinutes: 1, graphDailyLimit: 1 }), autoLabel({ wiki: false, graph: true, quietMinutes: 1, graphDailyLimit: 1 }), autoLabel({ wiki: false, graph: false, quietMinutes: 1, graphDailyLimit: 1 })]);
  });
  it("shows what is waiting, what was done lately, and today's use of the daily limit", async () => {
    stub(); render(<AutoSyncControl />); await screen.findByText(/Graph reads today: 3 of 20/);
    const panel = screen.getByRole("group", { name: "Auto-sync" }); expect(panel.textContent).toContain("Can ACO go to the real world?: changed since it was saved, due"); expect(panel.textContent).toContain("Graph replaced: exploration"); expect(panel.textContent).toContain("Graph failed: workshop"); expect(panel.textContent).toContain("Muse extraction failed");
  });
  it("switches the wiki and the graph, the quiet time and the daily limit, one setting at a time", async () => {
    const t = stub(); render(<AutoSyncControl />); await screen.findByText(/Graph reads today/);
    fireEvent.click(screen.getByRole("checkbox", { name: /Knowledge graph/ })); await waitFor(() => expect(t.calls.find(c => c.path === "/api/autosync/settings")?.body).toEqual({ graph: false }));
    await waitFor(() => expect(screen.getByLabelText("Auto-sync settings").textContent).toContain("wiki only"));
    fireEvent.change(screen.getByLabelText("Quiet time"), { target: { value: "30" } }); await waitFor(() => expect(t.calls.filter(c => c.path === "/api/autosync/settings").at(-1)?.body).toEqual({ quietMinutes: 30 }));
    fireEvent.change(screen.getByLabelText("Daily limit of graph reads"), { target: { value: "5" } }); await waitFor(() => expect(t.calls.filter(c => c.path === "/api/autosync/settings").at(-1)?.body).toEqual({ graphDailyLimit: 5 }));
    fireEvent.change(screen.getByLabelText("Daily limit of graph reads"), { target: { value: "500" } }); expect(t.calls.filter(c => c.path === "/api/autosync/settings")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Check now" })); await waitFor(() => expect(t.calls.some(c => c.path === "/api/autosync/run")).toBe(true));
  });
  it("says when the daily limit is reached or an item keeps failing", async () => {
    stub({ waiting: [{ ...base.waiting[0], blocked: "daily limit reached" }] }); const a = render(<AutoSyncControl />); expect((await screen.findByLabelText("Auto-sync settings")).textContent).toContain("daily limit reached"); a.unmount();
    stub({ waiting: [{ ...base.waiting[0], blocked: "failed three times, waits for a change" }] }); render(<AutoSyncControl />); await waitFor(() => expect(screen.getByLabelText("Auto-sync settings").textContent).toContain("needs a look"));
  });
  it("says when nothing changed today, so nothing is pushed", async () => {
    stub({ activeToday: false, waiting: [{ ...base.waiting[0], blocked: "no changes today", dueAt: undefined }] }); render(<AutoSyncControl />);
    expect((await screen.findByLabelText("Auto-sync settings")).textContent).toBe("Auto-sync: on · 1 waiting · idle today"); expect(screen.getByText(/Nothing changed today, so nothing is pushed\./)).toBeTruthy();
    expect(screen.getByLabelText("Auto-sync settings").textContent).not.toContain("needs a look");
  });
  it("says so when auto-sync cannot be reached", async () => {
    stub({}, true); render(<AutoSyncControl />); expect((await screen.findByLabelText("Auto-sync settings")).textContent).toBe("Auto-sync: unavailable"); expect(screen.getByRole("alert").textContent).toContain("Auto-sync failed.");
  });
});
