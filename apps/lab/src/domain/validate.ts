import { computeLabel, isLabelled } from "./labelRule";
import { isRegistered, NO_IMPLEMENTATION } from "./registry";
import type { Item } from "./types";

export class ContradictionError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "ContradictionError";
  }
}

/** Errors for an item that contradicts the label rule or the field contract. Empty means valid. */
export function itemErrors(item: Item): string[] {
  const errors: string[] = [];
  const where = `Item "${item.title}" (${item.id})`;
  if (item.implementation !== undefined && item.implementation !== NO_IMPLEMENTATION && !isRegistered(item.implementation))
    errors.push(`${where}: implementation "${item.implementation}" is not in the registry.`);
  if (isLabelled(item.type)) {
    const want = computeLabel(item);
    if (item.label !== want)
      errors.push(`${where}: label "${item.label ?? "missing"}" contradicts the label rule, which gives "${want}".`);
  } else if (item.label !== undefined) {
    errors.push(`${where}: only units carry a label.`);
  }
  if (!isLabelled(item.type) && item.implementation !== undefined && item.implementation !== NO_IMPLEMENTATION)
    errors.push(`${where}: only units carry an implementation.`);
  if (item.type === "paper" && !item.paper) errors.push(`${where}: a paper needs its source and spans.`);
  if (item.type === "snapshot" && !item.snapshot) errors.push(`${where}: a snapshot needs its snapshot data.`);
  return errors;
}

export function assertItem(item: Item): Item {
  const errors = itemErrors(item);
  if (errors.length) throw new ContradictionError(errors);
  return item;
}
