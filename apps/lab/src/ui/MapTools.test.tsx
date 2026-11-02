import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MapTools, type MapToolId } from "./MapTools";
afterEach(cleanup);
function Draft() {
  const [value, setValue] = useState("");
  return <label>Draft goal<input value={value} onChange={(event) => setValue(event.target.value)} /></label>;
}
function Fixture() {
  const [active, setActive] = useState<MapToolId | null>("planning");
  return <MapTools active={active} onChange={setActive} panels={[
    { id: "planning", label: "Planning points", content: <p>Planning controls</p> },
    { id: "clusters", label: "Clusters", content: <p>Cluster controls</p> },
    { id: "sam", label: "SAM 3.1", status: "1 segment", content: <Draft /> },
    { id: "muse", label: "Muse map agent", content: <p>Muse controls</p> },
    { id: "crowns", label: "Crown detection", content: <p>Crown controls</p> },
  ]} />;
}
it("opens only the selected panel, and clicking its tab again keeps it open", () => {
  render(<Fixture />);
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("map-tool-tab-planning");
  const sam = screen.getByRole("tab", { name: "SAM 3.1" });
  fireEvent.click(sam); fireEvent.click(sam);
  expect(sam.getAttribute("aria-selected")).toBe("true");
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  expect(screen.getByRole("tabpanel").id).toBe(sam.getAttribute("aria-controls"));
  expect(screen.queryByRole("button", { name: /Collapse SAM/ })).toBeNull();
});
it("keeps form state when switching tabs or hiding and reopening the panel", () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole("tab", { name: "SAM 3.1" }));
  fireEvent.change(within(screen.getByRole("tabpanel")).getByRole("textbox"), { target: { value: "individual oil palm tree canopy" } });
  fireEvent.click(screen.getByRole("tab", { name: "Muse map agent" }));
  fireEvent.click(screen.getByRole("button", { name: "Hide map tool panel" }));
  expect(screen.queryByRole("tabpanel")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "SAM 3.1" }));
  expect((within(screen.getByRole("tabpanel")).getByRole("textbox") as HTMLInputElement).value).toBe("individual oil palm tree canopy");
});
it("supports arrow-key, Home and End navigation with a single keyboard tab stop", () => {
  render(<Fixture />);
  const planning = screen.getByRole("tab", { name: "Planning points" });
  planning.focus(); fireEvent.keyDown(planning, { key: "ArrowRight" });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Clusters" }));
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Crown detection" }));
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement).toBe(planning);
  expect(screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
});
