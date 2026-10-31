import type { ImplStatus, Item, Label } from "./types";
import { isRegistered } from "./registry";

/** Provenance only: cited spans give reproduced, none give new. Never typed by hand. */
export function computeLabel(input: { citedSpans: readonly string[] }): Label {
  return input.citedSpans.length > 0 ? "reproduced" : "new";
}

/** Implementation status only: runnable when a registered implementation is attached, else spec only. */
export function implementationStatus(input: { implementation?: string | undefined }): ImplStatus {
  return isRegistered(input.implementation) ? "runnable" : "spec-only";
}

/** The two independent axes for a unit. Spec only never replaces the label. */
export function classify(input: { citedSpans: readonly string[]; implementation?: string | undefined }) {
  return { label: computeLabel(input), status: implementationStatus(input) };
}

/** Papers, findings, snapshots and notes carry no label or status; only units do. */
export const isLabelled = (type: Item["type"]): boolean => type === "unit";

export const LABEL_TEXT: Record<Label, string> = {
  reproduced: "Reproduced from paper",
  new: "New (researcher-added)",
};

export const STATUS_TEXT: Record<ImplStatus, string> = {
  runnable: "Runnable",
  "spec-only": "Spec only, not runnable",
};
