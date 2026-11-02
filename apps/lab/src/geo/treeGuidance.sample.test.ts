import { expect, it } from "vitest";
import type { CanopyClip } from "./canopy";
import { sampleCanopyHeights } from "./treeGuidance";

const bytes = Uint8Array.from([0, 10, 20, 255]);
const clip = { version: 1, id: "c", dataset: "Meta/WRI CHMv2", width: 2, height: 2, corners: [[103, 2.002], [103.002, 2.002], [103.002, 2], [103, 2]], heightData: { encoding: "uint8-metres-base64", data: btoa(String.fromCharCode(...bytes)) } } as unknown as CanopyClip;
it("reads the CHMv2 height at a point's own lng/lat, and returns null for no-data or outside", () => {
  expect(sampleCanopyHeights(clip, [[103.0005, 2.0015], [103.0015, 2.0015], [103.0005, 2.0005], [103.0015, 2.0005], [104, 3]])).toEqual([0, 10, 20, null, null]);
});
