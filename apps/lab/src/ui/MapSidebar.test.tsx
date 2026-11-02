import { useState } from "react";
import { createPortal } from "react-dom";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MapSidebar, type MapSidebarTab } from "./MapSidebar";

afterEach(cleanup);
function Fixture() {
  const [active, setActive] = useState<MapSidebarTab>("maps");
  const [expanded, setExpanded] = useState(true);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [canopy, setCanopy] = useState(true);
  return <><MapSidebar active={active} expanded={expanded} onOpen={(tab) => { setActive(tab); setExpanded(true); }} onCollapse={() => setExpanded(false)} snapshots={<p>Registered snapshots</p>} layerHost={setHost} maps={<label>Map name<input defaultValue="Kluang" /></label>} />{host && createPortal(<label><input type="checkbox" checked={canopy} onChange={(event) => setCanopy(event.target.checked)} />Show canopy layer</label>, host)}</>;
}
it("opens either icon's panel without collapsing on repeated clicks, and has a separate collapse control", () => {
  render(<Fixture />);
  const layers = screen.getByRole("tab", { name: "Layers" });
  fireEvent.click(layers); fireEvent.click(layers);
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  expect(screen.getByRole("tabpanel").id).toBe("map-sidebar-panel-layers");
  fireEvent.click(screen.getByRole("button", { name: "Collapse map sidebar" }));
  expect(screen.queryByRole("tabpanel")).toBeNull();
  expect(document.activeElement).toBe(layers);
  fireEvent.click(layers);
  expect(screen.getByRole("checkbox", { name: "Show canopy layer" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Collapse map sidebar" }));
  fireEvent.click(screen.getByRole("tab", { name: "Maps" }));
  expect(screen.getByRole("tabpanel").id).toBe("map-sidebar-panel-maps");
});
it("preserves map drafts and live layer settings across switching and collapse", () => {
  render(<Fixture />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "New field" } });
  fireEvent.click(screen.getByRole("tab", { name: "Layers" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Show canopy layer" }));
  fireEvent.click(screen.getByRole("button", { name: "Collapse map sidebar" }));
  fireEvent.click(screen.getByRole("tab", { name: "Maps" }));
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("New field");
  fireEvent.click(screen.getByRole("tab", { name: "Layers" }));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(within(screen.getByRole("tabpanel")).getByRole("checkbox")).toBeTruthy();
});
it("supports vertical keyboard navigation and opens a collapsed sidebar", () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: "Collapse map sidebar" }));
  const maps = screen.getByRole("tab", { name: "Maps" });
  fireEvent.keyDown(maps, { key: "ArrowDown" });
  const layers = screen.getByRole("tab", { name: "Layers" });
  expect(document.activeElement).toBe(layers);
  expect(layers.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(layers, { key: "ArrowDown" });
  const snapshots = screen.getByRole("tab", { name: "Snapshots" });
  expect(document.activeElement).toBe(snapshots);
  expect(screen.getByRole("tabpanel").id).toBe("map-sidebar-panel-snapshots");
  expect(screen.getByText("Registered snapshots")).toBeTruthy();
  fireEvent.keyDown(snapshots, { key: "Home" });
  expect(document.activeElement).toBe(maps);
});
