import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSam } from "./useSam";
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("records capture failure in the run log without dispatching inference", async () => {
  const fetch = vi.fn(async (url: string) => Response.json(url === "/api/sam/status" ? { configured: true, lastRunAt: null } : url === "/api/sam/runs" ? { runs: [] } : { result: null }));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useSam("map-field"));
  await waitFor(() => expect(result.current.configured).toBe(true));
  await act(() => result.current.run(async () => { throw Error("Map tiles unavailable"); }));
  expect(result.current.logs[0]).toMatchObject({ mapId: "map-field", status: "error", error: { stage: "capture", message: "Map tiles unavailable" } });
  expect(fetch.mock.calls.some(([url]) => url === "/api/sam/run")).toBe(false);
  expect(result.current.result).toBeNull();
});

it("logs a rejected concept as validation failure without capturing or calling the model", async () => {
  const fetch = vi.fn(async (url: string) => Response.json(url === "/api/sam/status" ? { configured: true, lastRunAt: null } : url === "/api/sam/runs" ? { runs: [] } : { result: null }));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useSam("map-field"));
  await waitFor(() => expect(result.current.configured).toBe(true));
  act(() => result.current.setPrompt("tree, car"));
  const capture = vi.fn();
  await act(() => result.current.run(capture));
  expect(result.current.logs[0]).toMatchObject({ status: "error", error: { stage: "validation" } });
  expect(capture).not.toHaveBeenCalled();
  expect(fetch.mock.calls.some(([url]) => url === "/api/sam/run")).toBe(false);
});

it("defaults to the canopy concept and restores a selected historical result after refresh without inference", async () => {
  const { newSamRunLog } = await import("../geo/samRunLog");
  const { DEFAULT_SAM_CONCEPT } = await import("../geo/sam");
  const oldLog = newSamRunLog("old-positive", "map-field", DEFAULT_SAM_CONCEPT);
  oldLog.status = "completed"; oldLog.finishedAt = oldLog.startedAt; oldLog.resultAvailable = true;
  const latestLog = { ...oldLog, id: "latest-empty", prompt: "tree" };
  const base = { model: "sam-3.1", mapId: "map-field", source: "esri", attribution: "fixture", frame: { width: 8, height: 8, corners: [[101, 3], [102, 3], [102, 2], [101, 2]] }, imageSha256: "fixture", receivedAt: oldLog.finishedAt, durationMs: 1, regions: { type: "FeatureCollection", features: [] } };
  const chosen = { ...base, prompt: DEFAULT_SAM_CONCEPT, objects: 1, runLog: oldLog };
  const latest = { ...base, prompt: "tree", objects: 0, runLog: latestLog };
  const fetch = vi.fn(async (url: string) => Response.json(url === "/api/sam/status" ? { configured: true, lastRunAt: latest.receivedAt } : url === "/api/sam/runs" ? { runs: [latestLog, oldLog] } : url.includes("runId=old-positive") ? { result: chosen } : { result: latest }));
  vi.stubGlobal("fetch", fetch);
  const first = renderHook(() => useSam("map-field"));
  expect(first.result.current.prompt).toBe(DEFAULT_SAM_CONCEPT);
  await waitFor(() => expect(first.result.current.result?.runLog?.id).toBe("latest-empty"));
  await act(() => first.result.current.selectRun("old-positive"));
  expect(first.result.current.result?.objects).toBe(1); expect(first.result.current.shown).toBe(true);
  expect(JSON.parse(localStorage.getItem("lab.sam.selectedRuns")!)["map-field"]).toBe("old-positive");
  first.unmount();
  const refreshed = renderHook(() => useSam("map-field"));
  await waitFor(() => expect(refreshed.result.current.result?.runLog?.id).toBe("old-positive"));
  expect(fetch.mock.calls.some(([url]) => url === "/api/sam/run")).toBe(false);
});
