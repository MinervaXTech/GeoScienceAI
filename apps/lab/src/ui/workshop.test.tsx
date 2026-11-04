import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentCommand, ideLink, WorkshopView, workshopPrompt } from "./WorkshopView";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const hyp = (id: string, status = "untested", extra: Record<string, unknown> = {}) => ({ id, statement: `Claim ${id}`, test: `Test ${id}`, success: `Bar ${id}`, status, evidence: [], ...extra });
const base = { id: "ws-20261104100000-aaaa", title: "ACO study", goal: "Can ACO go to the real world?", createdAt: "2026-11-04T02:00:00.000Z", replication: { rating: "Early attempt", verified: 0, total: 17, coveragePercent: 69 }, nextSteps: [], repos: [{ title: "me/aco-dwa", url: "https://github.com/me/aco-dwa", meta: "12 stars" }], experiments: [], log: [{ at: "2026-11-04T02:00:00.000Z", by: "app", message: "Workshop created from a Descendance report." }] };
function stub(over: Record<string, unknown> = {}) {
  const calls: { path: string; body?: unknown }[] = []; let workshop = { ...base, status: "ready", hypotheses: [hyp("H1"), hyp("H2", "supported", { evidence: ["E1"] })], ...over };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path: url, ...(body ? { body } : {}) });
    if (url === "/api/workshop/status") return Response.json({ mcp: { command: "node", args: ["--experimental-strip-types", "/app/server/workshopMcp.ts"], env: { WORKSHOP_ROOT: "/app/workshops" } } });
    if (url === "/api/workshop") return Response.json({ workshops: [workshop] });
    if (url === `/api/workshop/${base.id}`) return Response.json({ workshop, codeDirectory: "/w/ws-1/code", files: over.files ?? [] });
    if (url === `/api/workshop/${base.id}/init`) { over.files = [{ path: "README.md", bytes: 10, modified: "2026-11-04T03:00:00.000Z" }]; return Response.json({ workshop, result: { created: ["README.md", "experiments/h1.py", "baseline/impl.py"], skipped: [], baseline: over.noBaseline ? null : { from: "x", files: 1, skipped: 0 } } }); }
    if (url === `/api/workshop/${base.id}/hypotheses`) { workshop = { ...workshop, hypotheses: body.hypotheses.map((h: Record<string, string>, i: number) => hyp(h.id ?? `H${i + 9}`, "untested", { statement: h.statement, test: h.test, success: h.success })) }; return Response.json({ workshop }); }
    return Response.json({ error: "unexpected" }, { status: 404 });
  }));
  return calls;
}
describe("WorkshopView", () => {
  it("says there are none yet, and where to start one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ workshops: [] }))); render(<WorkshopView />);
    expect(await screen.findByText(/Start a workshop at its end/)).toBeTruthy();
  });
  it("shows the baseline, the hypotheses with their status, the folder, the leads and the log, and no editor", async () => {
    stub(); render(<WorkshopView openId={base.id} />);
    expect(await screen.findByText("Claim H1")).toBeTruthy(); expect(screen.getByText("Untested")).toBeTruthy(); expect(screen.getByText("Supported")).toBeTruthy(); expect(screen.getByText(/Evidence: E1/)).toBeTruthy();
    expect(screen.getByText(/0 of 17 results verified against the paper/)).toBeTruthy(); expect(screen.getByText(/treat the method as unverified/)).toBeTruthy();
    expect(screen.getByText("/w/ws-1/code")).toBeTruthy(); expect(screen.getByRole("link", { name: "me/aco-dwa" })).toBeTruthy(); expect(screen.getByText(/Workshop created from a Descendance report/)).toBeTruthy();
    expect(screen.getByText(/No experiment recorded yet/)).toBeTruthy(); expect(screen.getByText(/There is no editor here/)).toBeTruthy();
  });
  it("copies the code folder path", async () => {
    stub(); const writeText = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText } }); render(<WorkshopView openId={base.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy code folder path" })); await waitFor(() => expect(writeText).toHaveBeenCalledWith("/w/ws-1/code"));
  });
  it("opens the folder in VS Code or Cursor from a link, and copies a command that starts Codex or Claude Code there with the prompt", async () => {
    stub(); const writeText = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText } }); render(<WorkshopView openId={base.id} />);
    expect((await screen.findByRole("link", { name: "VS Code" }) as HTMLAnchorElement).getAttribute("href")).toBe("vscode://file/w/ws-1/code"); expect((screen.getByRole("link", { name: "Cursor" }) as HTMLAnchorElement).getAttribute("href")).toBe("cursor://file/w/ws-1/code");
    fireEvent.click(screen.getByRole("button", { name: "Copy for Codex" })); await waitFor(() => expect(writeText).toHaveBeenCalledWith(agentCommand("codex", "/w/ws-1/code", base.id)));
    fireEvent.click(screen.getByRole("button", { name: "Copy for Claude Code" })); await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(agentCommand("claude", "/w/ws-1/code", base.id)));
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" })); await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(workshopPrompt(base.id)));
    expect(await screen.findByText("Prompt copied.")).toBeTruthy();
  });
  it("builds links and commands that survive spaces and quotes in the folder path", () => {
    expect(ideLink("vscode", "/Users/me/My Lab/workshops/ws-1/code")).toBe("vscode://file/Users/me/My%20Lab/workshops/ws-1/code");
    const command = agentCommand("codex", "/Users/me/It's here/code", "ws-20261104100000-aaaa"); expect(command.startsWith("cd '/Users/me/It'\\''s here/code' && codex '")).toBe(true);
    expect(command).toContain("Work workshop ws-20261104100000-aaaa using the workshop tools. Start with workshop_get_brief."); expect(command).toContain("Never report a value you did not measure.");
    expect(agentCommand("claude", "/f", "ws-1").startsWith("cd '/f' && claude '")).toBe(true);
  });
  it("edits the hypothesis text, adds one and removes one, then saves", async () => {
    const calls = stub(); render(<WorkshopView openId={base.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit hypotheses" }));
    fireEvent.change(screen.getAllByLabelText("Claim")[0]!, { target: { value: "Reworded claim" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Add a hypothesis" })); fireEvent.change(screen.getAllByLabelText("Claim")[1]!, { target: { value: "A new claim" } });
    fireEvent.click(screen.getByRole("button", { name: "Save hypotheses" }));
    await waitFor(() => expect(calls.find(c => c.path.endsWith("/hypotheses"))?.body).toEqual({ hypotheses: [{ id: "H1", statement: "Reworded claim", test: "Test H1", success: "Bar H1" }, { statement: "A new claim", test: "", success: "" }] }));
    expect(await screen.findByText("Reworded claim")).toBeTruthy();
  });
  it("shows the connect guide for the workshop server, the live code folder, and the experiments an agent recorded", async () => {
    stub({ files: [{ path: "src/planner.py", bytes: 2048, modified: "2026-11-04T03:00:00.000Z" }], experiments: [{ id: "E1", hypothesisId: "H1", summary: "30 missions with noise", metric: "completion", value: "17/30", by: "agent", at: "2026-11-04T03:00:00.000Z" }] }); render(<WorkshopView openId={base.id} />);
    expect(await screen.findByText("src/planner.py")).toBeTruthy(); expect(screen.getByText(/2\.0 KB/)).toBeTruthy(); expect(screen.getByText("completion: 17/30")).toBeTruthy(); expect(screen.getByText("Agent (reported)")).toBeTruthy();
    expect(screen.getByText(/claude mcp add workshop -e WORKSHOP_ROOT=\/app\/workshops -- node --experimental-strip-types \/app\/server\/workshopMcp\.ts/)).toBeTruthy(); expect(screen.getByText(/codex mcp add workshop/)).toBeTruthy(); expect(screen.getByText(/Work workshop ws-20261104100000-aaaa using the workshop tools/)).toBeTruthy();
  });
  it("sets up the code folder from a button, says what it made, and then shows it as done", async () => {
    const calls = stub(); render(<WorkshopView openId={base.id} />);
    const button = await screen.findByRole("button", { name: "Initialize code" }) as HTMLButtonElement; expect(button.disabled).toBe(false); expect(screen.getByText(/Nothing is overwritten and nothing is run/)).toBeTruthy();
    fireEvent.click(button); expect(await screen.findByText("Code folder set up: 3 files, including a baseline copy of 1 replication file.")).toBeTruthy(); expect(calls.some(c => c.path === `/api/workshop/${base.id}/init`)).toBe(true);
    const done = await screen.findByRole("button", { name: "Code initialised" }, { timeout: 4000 }) as HTMLButtonElement; expect(done.disabled).toBe(true); // the page re-reads the folder every two seconds
  });
  it("keeps the set-up button off until the workshop is ready, and off once the folder is set up", async () => {
    stub({ status: "preparing", hypotheses: [] }); const a = render(<WorkshopView openId={base.id} />); expect(((await screen.findByRole("button", { name: "Initialize code" })) as HTMLButtonElement).disabled).toBe(true); a.unmount();
    stub({ files: [{ path: "README.md", bytes: 1, modified: "2026-11-04T03:00:00.000Z" }] }); render(<WorkshopView openId={base.id} />); expect(((await screen.findByRole("button", { name: "Code initialised" })) as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows that Muse is still writing the hypotheses", async () => {
    stub({ status: "preparing", hypotheses: [] }); render(<WorkshopView openId={base.id} />);
    expect(await screen.findByText(/Muse is writing the hypotheses/)).toBeTruthy(); expect(screen.queryByRole("button", { name: "Edit hypotheses" })).toBeNull();
  });
});
