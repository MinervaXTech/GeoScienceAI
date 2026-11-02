import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Polygon } from "geojson";
import { useCanopy } from "./useCanopy";

const a: Polygon = { type: "Polygon", coordinates: [[[103, 2], [103.01, 2], [103.01, 2.01], [103, 2]]] };
const b: Polygon = { type: "Polygon", coordinates: [[[104, 2], [104.01, 2], [104.01, 2.01], [104, 2]]] };
const response = (area: Polygon) => Response.json({ version: 1, dataset: "Meta/WRI CHMv2", area, imageDataUrl: "data:image/png;base64,fixture", stats: { minimumM: 1, maximumM: 22 } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("automatic canopy loading", () => {
  it("loads the exact polygon automatically and waits until editing is finished", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, options) => response(JSON.parse(options!.body as string).area));
    vi.stubGlobal("fetch", fetch);
    const { result, rerender } = renderHook(({ area, drawing }) => useCanopy(area, true, drawing), { initialProps: { area: a, drawing: true } });
    await new Promise((resolve) => setTimeout(resolve, 300)); expect(fetch).not.toHaveBeenCalled();
    rerender({ area: a, drawing: false });
    await waitFor(() => expect(result.current.clip?.area).toEqual(a));
    expect(fetch.mock.calls[0]![0]).toBe("/api/canopy/window"); expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).area).toEqual(a);
    rerender({ area: b, drawing: false }); expect(result.current.clip).toBeNull();
    await waitFor(() => expect(result.current.clip?.area).toEqual(b));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not let a late response from the previous polygon replace the selected area", async () => {
    let finish!: (value: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockResolvedValueOnce(response(b));
    vi.stubGlobal("fetch", fetch);
    const { result, rerender } = renderHook(({ area }) => useCanopy(area, true, false), { initialProps: { area: a } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ area: b }); await waitFor(() => expect(result.current.clip?.area).toEqual(b));
    await act(async () => { finish(response(a)); });
    expect(result.current.clip?.area).toEqual(b);
  });
  it("reuses its current clip after visibility is toggled and surfaces real loading errors", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response(a)).mockResolvedValueOnce(Response.json({ error: "No range support" }, { status: 422 }));
    vi.stubGlobal("fetch", fetch);
    const { result, rerender } = renderHook(({ area, enabled }) => useCanopy(area, enabled, false), { initialProps: { area: a, enabled: true } });
    await waitFor(() => expect(result.current.clip?.area).toEqual(a));
    rerender({ area: a, enabled: false }); rerender({ area: a, enabled: true });
    await new Promise((resolve) => setTimeout(resolve, 300)); expect(fetch).toHaveBeenCalledTimes(1);
    rerender({ area: b, enabled: true });
    await waitFor(() => expect(result.current.error).toBe("No range support")); expect(result.current.clip).toBeNull();
  });
});
