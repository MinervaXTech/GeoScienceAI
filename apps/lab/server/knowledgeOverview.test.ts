// @vitest-environment node
import { expect, it } from "vitest";
import { paperOverview, type OverviewPaper } from "./knowledgeOverview";
const node = (id: string, label: string, type: string, description = "") => ({ id, label, type, description });
const paper = (id: string, title: string, year: number, nodes: ReturnType<typeof node>[], links: OverviewPaper["graph"]["links"] = []): OverviewPaper => ({ id, title, year, paperType: "method", graph: { nodes, links } });
const a = paper("a", "ACO study", 2025, [node("1", "ACO", "method", "Ant colony"), node("2", "CHMv2", "dataset"), node("3", "Faster convergence", "claim", "Converges quicker"), node("4", "x", "step")], [{ source: "1", target: "3", relation: "supports", confidence: "EXTRACTED", quote: "ACO converges faster." }, { source: "1", target: "2", relation: "outperforms", confidence: "INFERRED" }, { source: "1", target: "2", relation: "uses", confidence: "INFERRED" }]);
const b = paper("b", "DWA study", 2023, [node("1", "Dynamic window", "method"), node("2", "chmv2", "dataset"), node("3", "ACO", "method")]);
it("orders papers by year, groups nodes by type, and keeps only quoted or comparison links", () => {
  const o = paperOverview([a, b]);
  expect(o.papers.map(p => p.title)).toEqual(["DWA study", "ACO study"]);
  expect(Object.keys(o.papers[1]!.byType)).toEqual(["claim", "method", "dataset", "step"]);
  expect(o.papers[1]!.keyLinks.map(l => l.relation)).toEqual(["supports", "outperforms"]);
  expect(o.papers[1]!.keyLinks[0]).toMatchObject({ from: "ACO", to: "Faster convergence", classification: "EXTRACTED", quote: "ACO converges faster." });
});
it("lists shared concepts across papers, ignoring steps, and surfaces comparisons", () => {
  const o = paperOverview([a, b]);
  expect(o.sharedConcepts).toEqual(expect.arrayContaining([expect.objectContaining({ label: "chmv2", papers: ["DWA study", "ACO study"] }), expect.objectContaining({ label: "ACO", type: "method" })]));
  expect(o.comparisons).toEqual([expect.objectContaining({ paper: "ACO study", relation: "outperforms", from: "ACO", to: "CHMv2" })]);
});
it("caps the number of papers and reports what was left out", () => {
  const many = Array.from({ length: 15 }, (_, i) => paper(`p${i}`, `Paper ${i}`, 2000 + i, [node("1", "n", "method")]));
  const o = paperOverview(many);
  expect(o.papers).toHaveLength(12); expect(o).toMatchObject({ omitted: 3 });
  expect(paperOverview([])).toMatchObject({ status: "no_match", papers: [] });
});
