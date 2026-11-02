import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createPlanningClusters, DEFAULT_CLUSTER_SETTINGS, type PlanningClusters } from "../geo/planningClusters";
import type { PlanningPoints } from "../geo/planningPoints";
import { usePlanningClusters } from "./usePlanningClusters";
const set: PlanningPoints = { version: 1, mapId: "field", area: { type: "Polygon", coordinates: [[[103, 2], [103.02, 2], [103.02, 2.02], [103, 2.02], [103, 2]]] }, points: Array.from({ length: 101 }, (_, i) => ({ id: `P${i + 1}`, source: "manual", coordinate: [103.001 + i % 20 * .0002, 2.001 + Math.floor(i / 20) * .0002] })), home: [103.001, 2.001], minSpacingM: 4, createdAt: "2026-11-03", sourceResultAt: "" };
class WorkerFixture {
  static all: WorkerFixture[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { WorkerFixture.all.push(this); }
  reply(result: PlanningClusters) { this.onmessage?.({ data: { result } } as MessageEvent); }
}
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); WorkerFixture.all = []; });
it("saves a complete result, restores it without rerunning, and hides it immediately after point edits", () => {
  vi.stubGlobal("Worker", WorkerFixture);
  const generated = createPlanningClusters(set, DEFAULT_CLUSTER_SETTINGS);
  const { result, unmount } = renderHook(() => usePlanningClusters("field", set));
  act(() => result.current.generate());
  act(() => WorkerFixture.all[0]!.reply(generated));
  expect(result.current.result?.clusters).toHaveLength(2);
  expect(result.current.busy).toBe(false);
  unmount();
  const restored = renderHook(({ points }) => usePlanningClusters("field", points), { initialProps: { points: set } });
  expect(restored.result.current.result?.clusters).toEqual(generated.clusters);
  expect(WorkerFixture.all).toHaveLength(1);
  const changed = structuredClone(set); changed.points[0]!.coordinate[0] += .00001;
  restored.rerender({ points: changed });
  expect(restored.result.current.result).toBeNull();
  expect(restored.result.current.stale).toBe(true);
});
it("cancels on changed points and ignores late worker output", () => {
  vi.stubGlobal("Worker", WorkerFixture);
  const { result, rerender } = renderHook(({ points }) => usePlanningClusters("field", points), { initialProps: { points: set } });
  act(() => result.current.generate());
  const worker = WorkerFixture.all[0]!;
  const changed = { ...set, points: set.points.slice(1) };
  rerender({ points: changed });
  expect(worker.terminate).toHaveBeenCalled();
  act(() => worker.reply(createPlanningClusters(set, DEFAULT_CLUSTER_SETTINGS)));
  expect(result.current.result).toBeNull();
  expect(result.current.busy).toBe(false);
});
it("retains the previous complete result when a new run is cancelled or fails", () => {
  vi.stubGlobal("Worker", WorkerFixture);
  const generated = createPlanningClusters(set, DEFAULT_CLUSTER_SETTINGS);
  const { result } = renderHook(() => usePlanningClusters("field", set));
  act(() => result.current.generate()); act(() => WorkerFixture.all[0]!.reply(generated));
  act(() => result.current.generate()); act(() => result.current.cancel());
  expect(result.current.result).toEqual(generated);
  act(() => result.current.generate()); act(() => WorkerFixture.all.at(-1)!.onerror?.());
  expect(result.current.result).toEqual(generated);
  expect(result.current.error).toMatch(/failed/);
});
