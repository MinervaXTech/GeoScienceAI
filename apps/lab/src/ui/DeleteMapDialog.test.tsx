import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteMapDialog } from "./DeleteMapDialog";
const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
beforeEach(() => { Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } }); });
afterEach(() => {
  cleanup();
  if (original) Object.defineProperty(HTMLDialogElement.prototype, "showModal", original);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});
describe("map deletion confirmation", () => {
  it("requires the exact map name, including its case, before deleting", () => {
    const onConfirm = vi.fn();
    render(<DeleteMapDialog name="Kluang" busy={false} onCancel={() => {}} onConfirm={onConfirm} />);
    const button = screen.getByRole("button", { name: "Delete map" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type map name to confirm"), { target: { value: "kluang" } });
    fireEvent.submit(screen.getByRole("form", { name: "Confirm map deletion" }));
    expect(button.disabled).toBe(true); expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Type map name to confirm"), { target: { value: "Kluang" } });
    expect(button.disabled).toBe(false);
    fireEvent.submit(screen.getByRole("form", { name: "Confirm map deletion" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  it("cancels without deleting", () => {
    const onConfirm = vi.fn(), onCancel = vi.fn();
    render(<DeleteMapDialog name="Kluang" busy={false} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1); expect(onConfirm).not.toHaveBeenCalled();
  });
});
