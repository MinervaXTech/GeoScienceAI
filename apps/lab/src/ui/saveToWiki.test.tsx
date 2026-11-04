import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveToKnowledge } from "./SaveToWiki";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
type Copy = { saved: boolean; stale: boolean };
function stub(start: { wiki?: Copy; graph?: Copy } = {}, over: { wikiError?: string; graphError?: string; duplicate?: boolean; replaced?: number; auto?: { wiki: boolean; graph: boolean; quietMinutes: number } } = {}) {
  const state = { wiki: start.wiki ?? { saved: false, stale: false }, graph: start.graph ?? { saved: false, stale: false } }, calls: { path: string; body?: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path: url, ...(body ? { body } : {}) });
    if (url.startsWith("/api/graph-sync/status")) return Response.json({ changedAt: "2026-11-04T05:00:00.000Z", wiki: state.wiki, graph: state.graph, ...(over.auto ? { auto: over.auto } : {}) });
    if (url === "/api/wiki") return Response.json({ folder: "/app/wiki", saved: [] });
    if (url === "/api/wiki/save") { if (over.wikiError) return Response.json({ error: over.wikiError }, { status: 400 }); const was = state.wiki.saved; state.wiki = { saved: true, stale: false }; return Response.json({ folder: "/app/wiki", pages: ["a.md", "index.md", "p.md"], action: was ? "refreshed" : "saved" }); }
    if (url === "/api/graph-sync/graph") { if (over.graphError) return Response.json({ error: over.graphError }, { status: 502 }); state.graph = { saved: true, stale: false }; return Response.json({ entry: { id: "e" }, duplicate: !!over.duplicate, replaced: over.replaced ?? 0 }); }
    return Response.json({ error: "unexpected" }, { status: 404 });
  }));
  return { state, calls };
}
const view = (every = 60000) => render(<SaveToKnowledge kind="exploration" id="desc-1" every={every} />);
describe("SaveToKnowledge", () => {
  it("offers to save when neither copy exists, sends nothing until clicked, and then shows the copy as up to date", async () => {
    const t = stub(); view();
    expect(await screen.findByText(/Nothing is saved until you click/)).toBeTruthy(); expect(screen.getByText(/Nothing goes into the graph until you agree/)).toBeTruthy();
    expect(t.calls.some(c => c.path === "/api/wiki/save" || c.path === "/api/graph-sync/graph")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save to wiki" }));
    expect(await screen.findByText("✓ The wiki page, up to date.")).toBeTruthy(); expect(screen.getByText("Saved in the wiki: 3 pages written.")).toBeTruthy(); expect(t.calls.find(c => c.path === "/api/wiki/save")?.body).toEqual({ kind: "exploration", id: "desc-1" });
    expect(screen.getByRole("button", { name: "Add to knowledge graph" })).toBeTruthy();
  });
  it("says only that both are up to date when nothing changed, without asking for anything", async () => {
    stub({ wiki: { saved: true, stale: false }, graph: { saved: true, stale: false } }); view();
    expect(await screen.findByText("✓ The wiki page, up to date.")).toBeTruthy(); expect(screen.getByText("✓ The knowledge graph entry, up to date.")).toBeTruthy();
    expect(screen.queryByText(/changed after it was saved/)).toBeNull(); expect(screen.queryByRole("button", { name: "Update wiki page" })).toBeNull(); expect(screen.queryByRole("button", { name: "Update in knowledge graph" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Update anyway" })).toHaveLength(2);
  });
  it("flags only the copy that is behind, and asks for the update there", async () => {
    stub({ wiki: { saved: true, stale: true }, graph: { saved: true, stale: false } }); view();
    expect(await screen.findByText(/The wiki page/)).toBeTruthy(); expect(screen.getByText(/has older content: this changed after it was saved/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update wiki page" }).className).toContain("primary"); expect(screen.getByText("✓ The knowledge graph entry, up to date.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update wiki page" })); expect(await screen.findByText("✓ The wiki page, up to date.")).toBeTruthy(); expect(screen.getByText("Refreshed in the wiki: 3 pages written.")).toBeTruthy(); expect(screen.queryByText(/changed after it was saved/)).toBeNull();
  });
  it("says an update will happen by itself, with the quiet time, when auto-sync is on", async () => {
    stub({ wiki: { saved: true, stale: true }, graph: { saved: true, stale: true } }, { auto: { wiki: true, graph: true, quietMinutes: 10 } }); view();
    expect(await screen.findByText(/It will be saved by itself once it has been quiet for 10 minutes\./)).toBeTruthy(); expect(screen.getByText(/It will be added by itself once it has been quiet for 10 minutes\./)).toBeTruthy();
    cleanup(); stub({ wiki: { saved: true, stale: true }, graph: { saved: true, stale: true } }, { auto: { wiki: false, graph: false, quietMinutes: 10 } }); view();
    expect((await screen.findAllByText(/has older content/)).length).toBe(2); expect(screen.queryByText(/by itself/)).toBeNull();
  });
  it("notices a change by itself while the page is open", async () => {
    const t = stub({ wiki: { saved: true, stale: false }, graph: { saved: true, stale: false } }); view(40);
    expect(await screen.findByText("✓ The wiki page, up to date.")).toBeTruthy(); expect(screen.queryByText(/changed after it was saved/)).toBeNull();
    t.state.wiki = { saved: true, stale: true }; t.state.graph = { saved: true, stale: true };
    await waitFor(() => expect(screen.getAllByText(/has older content/)).toHaveLength(2)); expect(screen.getByRole("button", { name: "Update in knowledge graph" }).className).toContain("primary");
  });
  it("asks before it spends Muse calls on the graph, and says it replaces the earlier entry", async () => {
    const t = stub({ wiki: { saved: true, stale: false }, graph: { saved: true, stale: true } }, { replaced: 1 }); view();
    fireEvent.click(await screen.findByRole("button", { name: "Update in knowledge graph" }));
    const box = await screen.findByRole("group", { name: "Confirm adding to the knowledge graph" }); expect(box.textContent).toContain("about three model calls"); expect(box.textContent).toContain("App knowledge"); expect(box.textContent).toContain("not a paper"); expect(box.textContent).toContain("not as verified"); expect(box.textContent).toContain("earlier entry is replaced");
    expect(t.calls.some(c => c.path === "/api/graph-sync/graph")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(screen.queryByRole("group", { name: "Confirm adding to the knowledge graph" })).toBeNull(); expect(t.calls.some(c => c.path === "/api/graph-sync/graph")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Update in knowledge graph" })); fireEvent.click(screen.getByRole("button", { name: "Add to graph" }));
    expect(await screen.findByText(/replacing its earlier version/)).toBeTruthy(); expect(t.calls.find(c => c.path === "/api/graph-sync/graph")?.body).toEqual({ kind: "exploration", id: "desc-1", confirmed: true }); expect(await screen.findByText("✓ The knowledge graph entry, up to date.")).toBeTruthy();
  });
  it("reports an unchanged item and shows why a save was refused", async () => {
    stub({ graph: { saved: true, stale: false } }, { duplicate: true }); const a = view();
    fireEvent.click(await screen.findByRole("button", { name: "Update anyway" })); fireEvent.click(await screen.findByRole("button", { name: "Add to graph" })); expect(await screen.findByText("Already in the knowledge graph, and unchanged.")).toBeTruthy(); a.unmount();
    stub({}, { wikiError: "The exploration has no finished report yet.", graphError: "Muse extraction failed" }); view();
    fireEvent.click(await screen.findByRole("button", { name: "Save to wiki" })); expect(await screen.findByText("The exploration has no finished report yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to knowledge graph" })); fireEvent.click(screen.getByRole("button", { name: "Add to graph" })); expect(await screen.findByText("Muse extraction failed")).toBeTruthy(); expect(screen.getByRole("button", { name: "Add to knowledge graph" })).toBeTruthy();
  });
  it("shows a checking note, not buttons, when the status cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "no" }, { status: 400 }))); view();
    expect((await screen.findAllByText(/Checking the/)).length).toBe(2); expect(screen.queryByRole("button", { name: "Save to wiki" })).toBeNull();
  });
});
