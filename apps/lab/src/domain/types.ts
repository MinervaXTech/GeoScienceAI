export const SCHEMA_VERSION = 1;

export type Mode = "take-notes" | "reproduce";
export type ItemType = "paper" | "unit" | "finding" | "snapshot" | "note";
/** Provenance: does the unit cite spans of the paper. Independent of implementation status. */
export type Label = "reproduced" | "new";
/** Implementation status: is a registered implementation attached. Independent of the label. */
export type ImplStatus = "runnable" | "spec-only";
export type CitationCheck = "pass" | "fail" | "not-run";
export type Review = "pending" | "reviewed";

export interface Message {
  id: string;
  role: "researcher" | "model";
  text: string;
  createdAt: string;
  /** Present only when a validator ran on this message. Absent means no verdict chip. */
  validation?: { citationCheck: "pass" | "fail" };
  /** The model reply came from a saved replay, not a live call. */
  replay?: boolean;
  model?: string;
  requestId?: string;
  sample?: true;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  endedAt?: string;
  mode: Mode;
  messages: Message[];
  sample?: true;
}

export interface Batch {
  id: string;
  name: string;
  kind: "paper" | "session";
  /** DOI for a paper batch, session id for a session batch. */
  source: string;
  createdAt: string;
  sample?: true;
}

export interface Span {
  id: string;
  text: string;
}

export interface PaperData {
  doi: string;
  spans: Span[];
}

export interface UnitData {
  purpose: string;
  inputs: string;
  outputs: string;
  parameters: string;
  /** Item id of the paper whose spans this unit cites. */
  paperItemId?: string;
}

export interface SnapshotUnit {
  unitId: string;
  key: string;
  title: string;
  label: Label;
  citedSpans: string[];
  implementation: string;
  /** Registry version string, or "none". */
  implementationVersion: string;
}

export interface SnapshotData {
  slot?: "A" | "B";
  hash: string;
  units: SnapshotUnit[];
  parameters: SnapshotParameters;
  /** Which tour algorithm this snapshot's units select, or null when no unit orders a route. */
  route: "A" | "B" | null;
  paperItemId?: string;
}

export interface SnapshotParameters {
  detector: Record<string, number | string>;
  route: Record<string, number | string | number[]>;
}

export interface Item {
  id: string;
  batchId: string;
  type: ItemType;
  title: string;
  body: string;
  label?: Label;
  citedSpans: string[];
  implementation?: string;
  citationCheck: CitationCheck;
  review: Review;
  source?: { sessionId: string; messageId: string; model: string; requestId: string };
  paper?: PaperData;
  unit?: UnitData;
  snapshot?: SnapshotData;
  createdAt: string;
  updatedAt: string;
  sample?: true;
}

export interface LabState {
  schemaVersion: number;
  sessions: Session[];
  batches: Batch[];
  items: Item[];
}

export const emptyState = (): LabState => ({
  schemaVersion: SCHEMA_VERSION,
  sessions: [],
  batches: [],
  items: [],
});
