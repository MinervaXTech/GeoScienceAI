import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CrownTemplateHistory } from "./CrownTemplateHistory";
import type { CrownTemplateEntry } from "../geo/crownTemplates";
const entry: CrownTemplateEntry = { id: "template-1", selectedAt: "2026-11-02T00:00:00Z", source: "muse", status: "completed", captureKey: "capture-a", thumbnail: "data:image/png;base64,AAAA", sample: { x: 10, y: 20, width: 12, height: 10 }, settings: { threshold: 0.7, spacing: 1, multiScale: true }, round: 2, candidates: 18, addedCandidates: 7, reason: "Try a shaded whole crown." };
afterEach(cleanup);
it("shows the actual selected patch, source, size, outcome and settings with a reusable selection", () => {
  const onUse = vi.fn();
  render(<CrownTemplateHistory entries={[entry]} captureKey="capture-a" selected={entry.sample} busy={false} onUse={onUse} />);
  expect(screen.getByRole("img").getAttribute("src")).toBe(entry.thumbnail);
  expect(screen.getByText("Muse · Round 2")).toBeTruthy();
  expect(screen.getByText(/12 × 10 px · x 10, y 20/)).toBeTruthy();
  expect(screen.getByText(/18 pass candidates · \+7 net new/)).toBeTruthy();
  expect(screen.getByText(/Similarity ≥ 0.70 · Spacing 1.00×/)).toBeTruthy();
  expect(screen.getByText("Selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use template 1" }));
  expect(onUse).toHaveBeenCalledWith(entry.id);
});
it("keeps earlier captures visible but prevents reusing their pixel coordinates or selecting while busy", () => {
  const onUse = vi.fn();
  const { rerender } = render(<CrownTemplateHistory entries={[entry]} captureKey="capture-b" selected={entry.sample} busy={false} onUse={onUse} />);
  const card = screen.getByRole("article", { name: "Template 1" });
  expect(within(card).getByRole("img")).toBeTruthy();
  expect((within(card).getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Earlier capture · preview only")).toBeTruthy();
  expect(screen.queryByText("Selected")).toBeNull();
  rerender(<CrownTemplateHistory entries={[entry]} captureKey="capture-a" selected={null} busy={true} onUse={onUse} />);
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});
it("distinguishes a saved manual selection from a matching result and discloses incomplete recovered settings", () => {
  render(<CrownTemplateHistory entries={[{ ...entry, source: "manual", status: "selected", candidates: undefined, addedCandidates: undefined, settingsRecovered: true }]} captureKey="capture-a" selected={null} busy={false} onUse={() => {}} />);
  expect(screen.getByText("selected")).toBeTruthy();
  expect(screen.queryByText(/pass candidates/)).toBeNull();
  expect(screen.getByText(/Latest saved settings/)).toBeTruthy();
});
