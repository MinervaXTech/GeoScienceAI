import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRunningPaperRuns } from "./useRunningPaperRuns";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const Probe = () => <p>running: {useRunningPaperRuns(1000)}</p>;
describe("useRunningPaperRuns", () => {
  it("reports how many runs are working, keeps checking, and stays quiet when the server is unreachable", async () => {
    vi.useFakeTimers(); let running: string[] | "fail" = ["run-a"];
    vi.stubGlobal("fetch", vi.fn(async () => { if (running === "fail") throw new Error("offline"); return Response.json({ running }); }));
    render(<Probe />); await act(async () => { await vi.advanceTimersByTimeAsync(10); }); expect(screen.getByText("running: 1")).toBeTruthy();
    running = ["run-a", "run-b"]; await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(screen.getByText("running: 2")).toBeTruthy();
    running = "fail"; await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(screen.getByText("running: 2")).toBeTruthy();
    running = []; await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(screen.getByText("running: 0")).toBeTruthy();
  });
});

describe("useRunningPaperRuns with working runs", () => {
  it("counts runs the server says are working, including an external agent, and prefers that list", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ running: [], working: [{ id: "run-x", kind: "agent" }, { id: "run-y", kind: "muse" }] })));
    render(<Probe />); await act(async () => { await vi.advanceTimersByTimeAsync(10); }); expect(screen.getByText("running: 2")).toBeTruthy();
  });
});
