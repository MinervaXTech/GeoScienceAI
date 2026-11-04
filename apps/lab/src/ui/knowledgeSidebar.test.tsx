import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { KnowledgeSidebar } from "./KnowledgeSidebar";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const paper = { id: "paper-aaaaaaaa", title: "ACO study", source: "x", sha256: "h", addedAt: "2026-11-03T00:00:00Z", models: ["muse-spark-1.3"], status: "stored", paperType: "method", year: 2025, collections: ["ACO"] };
const made = { id: "report-bbbbbbbb", title: "Exploration: Can ACO go to the real world?", source: "Pasted paper text", sha256: "g", addedAt: "2026-11-04T00:00:00Z", models: ["muse-wonder-1.0"], status: "stored", paperType: "method", year: 2026, origin: { kind: "exploration", id: "desc-20261104100000-aaaa", paperId: "paper-aaaaaaaa" }, collections: ["App knowledge"] };
it("marks entries the app made from its own reports, and keeps paper-only actions off them", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ entries: [paper, made] }))); render(<KnowledgeSidebar />);
  const entry = (await screen.findByText(made.title)).closest("li")!, real = screen.getByText("ACO study").closest("li")!;
  expect(entry.textContent).toContain("made by the app from a saved exploration, not a paper"); expect(entry.textContent).not.toContain("method paper"); expect(entry.textContent).toContain("App knowledge");
  expect(entry.textContent).not.toContain("Reproduction spec"); expect(entry.textContent).toContain("Delete");
  expect(real.textContent).toContain("method paper"); expect(real.textContent).toContain("Reproduction spec"); expect(real.textContent).not.toContain("made by the app");
});
