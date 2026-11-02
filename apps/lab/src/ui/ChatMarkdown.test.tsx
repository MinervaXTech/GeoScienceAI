import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChatMarkdown } from "./ChatMarkdown";

afterEach(cleanup);
it("renders Muse formatting as readable headings, lists, code, links and tables", () => {
  const { container } = render(<ChatMarkdown text={'In **Kluang** I can:\n\n### View and navigate\n\n- Toggle layers\n- Use `inspect_area`\n\n[Model docs](https://dev.meta.ai/docs/models)\n\n| Tool | Status |\n| --- | --- |\n| SAM | Ready |\n\n```json\n{"points": 631}\n```'} />);
  expect(container.querySelector("strong")?.textContent).toBe("Kluang");
  expect(screen.getByRole("heading", { name: "View and navigate" })).toBeTruthy();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(container.querySelector("li code")?.textContent).toBe("inspect_area");
  expect(screen.getByRole("table")).toBeTruthy();
  expect(container.querySelector("pre code")?.textContent).toContain('"points": 631');
  expect(screen.getByRole("link", { name: "Model docs" }).getAttribute("rel")).toContain("noreferrer");
});
it("does not execute HTML, load remote images, or allow javascript links from replies", () => {
  const { container } = render(<ChatMarkdown text={'<script>alert(1)</script>\n\n<img src="https://remote.example/pixel" onerror="alert(1)">\n\n![Tracking image](https://remote.example/pixel)\n\n[Unsafe](javascript:alert%281%29)\n\n**Visible reply**'} />);
  expect(container.querySelector("script, img")).toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).toBe("");
  expect(container.querySelector("strong")?.textContent).toBe("Visible reply");
});
