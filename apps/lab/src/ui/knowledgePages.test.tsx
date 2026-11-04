import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphPage, WikiPage, wikiTarget } from "./KnowledgePages";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const pages = [
  { path: "index.md", title: "Wiki", group: "overview", modified: "2026-11-04T04:00:00.000Z" }, { path: "log.md", title: "Log", group: "overview", modified: "2026-11-04T04:00:00.000Z" },
  { path: "papers/p1.md", title: "Global and local path planning", group: "papers", modified: "2026-11-04T04:00:00.000Z" }, { path: "replications/run-1.md", title: "Replication: ACO (agent run)", group: "replications", modified: "2026-11-04T04:00:00.000Z" }, { path: "workshops/ws-1.md", title: "Workshop: real world", group: "workshops", modified: "2026-11-04T04:00:00.000Z" },
];
const content: Record<string, string> = {
  "index.md": "---\ntype: \"index\"\n---\n\n# Wiki\n\n- [Global paper](papers/p1.md): 1 replication(s)\n- [Outside](https://example.org/x) and [not a page](../secret.md) and [anchor](#top)\n\nSee [log](log.md).\n",
  "papers/p1.md": "---\ntype: \"paper\"\n---\n\n# Global and local path planning\n\n## Replications\n\n- [Replication: ACO](../replications/run-1.md)\n",
  "replications/run-1.md": "# Replication: ACO\n\n| Id | Status |\n|---|---|\n| R1 | not comparable |\n\nBack to [paper](../papers/p1.md).\n", "log.md": "# Log\n\n- saved", "workshops/ws-1.md": "# Workshop: real world\n",
};
function stub(list = pages, over: { fail?: boolean } = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url); if (over.fail) return Response.json({ error: "The wiki is unavailable." }, { status: 500 });
    if (url === "/api/wiki/pages") return Response.json({ folder: "/app/wiki", pages: list });
    const m = /^\/api\/wiki\/page\?path=(.+)$/.exec(url); if (m) { const path = decodeURIComponent(m[1]!); return content[path] ? Response.json({ path, content: content[path] }) : Response.json({ error: "No such page." }, { status: 404 }); }
    return Response.json({ error: "unexpected" }, { status: 404 });
  }));
  return calls;
}
describe("wikiTarget", () => {
  it("resolves relative links inside the wiki and refuses everything else", () => {
    expect(wikiTarget("index.md", "papers/p1.md")).toBe("papers/p1.md"); expect(wikiTarget("papers/p1.md", "../replications/run-1.md")).toBe("replications/run-1.md"); expect(wikiTarget("replications/run-1.md", "../papers/p1.md")).toBe("papers/p1.md"); expect(wikiTarget("papers/p1.md", "../index.md")).toBe("index.md"); expect(wikiTarget("papers/p1.md", "../log.md")).toBe("log.md");
    for (const no of ["https://example.org/x", "mailto:a@b.c", "#top", "/etc/passwd", "../secret.md", "../../x.md", "papers/p1.txt", "papers/a b.md", "javascript:alert(1)", ""]) expect(wikiTarget("index.md", no), no).toBeNull();
  });
});
describe("WikiPage", () => {
  it("lists the pages by group, opens the overview, and hides the machine-readable header", async () => {
    stub(); render(<WikiPage onClose={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Wiki", level: 1 })).toBeTruthy(); expect(screen.queryByText(/type: "index"/)).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Wiki pages" }); for (const h of ["Overview", "Papers", "Replications", "Workshops"]) expect(nav.textContent).toContain(h); expect(nav.textContent).not.toContain("Explorations"); // empty groups are not shown
    expect(screen.getByRole("button", { name: "Wiki" }).getAttribute("aria-current")).toBe("page"); expect(screen.getByText(/5 pages\./)).toBeTruthy(); expect(screen.getByText(/Folder: \/app\/wiki/)).toBeTruthy();
  });
  it("follows links between pages inside the view, and leaves other links alone", async () => {
    const calls = stub(); render(<WikiPage onClose={() => {}} />); await screen.findByRole("heading", { name: "Wiki", level: 1 });
    expect(fireEvent.click(screen.getByRole("link", { name: "Global paper" }))).toBe(false); // the click was taken over, not sent to the browser
    expect(await screen.findByRole("heading", { name: "Global and local path planning", level: 1 })).toBeTruthy(); expect(calls).toContain("/api/wiki/page?path=papers%2Fp1.md");
    fireEvent.click(await screen.findByRole("link", { name: "Replication: ACO" })); expect(await screen.findByRole("cell", { name: "not comparable" })).toBeTruthy(); expect(screen.getByRole("link", { name: "paper" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Wiki" })); await screen.findByRole("heading", { name: "Wiki", level: 1 });
    expect(fireEvent.click(screen.getByRole("link", { name: "Outside" }))).toBe(true); expect(fireEvent.click(screen.getByRole("link", { name: "not a page" }))).toBe(true); expect(fireEvent.click(screen.getByRole("link", { name: "anchor" }))).toBe(true);
    expect(calls.filter(c => c.includes("secret"))).toEqual([]);
  });
  it("opens a page from the list and says when it was written", async () => {
    stub(); render(<WikiPage onClose={() => {}} />); await screen.findByRole("heading", { name: "Wiki", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Workshop: real world" })); expect(await screen.findByRole("heading", { name: "Workshop: real world", level: 1 })).toBeTruthy(); expect(screen.getByText(/workshops\/ws-1\.md · written/)).toBeTruthy();
  });
  it("says when the wiki is empty, when it cannot be read, and closes on request", async () => {
    stub([]); const close = vi.fn(), a = render(<WikiPage onClose={close} />); expect(await screen.findByText(/Nothing in the wiki yet/)).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Close" })); expect(close).toHaveBeenCalledOnce(); a.unmount();
    stub(pages, { fail: true }); render(<WikiPage onClose={() => {}} />); expect((await screen.findByRole("alert")).textContent).toContain("The wiki is unavailable.");
  });
  it("shows a page that changed while it was open", async () => {
    const calls = stub(), view = render(<WikiPage onClose={() => {}} every={40} />); await screen.findByRole("heading", { name: "Wiki", level: 1 });
    content["index.md"] = "# Wiki\n\nA new line the app wrote.\n"; pages[0]!.modified = "2026-11-04T05:00:00.000Z";
    await waitFor(() => expect(screen.getByText("A new line the app wrote.")).toBeTruthy()); expect(calls.filter(c => c.includes("index.md")).length).toBeGreaterThanOrEqual(2); view.unmount();
  });
});
describe("GraphPage", () => {
  const entries = [{ id: "a", status: "stored" }, { id: "b", status: "stored", origin: { kind: "exploration" } }, { id: "c", status: "failed", origin: { kind: "replication" } }, { id: "d", status: "stored", origin: { kind: "workshop" } }];
  function stubGraph(list: unknown[] = entries) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/knowledge" ? Response.json({ entries: list }) : url === "/api/knowledge/merged-graph/graph.json" ? Response.json({ nodes: new Array(838).fill({}), links: new Array(849).fill({}) }) : Response.json({ error: "unexpected" }, { status: 404 })));
  }
  it("shows the whole graph in a frame, with what it holds, and says it is being prepared until the frame has loaded", async () => {
    stubGraph(); render(<GraphPage onClose={() => {}} />);
    expect(await screen.findByText(/3 entries: 1 paper, 2 made by the app from a finished item\. 838 nodes and 849 edges\./)).toBeTruthy(); expect(screen.getByText(/needs an internet connection/)).toBeTruthy();
    const frame = screen.getByTitle("Knowledge graph") as HTMLIFrameElement; expect(frame.getAttribute("src")).toMatch(/^\/api\/knowledge\/merged-graph\/graph\.html\?v=\d+$/); expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(screen.getByRole("status").textContent).toContain("Preparing the graph"); fireEvent.load(frame); expect(screen.queryByRole("status")).toBeNull();
    const link = screen.getByRole("link", { name: "Open in a new tab" }) as HTMLAnchorElement; expect(link.getAttribute("href")).toBe(frame.getAttribute("src")); expect(link.rel).toContain("noopener");
  });
  it("draws it again on request, closes on request, and says when there is nothing to draw", async () => {
    stubGraph(); const close = vi.fn(), a = render(<GraphPage onClose={close} />); const first = ((await screen.findByTitle("Knowledge graph")) as HTMLIFrameElement).getAttribute("src");
    await new Promise(r => setTimeout(r, 5)); fireEvent.click(screen.getByRole("button", { name: "Refresh" })); await waitFor(() => expect((screen.getByTitle("Knowledge graph") as HTMLIFrameElement).getAttribute("src")).not.toBe(first));
    fireEvent.click(screen.getByRole("button", { name: "Close" })); expect(close).toHaveBeenCalledOnce(); a.unmount();
    stubGraph([{ id: "c", status: "failed" }]); render(<GraphPage onClose={() => {}} />); expect(await screen.findByText(/The knowledge graph is empty/)).toBeTruthy(); expect(screen.queryByTitle("Knowledge graph")).toBeNull(); expect(screen.queryByRole("link", { name: "Open in a new tab" })).toBeNull();
  });
});
