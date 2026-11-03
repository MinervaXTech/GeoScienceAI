// @vitest-environment node
import { expect, it } from "vitest";
import { findPassages, queryTerms } from "./knowledgeRead";
const filler = (n: number) => Array.from({ length: n }, (_, i) => `Background sentence ${i} about unrelated robots and grids.`).join("\n");
const paper = [filler(40), "2 Improved ACO", "Cone pheromone initialization sets tau0 as given by", "τ0 = 0.09 ∗| x − y|len + 1d  (1)", "where len is the path length.", filler(40), "3 Experiments", "We set alpha = 1.0 and beta = 5.0 with 50 ants and 100 iterations.", filler(40)].join("\n");
it("finds the passage for a section name, a parameter question, and an equation number, with exact text and offsets", () => {
  const eq = findPassages(paper, "equation 1 pheromone initialization");
  expect(eq).toHaveLength(1); expect(eq[0]!.text).toContain("τ0 = 0.09 ∗| x − y|len + 1d  (1)"); expect(paper.slice(eq[0]!.from, eq[0]!.to)).toBe(eq[0]!.text);
  expect(findPassages(paper, "Experiments alpha beta ants iterations")[0]!.text).toContain("alpha = 1.0 and beta = 5.0 with 50 ants");
});
it("returns nothing when nothing matches, respects the size cap and keeps reading order", () => {
  expect(findPassages(paper, "zebra quantum")).toEqual([]);
  expect(findPassages(paper, "")).toEqual([]);
  const many = findPassages(paper, "background robots grids sentence", 3000);
  expect(many.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(3000 + 1400);
  expect(many.map(p => p.from)).toEqual([...many.map(p => p.from)].sort((a, b) => a - b));
});
it("turns 'equation N' into the literal PDF marker", () => {
  expect(queryTerms("show equation 3 and eq. (4)").literals).toEqual(["(3)", "(4)"]);
});
it("reports the page of each passage when the saved text has page breaks, and omits it when it has none", () => {
  const body = (n: number) => Array.from({ length: 60 }, (_, i) => `Page ${n} filler sentence ${i} about robots.`).join("\n");
  const paged = [body(1), body(2), `${body(3)}\nThe zebra constant lives here.\n${body(3)}`].join("\n\f\n");
  const hit = findPassages(paged, "zebra constant");
  expect(hit).toHaveLength(1); expect(hit[0]!.text).toContain("zebra constant"); expect(hit[0]!.page).toBe(3);
  expect(findPassages(`${body(1)}\nThe zebra constant lives here.`, "zebra constant")[0]).not.toHaveProperty("page");
});

it("points to the page holding the match when a passage spans two pages", () => {
  const text = ["Page one intro about robots.", "Adaptive factors are defined next.", "\f", "Equation (2) alpha prime is defined here.", "More page two text."].join("\n");
  const hit = findPassages(text, "equation 2");
  expect(hit).toHaveLength(1); expect(hit[0]).toMatchObject({ page: 2, pages: [1, 2] });
});

const lines = (label: string, n = 12) => Array.from({ length: n }, (_, i) => `${label} sentence ${i} with some words about robots.`).join("\n");
it("returns a whole section by its heading and stops at the next major heading", () => {
  const text = ["Title of the paper", "Authors A & B", lines("Opening"), "Introduction", lines("Intro"), "Methods", lines("Method"), "Results", lines("Result"), "Conclusions", lines("Concluding"), "References", lines("Ref")].join("\n");
  const concl = findPassages(text, "the conclusion");
  expect(concl).toHaveLength(1); expect(concl[0]!.text.startsWith("Conclusions\nConcluding sentence 0")).toBe(true); expect(concl[0]!.text).not.toContain("Ref sentence"); expect(concl[0]!.text).toContain("Concluding sentence 11");
  const results = findPassages(text, "Results");
  expect(results[0]!.text.startsWith("Results\nResult sentence 0")).toBe(true); expect(results[0]!.text).not.toContain("Concluding");
  expect(findPassages(text, "Methods section")[0]!.text.startsWith("Methods\nMethod sentence 0")).toBe(true);
});
it("falls back sensibly when a paper has no Abstract or Conclusion heading", () => {
  const text = ["Title of the paper", "Authors A & B", lines("Abstract body"), "Methods", lines("Method"), "Results", lines("Result"), "Discussion", lines("Discuss"), "Methods", lines("Late method"), "Data availability", "Available."].join("\n");
  const abstract = findPassages(text, "abstract");
  expect(abstract[0]!.from).toBe(0); expect(abstract[0]!.text).toContain("Abstract body sentence 11"); expect(abstract[0]!.text).not.toContain("Method sentence");
  const conclusion = findPassages(text, "conclusion");
  expect(conclusion[0]!.text.startsWith("Discussion\nDiscuss sentence 0")).toBe(true); expect(conclusion[0]!.text).not.toContain("Late method");
});
it("does not treat ordinary searches as section requests", () => {
  const text = [lines("Filler", 30), "Methods", "The conclusion drawn from equation (4) is stated here.", lines("More", 30)].join("\n");
  const hit = findPassages(text, "equation 4 conclusion drawn");
  expect(hit[0]!.text).toContain("equation (4)");
});
