import { describe, expect, it } from "vitest";
import { editMessage, newSession, sendMessage } from "./store";
import { emptyState } from "./types";
import { detectPaper } from "./knowledge";
import { validateMapAgentCall } from "../geo/mapAgent";
import type { Attachment } from "./types";
const attachment = (kind: Attachment["kind"], name: string, text = "Abstract\nIntroduction\nResearch"): Attachment => ({ id: "a", kind, name, mime: kind === "pdf" ? "application/pdf" : "text/plain", size: 50, text });
it("detects PDFs, arXiv/DOI links and two paper markers in body or text files", () => {
  expect(detectPaper({ text: "See file", attachments: [attachment("pdf", "Canopy study.pdf")] })).toMatchObject({ kind: "pdf", title: "Canopy study", source: { attachmentId: "a" } });
  for (const url of ["https://arxiv.org/abs/2601.12345", "https://doi.org/10.1234/paper"]) expect(detectPaper({ text: `Please learn ${url}.` })).toMatchObject({ kind: "url", source: { url } });
  expect(detectPaper({ text: "A study\nAbstract\nReferences" })).toMatchObject({ kind: "text", title: "A study" });
  expect(detectPaper({ text: "", attachments: [attachment("text", "paper.md")] })?.kind).toBe("text");
});
it("does not confuse images, CSV, GeoJSON, ordinary notes or one marker with papers", () => {
  for (const file of [attachment("image", "paper.png"), attachment("text", "rows.csv"), attachment("text", "map.geojson")]) expect(detectPaper({ text: "See attached", attachments: [file] })).toBeNull();
  expect(detectPaper({ text: "Abstract sculpture" })).toBeNull();
  expect(detectPaper({ text: "Count my planning points" })).toBeNull();
});
it("validates capture proposals and read-only knowledge queries with strict arguments", () => {
  expect(validateMapAgentCall({ action: "propose_knowledge_capture", parameters: { attachmentId: "file-1", reason: "Research paper" } }).action).toBe("propose_knowledge_capture");
  expect(validateMapAgentCall({ action: "propose_knowledge_capture", parameters: { url: "https://arxiv.org/abs/2601.12345", reason: "Paper" } }).action).toBe("propose_knowledge_capture");
  expect(validateMapAgentCall({ action: "query_knowledge", parameters: { question: "What method does the paper use?" } }).action).toBe("query_knowledge");
  for (const parameters of [{ reason: "x" }, { attachmentId: "a", url: "https://doi.org/10.1234/a", reason: "x" }, { url: "https://evil.example", reason: "x" }, { attachmentId: "a", reason: "x".repeat(201) }, { attachmentId: "a", reason: "x", confirmed: true }]) expect(() => validateMapAgentCall({ action: "propose_knowledge_capture", parameters })).toThrow();
  for (const parameters of [{ question: "" }, { question: "x".repeat(301) }, { question: "x", store: true }]) expect(() => validateMapAgentCall({ action: "query_knowledge", parameters })).toThrow();
});

it("drops an earlier paper offer when the researcher edits its source text", () => {
  const created = newSession(emptyState()); const state = sendMessage(created.state, created.session.id, "Old study\nAbstract\nReferences");
  const message = state.sessions[0]!.messages[0]!; message.knowledge = { status: "offered", candidate: detectPaper(message)! };
  const edited = editMessage(state, created.session.id, message.id, "New study\nIntroduction\nReferences");
  const current = edited.sessions[0]!.messages[0]!; expect(current.knowledge).toBeUndefined(); expect(detectPaper(current)?.title).toBe("New study");
});

import { cropTitle, paperTitleFromText } from "./knowledge";
describe("paper titles from text", () => {
  it("joins the title lines and stops before the authors", () => {
    expect(paperTitleFromText("Global and local path planning \nof robots combining ACO and \ndynamic window algorithm\nYaping Lu & Chen Da\nAs a key technology, robot path planning", "s41598")).toBe("Global and local path planning of robots combining ACO and dynamic window algorithm");
  });
  it("stops at the abstract and falls back to the filename when nothing looks like a title", () => {
    expect(paperTitleFromText("Canopy height from lidar\nAbstract\nWe study", "file")).toBe("Canopy height from lidar");
    expect(paperTitleFromText("Abstract\nWe study", "file")).toBe("file");
    expect(paperTitleFromText("", "file")).toBe("file");
  });
  it("crops long titles at a word boundary", () => {
    const long = "A very long title about tree crown detection with satellite imagery and deep learning across tropical plantations in Malaysia";
    const cropped = cropTitle(long, 60);
    expect(cropped.length).toBeLessThanOrEqual(60); expect(cropped.endsWith("…")).toBe(true); expect(long.startsWith(cropped.slice(0, -1))).toBe(true);
  });
});

import { inCollection, normalizeCollections } from "./knowledge";
describe("collections", () => {
  it("trims, drops empties and case-insensitive duplicates, and rejects bad names", () => {
    expect(normalizeCollections(["  Canopy   review ", "canopy review", "", "Repro: ACO"])).toEqual(["Canopy review", "Repro: ACO"]);
    expect(normalizeCollections(undefined)).toEqual([]);
    expect(() => normalizeCollections("x")).toThrow(); expect(() => normalizeCollections([1])).toThrow();
    expect(() => normalizeCollections(["x".repeat(61)])).toThrow(); expect(() => normalizeCollections(Array.from({ length: 9 }, (_, i) => `c${i}`))).toThrow();
  });
  it("matches a collection name ignoring case, and matches everything when none is given", () => {
    expect(inCollection({ collections: ["Canopy Review"] }, "canopy review")).toBe(true);
    expect(inCollection({ collections: ["A"] }, "B")).toBe(false); expect(inCollection({}, "B")).toBe(false); expect(inCollection({}, undefined)).toBe(true);
  });
});
