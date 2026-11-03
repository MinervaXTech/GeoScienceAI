import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperRunView } from "./PaperRunView";
import { clock, filterRuns, filtersActive, mcpSnippets, NO_FILTERS, repairsDone, statusTone, tokenShare } from "./paperRunUi";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mcp = { command: "node", args: ["--experimental-strip-types", "/Users/me/My Lab/server/paperrunMcp.ts"], env: { PAPERRUN_ROOT: "/Users/me/My Lab/paperruns", PAPERRUN_PYTHON: "/py/bin/python" } };
const paper = { id: "paper-0001", title: "ACO study", source: "x", sha256: "h", addedAt: "2026-11-03T00:00:00Z", models: ["m"], status: "stored" };
const stages = ["Spec and assumptions", "Write code", "Run tests", "Repair", "Review", "Report"].map((name, i) => ({ name, status: i < 2 ? "done" : "pending", ...(i === 1 ? { note: "2 file(s)" } : {}) }));
const baseRun = { id: "run-20261103141600-ab12", paperId: "paper-0001", title: "ACO study", mode: "muse", status: "repairing", createdAt: "2026-11-03T06:16:00.000Z", updatedAt: "2026-11-03T06:17:00.000Z", model: "muse-wonder-1.0", rounds: { max: 4, used: 2 }, tokens: { cap: 400000, used: 120000 }, stages, results: [{ id: "R1", description: "iterations", reported: "23rd iteration", reproduced: "24", relError: 0.044, tolerance: 0.1, status: "within_tolerance", note: "mean of 30 seeds" }, { id: "R2", description: "accuracy", reported: "94.64%", reproduced: "", tolerance: 0, status: "not_run", note: "" }] };
function stubApi(overrides: { run?: Record<string, unknown>; ready?: boolean; report?: string | null; active?: boolean; eventAgeSeconds?: number; extraRuns?: Record<string, unknown>[]; working?: unknown[]; environments?: unknown[] } = {}) {
  const run = { ...baseRun, ...overrides.run }; const calls: { method: string; path: string; body?: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET", path = url.split("?")[0]!, body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ method, path, ...(body ? { body } : {}) });
    if (path === "/api/knowledge") return Response.json({ entries: [paper] });
    if (path === "/api/environments") return Response.json({ environments: overrides.environments ?? [] });
    if (path === "/api/paperrun/status") return Response.json({ root: "/r", ready: overrides.ready ?? true, problem: overrides.ready === false ? "The PaperRun Python environment is missing. Run: npm run paperrun:setup (in apps/lab)." : null, configured: true, mcp, running: [], working: overrides.working ?? [] });
    if (path === "/api/paperrun") return Response.json({ runs: [run, ...(overrides.extraRuns ?? [])] });
    if (path === "/api/paperrun/start") return Response.json({ run: { ...run, id: "run-20261103150000-cd34", status: body.mode === "external" ? "waiting_external" : "queued", mode: body.mode } });
    if (/\/file$/.test(path)) return Response.json({ path: url, content: url.includes("brief.md") ? "TASK: Re-implement" : "stderr text" });
    if (/\/handover$/.test(path)) return Response.json({ run: { ...run, id: "run-20261103160000-ee55", mode: "external", status: "waiting_external", parentId: run.id }, directory: "/r/run-20261103160000-ee55", mcp });
    if (/\/(cancel|run-tests|finish)$/.test(path)) return Response.json({ ok: true });
    if (path.startsWith("/api/paperrun/run-")) return Response.json({ run, events: [{ at: new Date(Date.now() - (overrides.eventAgeSeconds ?? 10) * 1000 - 20000).toISOString(), kind: "created", message: "Started with Muse" }, { at: new Date(Date.now() - (overrides.eventAgeSeconds ?? 10) * 1000).toISOString(), kind: "muse", message: "repair round 1: 9000 tokens" }], files: [{ path: "impl.py", bytes: 120 }], gaps: [{ id: "G8", kind: "figure_only", impact: "high", description: "Obstacle layouts exist only in figures." }], report: overrides.report ?? null, active: overrides.active ?? true, directory: "/r/" + run.id });
    return Response.json({ error: "unexpected" }, { status: 404 });
  }));
  return calls;
}
describe("PaperRun helpers", () => {
  it("maps statuses to tones and computes the token share", () => {
    expect(["done", "match", "within_tolerance", "running", "failed", "mismatch", "waiting_external", "not_run"].map(statusTone)).toEqual(["ok", "ok", "ok", "busy", "bad", "bad", "idle", "idle"]);
    expect(tokenShare({ cap: 400000, used: 100000 })).toBe(25); expect(tokenShare({ cap: 10, used: 99 })).toBe(100); expect(tokenShare({ cap: 0, used: 0 })).toBe(0);
  });
  it("writes registration commands for Claude Code, Codex and Cursor, quoting paths with spaces", () => {
    const [claude, codex, json] = mcpSnippets(mcp);
    expect(claude!.text).toBe("claude mcp add paperrun -e PAPERRUN_ROOT='/Users/me/My Lab/paperruns' -e PAPERRUN_PYTHON=/py/bin/python -- node --experimental-strip-types '/Users/me/My Lab/server/paperrunMcp.ts'");
    expect(codex!.text).toBe("codex mcp add paperrun --env PAPERRUN_ROOT='/Users/me/My Lab/paperruns' --env PAPERRUN_PYTHON=/py/bin/python -- node --experimental-strip-types '/Users/me/My Lab/server/paperrunMcp.ts'");
    expect(JSON.parse(json!.text)).toEqual({ mcpServers: { paperrun: { command: "node", args: mcp.args, env: mcp.env } } });
  });
});
describe("run filters", () => {
  const mk = (id: string, title: string, mode: "muse" | "external", createdAt: string, summary?: string) => ({ id, title, mode, createdAt, ...(summary ? { summary } : {}) });
  const now = Date.parse("2026-11-03T12:00:00");
  const runs = [mk("run-a", "ACO path planning", "muse", "2026-11-03T09:00:00", "17 not comparable"), mk("run-b", "ACO path planning", "external", "2026-11-02T10:00:00"), mk("run-c", "Canopy height review", "muse", "2026-10-20T10:00:00"), mk("run-d", "Crown detection", "external", "2026-09-01T10:00:00")];
  it("filters by name, id or summary, by who ran it, and by a date range or one exact day", () => {
    expect(filterRuns(runs, NO_FILTERS, now)).toHaveLength(4);
    expect(filterRuns(runs, { ...NO_FILTERS, q: "  canopy " }, now).map(r => r.id)).toEqual(["run-c"]); expect(filterRuns(runs, { ...NO_FILTERS, q: "RUN-B" }, now).map(r => r.id)).toEqual(["run-b"]); expect(filterRuns(runs, { ...NO_FILTERS, q: "not comparable" }, now).map(r => r.id)).toEqual(["run-a"]);
    expect(filterRuns(runs, { ...NO_FILTERS, type: "external" }, now).map(r => r.id)).toEqual(["run-b", "run-d"]); expect(filterRuns(runs, { ...NO_FILTERS, type: "muse", q: "aco" }, now).map(r => r.id)).toEqual(["run-a"]);
    expect(filterRuns(runs, { ...NO_FILTERS, range: "today" }, now).map(r => r.id)).toEqual(["run-a"]); expect(filterRuns(runs, { ...NO_FILTERS, range: "7d" }, now).map(r => r.id)).toEqual(["run-a", "run-b"]); expect(filterRuns(runs, { ...NO_FILTERS, range: "30d" }, now).map(r => r.id)).toEqual(["run-a", "run-b", "run-c"]);
    expect(filterRuns(runs, { ...NO_FILTERS, day: "2026-11-02" }, now).map(r => r.id)).toEqual(["run-b"]); expect(filterRuns(runs, { ...NO_FILTERS, day: "2026-11-02", range: "today" }, now).map(r => r.id)).toEqual(["run-b"]);
    expect(filterRuns(runs, { ...NO_FILTERS, q: "zzz" }, now)).toEqual([]);
  });
  it("knows when any filter is on", () => { expect(filtersActive(NO_FILTERS)).toBe(false); expect([{ ...NO_FILTERS, q: " " }, { ...NO_FILTERS, type: "muse" as const }, { ...NO_FILTERS, range: "7d" as const }, { ...NO_FILTERS, day: "2026-11-02" }].map(filtersActive)).toEqual([false, true, true, true]); });
});
describe("liveness helpers", () => {
  it("counts repair rounds from the record, falling back to an estimate for older runs, and formats a clock", () => {
    expect(repairsDone({ rounds: { max: 6, used: 7, repairs: 3 } })).toBe(3); expect(repairsDone({ rounds: { max: 4, used: 7 } })).toBe(4); expect(repairsDone({ rounds: { max: 2, used: 1 } })).toBe(0); expect(repairsDone({ rounds: { max: 2, used: 0 } })).toBe(0);
    expect([0, 5, 65, 600, 3725].map(clock)).toEqual(["0:00", "0:05", "1:05", "10:00", "62:05"]); expect(clock(-3)).toBe("0:00");
  });
});
describe("PaperRunView", () => {
  it("starts a Muse run with the chosen rounds, token cap and model, and shows live progress and results", async () => {
    const calls = stubApi(); render(<PaperRunView />);
    await screen.findByRole("option", { name: "ACO study" });
    expect((screen.getByLabelText("Repair rounds") as HTMLSelectElement).value).toBe("4"); expect((screen.getByLabelText("Token cap") as HTMLSelectElement).value).toBe("400000");
    fireEvent.change(screen.getByLabelText("Repair rounds"), { target: { value: "2" } }); fireEvent.change(screen.getByLabelText("Token cap"), { target: { value: "150000" } }); fireEvent.change(screen.getByLabelText("Muse model"), { target: { value: "muse-spark-1.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Start PaperRun" }));
    await waitFor(() => expect(calls.find(c => c.path === "/api/paperrun/start")?.body).toEqual({ paper: "paper-0001", mode: "muse", rounds: 2, tokenCap: 150000, model: "muse-spark-1.3", envPolicy: { pick: false, create: false } }));
    await screen.findByText("Tokens 120,000 of 400,000"); expect(screen.getByText("Repair rounds 1 of 4")).toBeTruthy();
    const results = screen.getByRole("table"); expect(within(results).getByText("Within tolerance")).toBeTruthy(); expect(within(results).getByText("Not run")).toBeTruthy(); expect(within(results).getByText("4.4%")).toBeTruthy();
    expect(screen.getByText(/Statuses are computed by the app/)).toBeTruthy(); expect(screen.getByRole("list", { name: "Run log" }).textContent).toContain("repair round 1: 9000 tokens");
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" })); await waitFor(() => expect(calls.some(c => c.method === "POST" && c.path.endsWith("/cancel"))).toBe(true));
  });
  it("explains a missing sandbox environment and blocks starting a Muse run, but still lets you prepare an external one", async () => {
    stubApi({ ready: false }); render(<PaperRunView />);
    expect((await screen.findByRole("alert")).textContent).toContain("npm run paperrun:setup");
    expect((screen.getByRole("button", { name: "Start PaperRun" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/An external agent/)); expect((screen.getByRole("button", { name: "Prepare run for an agent" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByLabelText("Repair rounds")).toBeNull();
  });
  it("prepares a run for an external agent, shows how to connect it, and drives its tests and finish from the app", async () => {
    const calls = stubApi({ run: { status: "waiting_external", mode: "external", results: undefined, rounds: { max: 4, used: 0 } } }); const writeText = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<PaperRunView />); await screen.findByRole("option", { name: "ACO study" });
    fireEvent.click(screen.getByLabelText(/An external agent/)); fireEvent.click(screen.getByRole("button", { name: "Prepare run for an agent" }));
    await waitFor(() => expect(calls.find(c => c.path === "/api/paperrun/start")?.body).toMatchObject({ mode: "external", paper: "paper-0001" }));
    await screen.findByText("Connect your coding agent"); expect(screen.getByText("Waiting for your agent", { selector: ".pr-head .pr-chip" })).toBeTruthy();
    expect(screen.getByText(/claude mcp add paperrun/)).toBeTruthy(); expect(screen.getByText(/codex mcp add paperrun/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]!); await waitFor(() => expect(writeText.mock.calls[0]![0]).toContain("claude mcp add paperrun")); await screen.findByText("Claude Code command copied.");
    fireEvent.click(screen.getByRole("button", { name: "Copy brief" })); await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("TASK: Re-implement"));
    fireEvent.click(screen.getByRole("button", { name: "Run tests now" })); await waitFor(() => expect(calls.some(c => c.path.endsWith("/run-tests"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Finish run" })); await waitFor(() => expect(calls.find(c => c.path.endsWith("/finish"))?.body).toEqual({ summary: "Finished from the app." }));
    fireEvent.click(screen.getByRole("button", { name: "impl.py" })); await screen.findByText("stderr text");
  });
  it("summarises what ran with two numbers, the status split and the main concerns, and offers to assess method coverage", async () => {
    const calls = stubApi({ run: { status: "done", rounds: { max: 4, used: 3 }, stepCount: 4, review: "[high] Eq. 1 was altered.\n[low] minor\n[high] Seeds repeat.\n[high] Step 13 is partial.\n[high] Fourth." }, active: false });
    render(<PaperRunView />); fireEvent.click(await screen.findByRole("button", { name: /ACO study/ }));
    const card = await screen.findByRole("region", { name: "Replication summary" });
    expect(card.textContent).toContain("Muse wrote 1 file and ran the tests 3 times (2 repair rounds)."); expect(card.textContent).toContain("50%of reported results within 10% of the paper (1 of 2)");
    expect(card.textContent).toContain("?of the method implemented, not assessed yet"); expect(card.textContent).toContain("100% of the 1 comparable results are within 10% of the paper (1 of 1)."); expect(card.textContent).toContain("Method coverage has not been assessed, so the method cannot be rated yet.");
    expect(within(card).getByText("Not rated yet")).toBeTruthy(); expect(within(card).getByText("How this is rated")).toBeTruthy(); expect(within(card).getByText("What to do next")).toBeTruthy();
    expect(card.textContent).toContain("Assess method coverage with Muse, so the rating can use how much of the method is really implemented.");
    expect(screen.getByRole("img", { name: "0 match, 1 within tolerance, 0 mismatch, 0 not comparable, 1 not run" })).toBeTruthy();
    const concerns = card.querySelector(".pr-concerns")!; expect(within(concerns as HTMLElement).getAllByText(/Eq\. 1 was altered\.|Seeds repeat\.|Step 13 is partial\./)).toHaveLength(3); expect(card.textContent).toContain("1 more in the report.");
    fireEvent.click(within(card).getByRole("button", { name: "Assess method coverage with Muse" })); await waitFor(() => expect(calls.some(c => c.method === "POST" && c.path.endsWith("/assess"))).toBe(true));
  });
  it("shows a working run is alive: current step, time in it, the latest log line and a moving bar, and keeps the list in step with the detail", async () => {
    const started = new Date(Date.now() - 95_000).toISOString(), recent = new Date(Date.now() - 12_000).toISOString();
    stubApi({ run: { status: "repairing", createdAt: new Date(Date.now() - 300_000).toISOString(), updatedAt: recent, rounds: { max: 4, used: 5, repairs: 2 }, stages: stages.map(s => s.name === "Repair" ? { ...s, status: "running", startedAt: started } : s) }, active: true });
    render(<PaperRunView />); fireEvent.click(await screen.findByRole("button", { name: /ACO study/ }));
    const banner = (await screen.findByText("Repairing: Repair", { selector: "strong" })).closest(".pr-activity") as HTMLElement;
    expect(banner.querySelector(".pr-activity-bar")).not.toBeNull(); expect(banner.textContent).toMatch(/1:3\d in this step/); expect(banner.textContent).toMatch(/5:0\d since the run started/); expect(banner.textContent).toContain("Latest: repair round 1: 9000 tokens"); expect(banner.textContent).toContain("A Muse reply can take a minute");
    expect(screen.queryByText(/Nothing new for/)).toBeNull(); expect(screen.getByText("Repair rounds 2 of 4")).toBeTruthy();
    expect(screen.getAllByText("Repairing")).toHaveLength(2);
  });
  it("warns when a working run has shown nothing new for a long time, and shows no banner for a finished run", async () => {
    const old = new Date(Date.now() - 15 * 60_000).toISOString();
    stubApi({ run: { status: "running", createdAt: old, updatedAt: old }, active: true, eventAgeSeconds: 15 * 60 });
    render(<PaperRunView />); fireEvent.click(await screen.findByRole("button", { name: /ACO study/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nothing new for 1[5-9] minutes\. It may be stuck/); cleanup();
    stubApi({ run: { status: "done" }, active: false }); render(<PaperRunView />); fireEvent.click(await screen.findByRole("button", { name: /ACO study/ })); await screen.findByRole("region", { name: "Replication summary" });
    expect(document.querySelector(".pr-activity")).toBeNull();
  });
  it("tells Muse runs from external-agent runs with a clear badge in the list and the header, and shows when an agent is working", async () => {
    const recent = new Date().toISOString();
    stubApi({ run: { status: "done", mode: "muse", title: "Muse run" }, extraRuns: [{ id: "run-20261103090000-aaaa", paperId: "paper-0001", title: "Agent run", mode: "external", status: "waiting_external", createdAt: recent, updatedAt: recent, model: "m", rounds: { max: 0, used: 1 }, tokens: { cap: 5, used: 0 }, stages }], working: [{ id: "run-20261103090000-aaaa", title: "Agent run", kind: "agent", status: "waiting_external" }] });
    render(<PaperRunView />); const museRow = (await screen.findByRole("button", { name: /Muse run/ })), agentRow = screen.getByRole("button", { name: /Agent run/ });
    expect(museRow.querySelector(".pr-mode.muse")?.textContent).toBe("Muse"); expect(agentRow.querySelector(".pr-mode.external")?.textContent).toBe("External agent"); expect(museRow.className).toContain("muse"); expect(agentRow.className).toContain("external");
    expect(within(agentRow).getByText("Agent working")).toBeTruthy(); expect(within(museRow).queryByText("Agent working")).toBeNull(); expect(within(museRow).getByText("Done")).toBeTruthy();
    fireEvent.click(agentRow); await waitFor(() => expect(document.querySelector(".pr-head .pr-mode")).not.toBeNull());
  });
  it("filters the runs list by name, type and date and says how many are shown", async () => {
    const day = (iso: string) => ({ createdAt: iso, updatedAt: iso, model: "m", rounds: { max: 0, used: 0 }, tokens: { cap: 5, used: 0 }, stages, paperId: "paper-0001" });
    stubApi({ run: { title: "Alpha ACO", mode: "muse", ...day("2026-11-03T08:00:00") }, extraRuns: [{ id: "run-20261102090000-bbbb", title: "Beta Canopy", mode: "external", status: "done", ...day("2026-11-02T08:00:00") }, { id: "run-20260901090000-cccc", title: "Gamma Crowns", mode: "external", status: "done", ...day("2026-09-01T08:00:00") }] });
    render(<PaperRunView />); await screen.findByText("Alpha ACO"); expect(screen.getByText("Showing 3 of 3")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search runs"), { target: { value: "canopy" } }); expect(screen.getByText(/Showing 1 of 3/)).toBeTruthy(); expect(screen.queryByText("Alpha ACO")).toBeNull(); expect(screen.getByText("Beta Canopy")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" })); expect(screen.getByText("Showing 3 of 3")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Run type"), { target: { value: "external" } }); expect(screen.getByText(/Showing 2 of 3/)).toBeTruthy(); expect(screen.queryByText("Alpha ACO")).toBeNull();
    fireEvent.change(screen.getByLabelText("Run on date"), { target: { value: "2026-09-01" } }); expect(screen.getByText(/Showing 1 of 3/)).toBeTruthy(); expect(screen.getByText("Gamma Crowns")).toBeTruthy(); expect((screen.getByLabelText("Run date") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Search runs"), { target: { value: "nothing like this" } }); expect(screen.getByText("No runs match these filters.")).toBeTruthy();
  });
  it("offers approved environments when starting a run, sends the chosen ones, and shows the environments a run used", async () => {
    const e = (id: string, name: string, status: string, origin = "digitised") => ({ id, name, status, origin, kind: "fixed", rows: 24, cols: 24, version: 1, source: { note: "n" }, targets: [], dynamicObstacles: [], assumptions: [], solvable: true, checkNotes: [], description: "", hash: "h", ascii: ["...", "...", "..."] });
    const calls = stubApi({ environments: [e("env-a-1111", "Fig 9 simple", "approved"), e("env-b-2222", "Random 20", "approved", "generated-from-description"), e("env-c-3333", "Waiting map", "candidate")], run: { status: "done", environments: [{ id: "env-a-1111", name: "Fig 9 simple", version: 1, status: "approved", origin: "digitised", source: "x" }, { id: "env-c-3333", name: "Waiting map", version: 1, status: "candidate", origin: "generated-from-description", source: "y" }] }, active: false });
    render(<PaperRunView />);
    expect(screen.queryByText("Fig 9 simple")).toBeNull();
    const button = await screen.findByRole("button", { name: /^Environments/ }); expect(button.textContent).toContain("none chosen");
    fireEvent.click(button);
    const library = await screen.findByRole("region", { name: "Environment library" });
    expect(within(library).getByText("Waiting map")).toBeTruthy(); expect(within(library).getAllByLabelText("Use in the next run")).toHaveLength(2);
    fireEvent.click(within(library).getAllByLabelText("Use in the next run")[0]!); fireEvent.click(within(library).getAllByLabelText("Use in the next run")[1]!);
    expect(button.textContent).toContain("2 chosen");
    fireEvent.click(screen.getByRole("button", { name: "Start PaperRun" }));
    await waitFor(() => expect(calls.find(c => c.path === "/api/paperrun/start")?.body).toMatchObject({ environments: ["env-a-1111", "env-b-2222"] }));
    fireEvent.click(await screen.findByRole("button", { name: /ACO study/ })); const used = await screen.findByLabelText("Run environments");
    expect(within(used).getByText(/Fig 9 simple/)).toBeTruthy(); expect(used.textContent).toContain("the paper's own"); expect(within(used).getByText("Candidate")).toBeTruthy();
  });
  it("sends what the user leaves to the agent when starting a run", async () => {
    const calls = stubApi({ environments: [{ id: "env-a-1111", name: "Fig 9 simple", status: "approved", origin: "digitised", kind: "fixed", rows: 24, cols: 24, version: 1, source: { note: "n" }, targets: [], dynamicObstacles: [], assumptions: [], solvable: true, checkNotes: [], description: "", hash: "h", ascii: ["..."] }] });
    render(<PaperRunView />); const button = await screen.findByRole("button", { name: /^Environments/ });
    fireEvent.click(button); fireEvent.click(await screen.findByLabelText(/Allow agent choose suitable map/)); fireEvent.click(screen.getByLabelText(/Extend or create environment options/));
    expect(button.textContent).toContain("agent picks · may create");
    fireEvent.click(screen.getByRole("button", { name: /Start PaperRun/ }));
    await waitFor(() => expect(calls.find(c => c.path === "/api/paperrun/start")?.body).toMatchObject({ envPolicy: { pick: true, create: true } }));
  });
  it("shows the environments a run uses under its title and lets them be changed", async () => {
    const e = (id: string, name: string) => ({ id, name, status: "approved", origin: "digitised", kind: "fixed", rows: 24, cols: 24, version: 1, source: { note: "n" }, targets: [], dynamicObstacles: [], assumptions: [], solvable: true, checkNotes: [], description: "", hash: "h", ascii: ["...", "...", "..."] });
    const calls = stubApi({ environments: [e("env-a-1111", "Fig 9 simple"), e("env-b-2222", "Fig 9 maze")], run: { status: "done", environments: [{ id: "env-a-1111", name: "Fig 9 simple", version: 1, status: "approved", origin: "digitised", source: "x" }] }, active: false });
    render(<PaperRunView />); fireEvent.click(await screen.findByRole("button", { name: /ACO study/ }));
    const box = await screen.findByLabelText("Run environments"); expect(within(box).getByText(/Fig 9 simple/)).toBeTruthy();
    fireEvent.click(within(box).getByRole("button", { name: "Change" }));
    const simple = within(box).getByLabelText(/Fig 9 simple/) as HTMLInputElement, maze = within(box).getByLabelText(/Fig 9 maze/) as HTMLInputElement; expect(simple.checked).toBe(true); expect(maze.checked).toBe(false);
    fireEvent.click(simple); fireEvent.click(maze); fireEvent.click(within(box).getByLabelText(/Allow agent choose suitable map/)); fireEvent.click(within(box).getByLabelText(/Extend or create environment options/)); fireEvent.click(within(box).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(calls.find(c => c.method === "POST" && c.path.endsWith("/environments"))?.body).toEqual({ environments: ["env-b-2222"], policy: { pick: true, create: true } }));
  });
  it("gives a verdict, the reasons and prioritised next steps, and can continue repair or copy the steps", async () => {
    const calls = stubApi({ run: { status: "done", rounds: { max: 4, used: 3 }, stepCount: 4, results: [{ id: "R1", description: "a", reported: "10", reproduced: "12", relError: 0.2, tolerance: 0.1, status: "mismatch", note: "" }, { id: "R2", description: "b", reported: "5", reproduced: "5", relError: 0, tolerance: 0.1, status: "match", note: "" }, { id: "R3", description: "c", reported: "7", reproduced: "", tolerance: 0, status: "not_run", note: "" }], stepCoverage: [{ n: 1, status: "implemented", note: "" }, { n: 2, status: "partial", note: "Eq. 1 altered." }, { n: 3, status: "missing", note: "Skipped." }, { n: 4, status: "partial", note: "Simplified." }], review: "[high] Seeds repeat." }, active: false });
    const writeText = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<PaperRunView />); fireEvent.click(await screen.findByRole("button", { name: /ACO study/ }));
    const card = await screen.findByRole("region", { name: "Replication summary" });
    await waitFor(() => expect(within(card).getByText("Partial replication")).toBeTruthy()); expect(card.textContent).toContain("50% of the method is implemented (1 of 4 steps fully, 2 partly).");
    const steps = within(card).getByText("What to do next").nextElementSibling!; expect(steps.tagName).toBe("OL"); expect(steps.textContent).toContain("Supply the missing data (G8)"); expect(steps.textContent).toContain("Fix 3 steps that are only partly implemented or missing (steps 2, 3, 4)"); expect(steps.textContent).toContain("Resolve this review concern: Seeds repeat."); expect(steps.textContent).toContain("R3 produced no result");
    expect(Array.from(steps.querySelectorAll(".pr-prio")).map(e => e.textContent).slice(0, 4)).toEqual(["high", "high", "high", "medium"]);
    fireEvent.change(within(card).getByLabelText("More repair rounds"), { target: { value: "3" } }); fireEvent.click(within(card).getByRole("button", { name: "Continue repair with Muse" }));
    await waitFor(() => expect(calls.find(c => c.path.endsWith("/continue"))?.body).toEqual({ rounds: 3 }));
    fireEvent.click(within(card).getByRole("button", { name: "Copy next steps" })); await waitFor(() => expect(writeText.mock.calls[0]![0]).toMatch(/^Next steps for PaperRun run-20261103141600-ab12 \(ACO study\), rated "Partial replication":\n1\. \[high\] Supply the missing data/));
  });
  it("hands a finished Muse run to an external agent from the summary card and says what happens", async () => {
    const calls = stubApi({ run: { status: "done", rounds: { max: 4, used: 3 }, stepCount: 2 }, active: false });
    render(<PaperRunView />); fireEvent.click(await screen.findByRole("button", { name: /ACO study/ }));
    const card = await screen.findByRole("region", { name: "Replication summary" });
    expect(card.textContent).toContain("makes a new run with Muse's code, results, review and these next steps copied in"); expect(card.textContent).toContain("This run stays as it is.");
    fireEvent.click(within(card).getByRole("button", { name: "Continue in an external agent" }));
    await waitFor(() => expect(calls.find(c => c.method === "POST" && c.path.endsWith("/handover"))).toBeTruthy());
    await screen.findByText("Handed over. Register the MCP server below if you have not, then ask your agent to work this run.");
  });
  it("offers no Continue button for an external agent's run or one still working", async () => {
    stubApi({ run: { status: "done", mode: "external", stepCount: 1, stepCoverage: [{ n: 1, status: "partial", note: "x" }] }, active: false });
    render(<PaperRunView />); fireEvent.click(await screen.findByRole("button", { name: /ACO study/ })); const card = await screen.findByRole("region", { name: "Replication summary" });
    expect(within(card).queryByRole("button", { name: "Continue repair with Muse" })).toBeNull(); expect(within(card).queryByRole("button", { name: "Continue in an external agent" })).toBeNull(); expect(within(card).getByRole("button", { name: "Copy next steps" })).toBeTruthy();
  });
  it("gives a finished external run a ready prompt to paste into the same agent", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {}); Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    stubApi({ run: { status: "done", mode: "external", stepCount: 1, stepCoverage: [{ n: 1, status: "partial", note: "x" }] }, active: false });
    render(<PaperRunView />); fireEvent.click(await screen.findByRole("button", { name: /ACO study/ })); const card = await screen.findByRole("region", { name: "Replication summary" });
    fireEvent.click(within(card).getByRole("button", { name: "Copy prompt for my agent" }));
    const guide = within(card).getByText("Connect your coding agent").closest("details")!; expect(guide.open).toBe(false); expect(guide.textContent).toContain("Work PaperRun");
    await waitFor(() => expect(writeText.mock.calls[0]![0]).toMatch(/^Continue PaperRun run-\d{14}-[a-f0-9]{4} using the paperrun tools\. Start with paperrun_get_brief[\s\S]*1\. \[/));
  });
  it("shows method coverage once it is assessed, step by step", async () => {
    stubApi({ run: { status: "done", rounds: { max: 4, used: 1 }, stepCount: 4, stepCoverage: [{ n: 1, status: "implemented", note: "" }, { n: 2, status: "partial", note: "Simplified." }, { n: 3, status: "missing", note: "Skipped." }, { n: 4, status: "implemented", note: "" }] }, active: false });
    render(<PaperRunView />); fireEvent.click(await screen.findByRole("button", { name: /ACO study/ }));
    const card = await screen.findByRole("region", { name: "Replication summary" }); expect(card.textContent).toContain("63%of the method implemented (2 of 4 steps, 1 partly)");
    expect(within(card).queryByRole("button", { name: "Assess method coverage with Muse" })).toBeNull();
    fireEvent.click(within(card).getByText("Step by step (2 implemented)")); expect(within(card).getByText(/Step 3: Skipped\./)).toBeTruthy();
  });
  it("shows a finished run's report and saves it to Notes", async () => {
    stubApi({ run: { status: "done", rounds: { max: 4, used: 1 } }, report: "# PaperRun report: ACO study\n\n2 match", active: false });
    const events: CustomEvent[] = []; const listener = (e: Event) => events.push(e as CustomEvent); window.addEventListener("lab-save-note", listener);
    render(<PaperRunView />); fireEvent.click(await screen.findByRole("button", { name: /ACO study/ }));
    await screen.findByText("2 match"); expect(screen.queryByRole("button", { name: "Cancel run" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save report to Notes" })); window.removeEventListener("lab-save-note", listener);
    expect(events[0]!.detail).toMatchObject({ entryId: "paper-0001", label: "PaperRun", title: "PaperRun report: ACO study", body: "# PaperRun report: ACO study\n\n2 match" }); await screen.findByText("Report saved to Notes.");
  });
});
