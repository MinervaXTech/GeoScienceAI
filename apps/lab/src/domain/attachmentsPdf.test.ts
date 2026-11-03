// @vitest-environment node
import { expect, it } from "vitest";
import { exportJson, saveState } from "./persistence";
import { emptyState, type LabState } from "./types";
import { attachmentFile, attachmentKind, ATTACH_ACCEPT, messageContent, readAttachment } from "./attachments";
it("keeps PDF bytes out of session metadata and accepts up to 25 MB", async () => {
  expect(attachmentKind({ name: "Paper.PDF", type: "" })).toBe("pdf"); expect(ATTACH_ACCEPT).toContain("application/pdf");
  const file = new File(["%PDF-1.4 test"], "paper.pdf", { type: "application/pdf" });
  const metadata = await readAttachment(file, "pdf-test");
  expect(metadata).toMatchObject({ kind: "pdf", name: "paper.pdf", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  expect(metadata).not.toHaveProperty("dataUrl"); expect(metadata).not.toHaveProperty("text"); expect(attachmentFile("pdf-test")).toBe(file);
  expect(JSON.stringify(messageContent("See paper", [metadata]))).toContain("was not read");
  await expect(readAttachment({ name: "big.pdf", type: "application/pdf", size: 26 * 1024 * 1024 } as File, "large")).rejects.toThrow(/25 MB/);
});

it("strips PDF bytes from persisted and exported sessions even if supplied by an import", () => {
  const state: LabState = { ...emptyState(), sessions: [{ id: "s", title: "Paper", mode: "take-notes", createdAt: "2026-11-03", messages: [{ id: "m", role: "researcher", text: "Paper", createdAt: "2026-11-03", attachments: [{ id: "a", kind: "pdf", name: "paper.pdf", mime: "application/pdf", size: 10, dataUrl: "data:application/pdf;base64,AAAA", text: "PDF_BYTES_MUST_NOT_PERSIST", sha256: "a".repeat(64) }] }] }] };
  let saved = ""; saveState(state, { getItem: () => null, setItem: (_key, value) => { saved = value; } });
  for (const json of [saved, exportJson(state)]) { expect(json).not.toContain("data:application/pdf"); expect(json).not.toContain("PDF_BYTES_MUST_NOT_PERSIST"); expect(json).toContain("paper.pdf"); }
});
