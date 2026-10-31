import { describe, expect, it } from "vitest";
import { detectPeaks, DEFAULT_PARAMS } from "../../engine/peaks.mjs";
import { compareMetrics, compareUnits } from "./compare";
import { DEFAULT_SNAPSHOT_PARAMETERS, buildSnapshotData, snapshotHash } from "./snapshots";
import { sha256Hex, canonicalJson } from "./hash";
import { loadSampleData } from "./sample";
import { registerSnapshot } from "./store";
import { emptyState } from "./types";
import { PEAKS, RASTER, routeRun } from "../geo/layer";
import recordedA from "../data/full-6__A.json";
import recordedB from "../data/full-6__B.json";

const state = loadSampleData(emptyState());
const units = (n: number) => state.items.filter((i) => i.batchId === "sample-batch-paper-a" && i.type === "unit").slice(0, n);

describe("hash helpers", () => {
  it("matches published SHA-256 test vectors", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });

  it("serialises objects with sorted keys", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: undefined }] })).toBe('{"a":[{"d":1}],"b":1}');
  });
});

describe("snapshot hash", () => {
  const params = DEFAULT_SNAPSHOT_PARAMETERS();
  const base = buildSnapshotData(units(4), params);

  it("is stable across calls and across review changes", () => {
    expect(buildSnapshotData(units(4), DEFAULT_SNAPSHOT_PARAMETERS()).hash).toBe(base.hash);
    const reviewed = units(4).map((u) => ({ ...u, review: "reviewed" as const, updatedAt: "2030-01-01T00:00:00Z" }));
    expect(buildSnapshotData(reviewed, params).hash).toBe(base.hash);
    expect(base.hash).toMatch(/^[0-9a-f]{7}$/);
  });

  it("does not depend on unit order", () => {
    expect(buildSnapshotData([...units(4)].reverse(), params).hash).toBe(base.hash);
  });

  it("changes when a parameter changes", () => {
    const changed = DEFAULT_SNAPSHOT_PARAMETERS();
    changed.detector.minDistanceM = 7;
    expect(snapshotHash(base.units, changed)).not.toBe(base.hash);
  });

  it("changes when the units or an implementation version change", () => {
    expect(buildSnapshotData(units(5), params).hash).not.toBe(base.hash);
    const bumped = base.units.map((u, i) => (i === 0 ? { ...u, implementationVersion: "other-version" } : u));
    expect(snapshotHash(bumped, params)).not.toBe(base.hash);
  });

  it("refuses to register the same units twice", () => {
    const s = loadSampleData(emptyState());
    const once = registerSnapshot(s, "sample-batch-paper-a", "Current units");
    expect(once.item.snapshot?.units).toHaveLength(7);
    expect(once.item).toMatchObject({ review: "pending", citationCheck: "not-run" });
    expect(() => registerSnapshot(once.state, "sample-batch-paper-a", "Again")).toThrow(/already match/);
  });
});

describe("comparison against the recorded runs", () => {
  const sampleA = state.items.find((i) => i.id === "sample-snap-a")!.snapshot!;
  const sampleB = state.items.find((i) => i.id === "sample-snap-b")!.snapshot!;

  it("picks algorithm A and B from the snapshots' units", () => {
    expect(sampleA.route).toBe("A");
    expect(sampleB.route).toBe("B");
  });

  for (const [id, rec] of [["A", recordedA], ["B", recordedB]] as const) {
    it(`reproduces recorded algorithm ${id} exactly: metrics and visiting order`, () => {
      const run = routeRun(id);
      expect(run.version).toBe(rec.algorithm.version);
      expect(PEAKS).toHaveLength(rec.condition.peakCount);
      expect(run.metrics).toEqual(rec.metrics);
      const recordedIds = rec.route.filter((r) => r.kind === "candidate crown peak").map((r) => (r as { id: number }).id);
      expect(run.peakIds).toEqual(recordedIds);
    });
  }

  it("reports metric rows equal to the recorded values, and differences as B minus A", () => {
    const rows = Object.fromEntries(compareMetrics(sampleA, sampleB).map((r) => [r.metric, r]));
    expect(rows["Path length"]).toMatchObject({ a: recordedA.metrics.pathLengthM, b: recordedB.metrics.pathLengthM });
    expect(rows["Path length"]!.difference).toBe(recordedB.metrics.pathLengthM - recordedA.metrics.pathLengthM);
    expect(rows["Turns > 45 deg"]).toMatchObject({ a: recordedA.metrics.turnsOver45Deg, b: recordedB.metrics.turnsOver45Deg });
    expect(rows["Climb (CHMv2 proxy)"]).toMatchObject({ a: recordedA.metrics.heightProxy.climbM, b: recordedB.metrics.heightProxy.climbM });
    expect(rows["Units (total)"]).toMatchObject({ a: 4, b: 6, difference: 2 });
    expect(rows["Runnable units"]).toMatchObject({ a: 4, b: 5, difference: 1 });
  });

  it("marks unit rows same, added and changed", () => {
    const rows = compareUnits(sampleA, sampleB);
    expect(rows.map((r) => r.status)).toEqual(["same", "same", "same", "same", "added", "added"]);
  });

  it("leaves metrics empty for a snapshot with no route", () => {
    const none = buildSnapshotData(units(3));
    const rows = compareMetrics(none, sampleB);
    expect(rows.find((r) => r.metric === "Path length")).toMatchObject({ a: null, difference: null });
  });
});

describe("detector", () => {
  it("regenerates the saved layer from the CHMv2 subset at default parameters", () => {
    const out = detectPeaks(RASTER, DEFAULT_PARAMS);
    expect(out.peaks.map((p) => [p.id, p.row, p.col, p.heightM])).toEqual(PEAKS.map((p) => [p.id, p.row, p.col, p.h]));
  });
});
