import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Polygon } from "geojson";
import { AddMapForm } from "./AddMapForm";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Add map", () => {
  const drawn: Polygon = { type: "Polygon", coordinates: [[[103.31, 2.03], [103.32, 2.03], [103.32, 2.04], [103.31, 2.03]]] };
  const areaProps = { area: drawn, drawing: false, onDrawArea() {}, onResetArea() {} };
  const view = { center: [101.72, 2.98] as [number, number], zoom: 18.4, basemap: "esri" as const };
  it("requires a finished drawn boundary instead of generating a rectangle", () => {
    const onSave = vi.fn();
    render(<AddMapForm {...areaProps} area={null} basemap="esri" onBasemap={() => {}} view={view} onLocate={() => true} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "view" } });
    fireEvent.change(screen.getByLabelText("Map name"), { target: { value: "Field B" } });
    expect((screen.getByRole("button", { name: "Save map" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "Add map" }));
    expect(onSave).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toMatch(/finish the map boundary/);
  });
  it("saves the current view with a trimmed name", () => {
    const onSave = vi.fn();
    render(<AddMapForm {...areaProps} basemap="esri" onBasemap={() => {}} view={view} onLocate={() => true} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "view" } });
    fireEvent.change(screen.getByLabelText("Map name"), { target: { value: "  Field B  " } });
    fireEvent.submit(screen.getByRole("form", { name: "Add map" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ ...view, name: "Field B", id: expect.stringMatching(/^map-/) }));
  });
  it("uses longitude, latitude order and chosen zoom for a new location", () => {
    const onSave = vi.fn();
    render(<AddMapForm {...areaProps} basemap="esri" onBasemap={() => {}} view={view} onLocate={() => true} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Map name"), { target: { value: "Kuching" } });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "coordinates" } });
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "1.55" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "110.35" } });
    fireEvent.change(screen.getByLabelText("Zoom"), { target: { value: "17" } });
    fireEvent.submit(screen.getByRole("form", { name: "Add map" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ center: [110.35, 1.55], zoom: 17 }));
  });
  it("searches on Enter, jumps to the selected place and saves the adjusted map view", async () => {
    const place = { id: "N-123", name: "Kluang", label: "Kluang, Johor, Malaysia", kind: "city", center: [103.319, 2.032], zoom: 13 };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [place] }) });
    vi.stubGlobal("fetch", fetch);
    const onLocate = vi.fn().mockReturnValue(true), onSave = vi.fn();
    const adjustedView = { center: [103.32, 2.04] as [number, number], zoom: 16 };
    render(<AddMapForm {...areaProps} basemap="esri" onBasemap={() => {}} view={view} onLocate={onLocate} onReadView={() => adjustedView} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "kluang johor" } });
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("Search place"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: /Kluang · city/ }));
    expect(onLocate).toHaveBeenCalledWith(place);
    expect((screen.getByLabelText("Map name") as HTMLInputElement).value).toBe("Kluang");
    fireEvent.submit(screen.getByRole("form", { name: "Add map" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ ...adjustedView, name: "Kluang", boundary: drawn, area: drawn }));
    fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "Johor Bahru" } });
    expect((screen.getByRole("button", { name: "Save map" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows empty results without saving or moving the map", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [] }) }));
    const onLocate = vi.fn(), onSave = vi.fn();
    render(<AddMapForm {...areaProps} basemap="esri" onBasemap={() => {}} view={view} onLocate={onLocate} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "Unknown place" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/No places found/)).toBeTruthy();
    expect(onLocate).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
