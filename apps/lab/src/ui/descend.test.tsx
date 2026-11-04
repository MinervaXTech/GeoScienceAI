import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DescendView, discussText } from "./DescendView";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const run = { id: "run-20261103141600-ab12", paperId: "paper-0001", title: "ACO study", mode: "muse", status: "done", createdAt: "2026-11-03T06:16:00.000Z", updatedAt: "2026-11-03T06:17:00.000Z" };
const finding = (status: string) => ({ id: "F1", role: "feasibility", question: "Can it run on a robot?", status, finding: "Yes with sensing.", sources: [{ kind: "paper", title: "Path planning by fusing ACO and DWA", year: 2026, url: "https://doi.org/10.1/x", cites: 3 }, { kind: "hn", title: "Robotic ants", year: 2013, url: "https://news.ycombinator.com/item?id=5460921", cites: 7, meta: "7 points, 2 comments" }], evidence: ["R1 within tolerance"], assumptions: ["static terrain"], risks: ["noise"], confidence: "medium" });
function stub(runs: unknown[] = [run]) {
  const calls: { path: string; body?: unknown }[] = [];
  const exploration = { online: true, replication: { rating: "Early attempt", verified: 0, total: 17, coveragePercent: 69 }, id: "desc-20261103000000-aaaa", runId: run.id, title: "ACO study", goal: "Can ACO go to the real world?", model: "muse-wonder-1.0", status: "done", createdAt: "2026-11-03T08:00:00.000Z", tokens: { used: 400, cap: 150000 }, findings: [finding("done")], verdict: "feasible_with_changes", report: "# Feasibility study\n\nPossible with sensing.", nextSteps: [] };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!, body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path, ...(body ? { body } : {}) });
    if (path === "/api/paperrun") return Response.json({ runs });
    if (path === "/api/descend") return Response.json({ configured: true, explorations: [exploration], active: [] });
    if (path === "/api/descend/start") return Response.json({ exploration }, { status: 201 });
    if (path === "/api/workshop/start") return Response.json({ workshop: { id: "ws-20261104100000-aaaa" } }, { status: 201 });
    if (path === `/api/descend/${exploration.id}`) return Response.json({ exploration, active: false });
    return Response.json({ error: "unexpected" }, { status: 404 });
  }));
  return calls;
}
describe("DescendView", () => {
  it("starts an exploration on a finished run and shows the subagents, verdict and report", async () => {
    const calls = stub(); render(<DescendView />);
    const goal = await screen.findByLabelText("What do you want to explore?");
    const start = screen.getByRole("button", { name: "Start exploration" }) as HTMLButtonElement; expect(start.disabled).toBe(true);
    fireEvent.change(goal, { target: { value: "Can ACO go to the real world?" } }); expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await waitFor(() => expect(calls.find(c => c.path === "/api/descend/start")?.body).toEqual({ paperId: "paper-0001", goal: "Can ACO go to the real world?", model: "muse-wonder-1.0", online: true }));
    expect(await screen.findByText("Feasible with changes")).toBeTruthy();
    expect(screen.getByText("feasibility")).toBeTruthy(); expect(screen.getByText("Possible with sensing.")).toBeTruthy();
  });
  it("shows how far the baseline can be trusted, links the sources found online, and opens the report in a chat session", async () => {
    stub(); const discuss = vi.fn(); render(<DescendView onDiscuss={discuss} />);
    fireEvent.click(await screen.findByRole("button", { name: /Exploration of ACO study/ }));
    expect(await screen.findByText(/Treat the method as unverified/)).toBeTruthy(); expect(screen.getByText(/0 of 17 results verified against the paper, method coverage 69%/)).toBeTruthy();
    fireEvent.click(screen.getByText("2 sources found online")); expect(screen.getByText("Hacker News")).toBeTruthy(); expect(screen.getByText(/7 points, 2 comments/)).toBeTruthy(); const link = screen.getByRole("link", { name: "Path planning by fusing ACO and DWA" }) as HTMLAnchorElement; expect(link.href).toBe("https://doi.org/10.1/x"); expect(link.rel).toContain("noopener");
    fireEvent.click(screen.getByRole("button", { name: "Discuss in chat" }));
    expect(discuss).toHaveBeenCalledOnce(); const text = discuss.mock.calls[0]![0] as string; expect(text).toContain("rated \"Early attempt\" (0 of 17 results verified"); expect(text).toContain("treat the method as unverified"); expect(text).toContain("Possible with sensing.");
    expect(discussText({ goal: "g", replication: { rating: "Well replicated", verified: 9, total: 10 }, report: "R".repeat(9000) }).length).toBeLessThan(6600);
  });
  it("ends a finished report with a button that starts a workshop and opens it", async () => {
    const calls = stub(); const open = vi.fn(); render(<DescendView onOpenWorkshop={open} />);
    fireEvent.click(await screen.findByRole("button", { name: /Exploration of ACO study/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Start a workshop" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("ws-20261104100000-aaaa")); expect(calls.find(c => c.path === "/api/workshop/start")?.body).toEqual({ descendId: "desc-20261103000000-aaaa", model: "muse-wonder-1.0" });
  });
  it("lets the user switch online search off for one exploration", async () => {
    const calls = stub(); render(<DescendView />);
    fireEvent.click(await screen.findByLabelText(/Search online/)); fireEvent.change(screen.getByLabelText("What do you want to explore?"), { target: { value: "Can ACO go to the real world?" } });
    fireEvent.click(screen.getByRole("button", { name: "Start exploration" }));
    await waitFor(() => expect(calls.find(c => c.path === "/api/descend/start")?.body).toMatchObject({ online: false }));
  });
  it("asks for a finished run first when there is none, and hides unfinished runs", async () => {
    stub([]); render(<DescendView />);
    expect(await screen.findByText(/Run a replication in the PaperRun tab first/)).toBeTruthy();
  });
  it("offers one entry per paper, builds on its newest run, and will not start while that run is still going", async () => {
    const newer = { ...run, id: "run-20261104000000-aaaa", createdAt: "2026-11-04T00:00:00.000Z", mode: "external", status: "waiting_external" };
    stub([run, newer]); render(<DescendView />);
    expect(await screen.findByText(/latest run of this paper is still going/)).toBeTruthy();
    expect(screen.getAllByRole("option", { name: "ACO study" })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("What do you want to explore?"), { target: { value: "Can ACO go to the real world?" } });
    expect((screen.getByRole("button", { name: "Start exploration" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
