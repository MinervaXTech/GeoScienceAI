import { describe, expect, it } from "vitest";
import { codeSourcesText, codeStatusText, findCodeSources } from "./codeSources";

const body = (extra: string) => `Abstract\nWe study path planning.\n\n${extra}\n\nConclusion\nDone.\n`;

describe("findCodeSources", () => {
  it("finds the authors' repository and trims the sentence's full stop", () => {
    const c = findCodeSources(body("The source code of our implementation is available at https://github.com/lab/aco-dwa."));
    expect(c.status).toBe("link"); expect(c.links).toEqual([expect.objectContaining({ url: "https://github.com/lab/aco-dwa", host: "github.com", kind: "repository", ownCode: true, inReferences: false })]);
    expect(c.links[0]!.quote).toContain("available at");
  });
  it("accepts a bare host path and an archive, and reads the page from form feeds", () => {
    const c = findCodeSources(`Page one text.\f${body("Code: github.com/lab/aco and the data are on zenodo.org/records/123456, available online.")}`);
    expect(c.links.map(l => l.url)).toEqual(["github.com/lab/aco", "zenodo.org/records/123456"]); expect(c.links.map(l => l.kind)).toEqual(["repository", "archive"]); expect(c.links[0]!.page).toBe(2);
  });
  it("recognises a Zenodo DOI but not other DOIs or journal links", () => {
    expect(findCodeSources(body("Archived at https://doi.org/10.5281/zenodo.123456.")).links).toHaveLength(1);
    expect(findCodeSources(body("See https://doi.org/10.1016/j.robot.2020.103 and https://www.sciencedirect.com/science/article/pii/S0921889020")).status).toBe("none");
  });
  it("does not count links in the reference list as the paper's own code", () => {
    const text = `${body("We compare with a known method.")}\nReferences\n[1] A. Author. Tool. https://github.com/other/tool\n`;
    const c = findCodeSources(text); expect(c.status).toBe("none"); expect(c.links).toEqual([expect.objectContaining({ inReferences: true, ownCode: false })]);
  });
  it("calls a repository mentioned without a code claim 'mentioned', not the authors' own", () => {
    const c = findCodeSources(body("Experiments ran on the simulator from https://github.com/osrf/gazebo."));
    expect(c.links[0]!.ownCode).toBe(false); expect(c.status).toBe("mentioned");
  });
  it("reads availability statements when there is no link", () => {
    expect(findCodeSources(body("The code is available from the corresponding author upon reasonable request.")).status).toBe("on_request");
    expect(findCodeSources(body("The source code will be released after publication.")).status).toBe("promised");
    expect(findCodeSources(body("The implementation is not publicly available.")).status).toBe("not_available");
  });
  it("reads a data availability statement without mistaking it for code availability", () => {
    const c = findCodeSources(body("Data availability\nThe datasets used and analysed during the current study available from the corresponding author on reason-\nable request."));
    expect(c.status).toBe("none"); expect(c.statements).toEqual([expect.objectContaining({ kind: "data_on_request" })]);
  });
  it("says none when the paper states nothing, and caps the list", () => {
    expect(findCodeSources(body("Nothing about code here."))).toEqual({ status: "none", links: [], statements: [] });
    const many = Array.from({ length: 12 }, (_, i) => `Our code is at https://github.com/lab/r${i}.`).join(" ");
    expect(findCodeSources(body(many)).links).toHaveLength(8);
  });
  it("gives the agent a rule about the authors' code and Muse a rule that it cannot fetch it", () => {
    const c = findCodeSources(body("Our code is available at https://github.com/lab/aco."));
    expect(codeSourcesText(c, "agent").join("\n")).toMatch(/Look at that repository first[\s\S]*not that the method was independently re-implemented/);
    expect(codeSourcesText(c, "muse").join("\n")).toContain("cannot fetch it");
    expect(codeSourcesText(findCodeSources(body("Nothing.")), "agent").join("\n")).toContain("Do not assume one exists");
    expect(codeSourcesText(undefined, "agent")).toEqual([]); expect(codeStatusText(c)).toContain("states where its code is");
  });
});
describe("the quote for a statement", () => {
  const paper = "…and communication mechanisms, exploring task allocation and load balancing to improve the overall performance of multi-robot systems.\nData availability\nThe datasets used and/or analysed during the current study available from the corresponding author on reason-\nable request.\nReceived: 26 July 2024; Accepted: 7 March 2025\nReferences\n 1. Oleiwi, B. K.";
  it("opens at the statement's own sentence, not in the paragraph before it", () => {
    const s = findCodeSources(paper).statements[0]!; expect(s.kind).toBe("data_on_request"); expect(s.quote).toBe("Data availability The datasets used and/or analysed during the current study available from the corresponding author on reason- able request."); // the heading is part of it; the paragraph before and the lines after are not
  });
  it("opens after the last sentence end when the statement sits inside a paragraph", () => {
    const s = findCodeSources("We trained the model for 200 epochs. The code is available from the authors on request. Results follow.").statements[0]!; expect(s.kind).toBe("on_request"); expect(s.quote).toBe("The code is available from the authors on request."); expect(s.quote).not.toContain("epochs");
  });
});

