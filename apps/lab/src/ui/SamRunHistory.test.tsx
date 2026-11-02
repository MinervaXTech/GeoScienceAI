import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { newSamRunLog } from "../geo/samRunLog";
import { SamRunHistory } from "./SamRunHistory";
afterEach(cleanup);
it("offers Use outside the collapsed JSON details and marks the active result", () => {
  const run = newSamRunLog("run-ready", "map-field", "canopy"); run.status = "completed"; run.resultAvailable = true;
  const onUse = vi.fn();
  const { rerender } = render(<SamRunHistory logs={[run]} onUse={onUse} />);
  fireEvent.click(screen.getByRole("button", { name: /Use “canopy” result/ }));
  expect(onUse).toHaveBeenCalledWith("run-ready");
  rerender(<SamRunHistory logs={[run]} activeRunId={run.id} onUse={onUse} />);
  expect((screen.getByRole("button", { name: /Use “canopy” result/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("In use")).toBeTruthy();
});
it("shows a per-run JSON summary with provider evidence and separate decoding counts", () => {
  const run = newSamRunLog("run-fixture", "map-field", "tree");
  run.status = "completed"; run.finishedAt = run.startedAt;
  run.provider.httpStatus = 200; run.provider.eventCount = 2; run.provider.outputTextLength = 180;
  run.decoding.status = "completed"; run.decoding.masks = 2; run.decoding.displayedSegments = 1; run.decoding.clippedAway = 1;
  render(<SamRunHistory logs={[run]} />);
  expect(screen.getByText("completed · 2 masks → 1 segment")).toBeTruthy();
  const shown = JSON.parse(screen.getByLabelText("JSON summary for run-fixture").textContent!);
  expect(shown.provider.httpStatus).toBe(200); expect(shown.decoding.clippedAway).toBe(1);
  expect(screen.getByRole("button", { name: "Download log JSON" })).toBeTruthy();
});
it("shows failures as failures rather than zero-mask completed runs", () => {
  const run = newSamRunLog("run-failed", "map-field", "tree");
  run.status = "error"; run.error = { stage: "decode", message: "Unexpected output" };
  render(<SamRunHistory logs={[run]} />);
  expect(screen.getByText("error · decode")).toBeTruthy();
  expect(screen.queryByText(/completed · 0 masks/)).toBeNull();
});
