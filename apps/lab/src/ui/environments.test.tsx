import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentsPanel, EnvironmentsSidebar, EnvironmentViewer, EnvPreview } from "./EnvironmentsPanel";
import type { EnvSummary } from "./paperRunUi";
import { CodeSourcesNote } from "./CodeSourcesNote";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const env = (over: Partial<EnvSummary> = {}): EnvSummary => ({ id: "env-simple-aaaa", name: "ACO paper, Simple environment", description: "A simple map.", origin: "digitised", status: "approved", version: 1, hash: "h", source: { paperTitle: "ACO paper", figure: "Fig. 9a", note: "Digitised at 24x24." }, kind: "fixed", rows: 4, cols: 4, start: [0, 0], goal: [3, 3], targets: [], dynamicObstacles: [], assumptions: ["Resolution chosen by me."], solvable: true, checkNotes: ["Leg 1 shortest route: 4.2 cells."], createdBy: "app", createdAt: "2026-11-04T00:00:00Z", ascii: ["....", ".##.", "....", "...."], ...over });
describe("EnvPreview", () => {
  it("draws blocked cells, start and goal for a fixed map", () => {
    const { container } = render(<EnvPreview env={env()} />);
    expect(screen.getByRole("img", { name: "Preview of ACO paper, Simple environment: 4 by 4 cells" })).toBeTruthy(); expect(container.querySelectorAll("rect[fill='#111']")).toHaveLength(2); expect(container.querySelector("circle[fill='#1f77d0']")).not.toBeNull(); expect(screen.getByText(/4×4 cells · blue start, red goal/)).toBeTruthy();
  });
  it("numbers the targets and marks unplanned obstacles, and shows the first random map of a generator", () => {
    const { container } = render(<EnvPreview env={env({ targets: [[0, 0], [3, 0], [3, 3]], dynamicObstacles: [[1.4, 2.0]] })} />);
    expect([...container.querySelectorAll("text")].map(t => t.textContent)).toEqual(["1", "2", "3"]); expect(container.querySelectorAll("rect[fill='#ff9bf2']")).toHaveLength(1); expect(screen.queryByText(/blue start/)).toBeNull(); cleanup();
    const gen = render(<EnvPreview env={env({ kind: "generator", ascii: undefined, rows: 12, cols: 12, generator: { density: 0.2, seedBase: 7, instances: 30, start: [0, 0], goal: [11, 11] } })} />);
    expect(screen.getByText(/Seed 7, one of 30 maps/)).toBeTruthy(); expect(gen.container.querySelectorAll("rect[fill='#111']").length).toBeGreaterThan(5);
  });
});
describe("EnvironmentsPanel", () => {
  it("lists environments with their origin and status, and opens one to show its source, assumptions and checks", () => {
    render(<EnvironmentsPanel environments={[env(), env({ id: "env-b-bbbb", name: "Agent map", origin: "generated-from-description", status: "candidate" })]} onChanged={() => {}} />);
    expect(screen.getByText("2 in the library · 1 waiting for approval")).toBeTruthy(); expect(screen.getByText("Digitised from paper")).toBeTruthy(); expect(screen.getByText("Generated from a loose description")).toBeTruthy(); expect(screen.getByText("Approved")).toBeTruthy(); expect(screen.getByText("Candidate")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /ACO paper, Simple environment/ }));
    expect(screen.getByText(/ACO paper · Fig\. 9a\. Digitised at 24x24\./)).toBeTruthy(); expect(screen.getByText("Resolution chosen by me.")).toBeTruthy(); expect(screen.getByText(/Checks: Leg 1 shortest route/)).toBeTruthy(); expect(screen.getByText(/A fixed 4×4 map · version 1/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
  it("approves a candidate and deletes only after confirming, reporting why a delete is refused", async () => {
    const calls: { method: string; path: string }[] = []; const onChanged = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => { calls.push({ method: init?.method ?? "GET", path }); return init?.method === "DELETE" ? Response.json({ error: "This environment is used by 1 run (run-1)." }, { status: 400 }) : Response.json({ environment: {} }); }));
    render(<EnvironmentsPanel environments={[env({ id: "env-c-cccc", name: "Candidate map", status: "candidate", origin: "generated-from-parameters" })]} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /Candidate map/ })); fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls).toEqual([{ method: "POST", path: "/api/environments/env-c-cccc/approve" }])); expect(onChanged).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete" })); expect(calls).toHaveLength(1); fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect((await screen.findByRole("alert")).textContent).toContain("used by 1 run"); expect(calls[1]).toEqual({ method: "DELETE", path: "/api/environments/env-c-cccc" }); expect(onChanged).toHaveBeenCalledTimes(1);
  });
  it("does not offer to approve an environment that fails its checks, and says when the library is empty", () => {
    render(<EnvironmentsPanel environments={[env({ status: "candidate", solvable: false })]} onChanged={() => {}} />);
    expect(screen.getByText("Failed checks")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: /Simple environment/ })); expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true); cleanup();
    render(<EnvironmentsPanel environments={[]} onChanged={() => {}} />); expect(screen.getByText(/No environments yet/)).toBeTruthy();
  });
});

describe("Environments in the Map tab", () => {
  it("lists the library in the sidebar and hands the chosen environment to the viewer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ environments: [env()] }))));
    const onView = vi.fn(), onOpenMap = vi.fn();
    render(<EnvironmentsSidebar maps={[{ id: "upm", name: "UPM", basemap: "esri" }, { id: "k", name: "Kluang", basemap: "google" }]} currentMapId="upm" viewing={null} onOpenMap={onOpenMap} onView={onView} />);
    fireEvent.click(screen.getByRole("button", { name: /Kluang/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Environment type" }), { target: { value: "all" } });
    fireEvent.click(await screen.findByRole("button", { name: /Simple environment/ }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: "env-simple-aaaa" }));
    fireEvent.click(screen.getByRole("button", { name: /Kluang/ }));
    expect(onOpenMap).toHaveBeenCalledWith("k");
    expect(onView).toHaveBeenLastCalledWith(null);
  });
  it("filters the list by type from a dropdown at the top", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ environments: [env()] }))));
    render(<EnvironmentsSidebar maps={[{ id: "upm", name: "UPM", basemap: "esri" }]} currentMapId="upm" viewing={null} onOpenMap={() => {}} onView={() => {}} />);
    const select = screen.getByRole("combobox", { name: "Environment type" }) as HTMLSelectElement;
    expect(select.value).toBe("maps");
    expect(screen.getByRole("button", { name: /UPM/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Simple environment/ })).toBeNull();
    fireEvent.change(select, { target: { value: "all" } });
    await screen.findByRole("button", { name: /Simple environment/ });
    fireEvent.change(select, { target: { value: "maps" } });
    expect(screen.queryByRole("button", { name: /Simple environment/ })).toBeNull();
    fireEvent.change(select, { target: { value: "digitised" } });
    expect(screen.queryByRole("button", { name: /UPM/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Simple environment/ })).toBeTruthy();
  });
  it("shows a large map with its source and closes back to the map", () => {
    const onClose = vi.fn();
    const { container } = render(<EnvironmentViewer env={env()} onClose={onClose} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(/Source:/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to map" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("CodeSourcesNote", () => {
  const link = { url: "https://github.com/lab/aco", host: "github.com", kind: "repository" as const, ownCode: true, inReferences: false, quote: "q", page: 3 };
  it("lists the authors' repository as a link and says it was not opened", () => {
    render(<CodeSourcesNote sources={{ status: "link", links: [link], statements: [] }} />);
    const a = screen.getByRole("link", { name: "https://github.com/lab/aco" }) as HTMLAnchorElement; expect(a.href).toBe("https://github.com/lab/aco"); expect(a.rel).toContain("noopener");
    expect(screen.getByText(/states where its code is/)).toBeTruthy(); expect(screen.getByText(/likely the authors' own · page 3/)).toBeTruthy(); expect(screen.getByText(/was not opened/)).toBeTruthy();
  });
  it("shows an availability statement, 'none' when nothing is stated, and nothing when there is no information", () => {
    const { container, rerender } = render(<CodeSourcesNote sources={{ status: "on_request", links: [], statements: [{ kind: "on_request", quote: "Code is available on request." }] }} />);
    expect(screen.getByText(/Code available on request/)).toBeTruthy();
    rerender(<CodeSourcesNote sources={{ status: "none", links: [], statements: [] }} />); expect(screen.getByText(/states no code repository/)).toBeTruthy();
    rerender(<CodeSourcesNote />); expect(container.innerHTML).toBe("");
  });
  it("does not make a link out of an unsafe address", () => {
    render(<CodeSourcesNote sources={{ status: "mentioned", links: [{ ...link, url: "javascript:alert(1)", ownCode: false }], statements: [] }} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
