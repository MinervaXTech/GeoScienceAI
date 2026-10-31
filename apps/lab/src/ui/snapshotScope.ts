import type { Batch, Item, LabState } from "../domain/types";

export interface SnapshotScope {
  batch: Batch | undefined;
  snapshots: Item[];
}

/**
 * The snapshots the Map and Compare views work on: the selected paper batch,
 * else the first paper batch that has snapshots, else the first paper batch.
 */
export function snapshotScope(state: LabState, selectedBatch: string | undefined): SnapshotScope {
  const papers = state.batches.filter((b) => b.kind === "paper");
  const picked =
    papers.find((b) => b.id === selectedBatch) ??
    papers.find((b) => state.items.some((i) => i.batchId === b.id && i.type === "snapshot")) ??
    papers[0];
  const snapshots = picked
    ? state.items.filter((i) => i.batchId === picked.id && i.type === "snapshot" && i.snapshot).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [];
  return { batch: picked, snapshots };
}

export const slotLetter = (index: number) => String.fromCharCode(65 + index);
