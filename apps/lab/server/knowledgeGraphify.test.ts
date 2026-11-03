// @vitest-environment node
import { expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GRAPHIFY_VERSION, paperGraph, validatePaperExtraction } from "./knowledgeExtract";
import { extractPdf, graphifyPython, runProcess } from "./knowledgeGraphify";
it.runIf(!!process.env.GRAPHIFY_TEST_BIN)("validates the pinned schema against real Graphify query, merge and HTML/report exports", async () => {
  const base = await mkdtemp(join(tmpdir(), "graphify-schema-")); const bin = process.env.GRAPHIFY_TEST_BIN!; const signal = AbortSignal.timeout(30000);
  const run = async (args: string[]) => { const result = await runProcess(bin, args, base, signal); expect(result.code, result.stderr).toBe(0); return result; };
  try {
    expect((await run(["--version"])).stdout.trim()).toBe(`graphify ${GRAPHIFY_VERSION}`);
    const data = validatePaperExtraction({ nodes: [{ id: "sam", label: "SAM", type: "method", description: "Segmentation" }, { id: "mask", label: "Mask", type: "result", description: "Canopy mask" }], edges: [{ source: "sam", target: "mask", relation: "produces", quote: "SAM produces masks.", section: "Abstract" }] }, "SAM produces masks.");
    for (const id of ["paper-one", "paper-two"]) { await mkdir(join(base, id, "graphify-out"), { recursive: true }); await writeFile(join(base, id, "graphify-out/graph.json"), JSON.stringify(paperGraph(id, id, [data]))); }
    await run(["query", "SAM", "--graph", "paper-one/graphify-out/graph.json"]);
    await run(["merge-graphs", "paper-one/graphify-out/graph.json", "paper-two/graphify-out/graph.json", "--out", "merged.json"]);
    const merged = JSON.parse(await readFile(join(base, "merged.json"), "utf8")); expect(merged.nodes).toHaveLength(4); expect(merged.links.every((e: { confidence: string }) => e.confidence === "EXTRACTED")).toBe(true);
    await run(["cluster-only", "paper-one", "--no-label"]); await run(["export", "html", "--graph", "paper-one/graphify-out/graph.json"]);
    const exported = JSON.parse(await readFile(join(base, "paper-one/graphify-out/graph.json"), "utf8")); expect(exported.graph.schema_version).toBe(1); expect(exported.graph.graphify_version).toBe(GRAPHIFY_VERSION); expect(exported.links[0].quote).toBe("SAM produces masks."); expect(exported.links[0].paper_id).toBe("paper-one");
    const python = await graphifyPython(bin), pdf = join(base, "probe.pdf");
    const script = "from pypdf import PdfWriter\nfrom pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject\nimport sys\nw=PdfWriter();p=w.add_blank_page(width=600,height=800)\nf=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})\np[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):w._add_object(f)})})\ns=DecodedStreamObject();s.set_data(b'BT /F1 12 Tf 50 700 Td (Abstract: SAM produces masks. Introduction. References.) Tj ET')\np[NameObject('/Contents')]=w._add_object(s)\nw.write(sys.argv[1])";
    expect((await runProcess(python, ["-c", script, pdf], base, signal)).code).toBe(0);
    expect(await extractPdf(bin, pdf, base, signal, runProcess)).toContain("SAM produces masks");
    expect((await readFile(join(base, "paper-one/graphify-out/graph.html"), "utf8")).toLowerCase()).toContain("<html"); expect((await readFile(join(base, "paper-one/graphify-out/GRAPH_REPORT.md"), "utf8")).length).toBeGreaterThan(0);
  } finally { await rm(base, { recursive: true, force: true }); }
}, 30000);
