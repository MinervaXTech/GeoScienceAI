import { makeItem, type ItemDraft } from "./store";
import { buildSnapshotData } from "./snapshots";
import { assertItem } from "./validate";
import type { Batch, Item, LabState, Message, Session, Span } from "./types";

/** Every object built here carries `sample: true`; the UI shows a "Sample data" badge for it. */
const at = (day: number, hhmm: string) => `2026-10-${String(day).padStart(2, "0")}T${hhmm}:00.000Z`;

const spans = (...texts: string[]): Span[] => texts.map((text, i) => ({ id: `S${i + 1}`, text }));

const PAPER_A = spans(
  "This study maps individual oil palm crowns from UAV imagery of a mature estate.",
  "A canopy height model (CHM) is derived from the photogrammetric surface and smoothed with a Gaussian filter.",
  "Local maxima within a moving window are taken as candidate crown apexes.",
  "The window size is chosen relative to the expected crown diameter.",
  "Candidates below a minimum height are removed to suppress understorey and ground returns.",
  "The remaining candidates are ordered into a visiting sequence by nearest-neighbour search.",
  "Detected crowns were compared with manual counts on a held-out plot.",
  "Leg cost can be weighted by wind direction when a wind field is available.",
  "Results are reported for one estate only.",
);

const PAPER_B = spans(
  "Gaps in a planted row indicate missing or dead palms.",
  "Row direction is estimated from the dominant orientation of the detected crowns.",
  "A gap is declared where the spacing along a row exceeds a multiple of the median spacing.",
  "The multiple is tuned on the training plots.",
);

const stamp = (ts: string) => ({ now: () => ts, id: (p: string) => `${p}_unused` });

function mk(id: string, ts: string, draft: ItemDraft): Item {
  return makeItem({ ...draft, sample: true }, stamp(ts), id);
}

const B = {
  paperA: "sample-batch-paper-a",
  paperB: "sample-batch-paper-b",
  s2: "sample-batch-session-2",
  s3: "sample-batch-session-3",
};

const batches: Batch[] = [
  { id: B.paperA, name: "Paper A", kind: "paper", source: "DOI 10.0000/sample-a", createdAt: at(27, "14:00"), sample: true },
  { id: B.paperB, name: "Paper B", kind: "paper", source: "DOI 10.0000/sample-b", createdAt: at(28, "10:00"), sample: true },
  { id: B.s2, name: "Session 2 import", kind: "session", source: "sample-session-2", createdAt: at(29, "16:30"), sample: true },
  { id: B.s3, name: "Session 3 import", kind: "session", source: "sample-session-3", createdAt: at(31, "23:15"), sample: true },
];

const msg = (n: number, role: Message["role"], text: string, ts: string, extra: Partial<Message> = {}): Message => ({
  id: `sample-msg-3-${n}`,
  role,
  text,
  createdAt: ts,
  sample: true,
  ...(role === "model" ? { model: "sample-replay", requestId: `sample-req-${n}` } : {}),
  ...extra,
});

const session3Messages: Message[] = [
  msg(1, "researcher", "Reproducing Paper A from snapshot B. Next I want to try different route refinement settings.", at(31, "23:11")),
  msg(2, "model", "Draft unit: Refinement sweep. Runs U5 with several pass caps and keeps the route with the fewest turns over 45 deg. Validator: no sweep runner in local mode.", at(31, "23:18"), { validation: { citationCheck: "fail" } }),
  msg(3, "researcher", "Compare A and B before adding units.", at(31, "23:20")),
  msg(4, "model", "S5 supports the height filter. The paper does not give the minimum height.", at(31, "23:24"), { validation: { citationCheck: "pass" }, replay: true }),
  msg(5, "researcher", "Which units still need review?", at(31, "23:30")),
  msg(6, "model", "Three units in Paper A are pending review: U3 Height filter, U6 Wind-aware route cost and U7 Row-end start point.", at(31, "23:31"), { validation: { citationCheck: "pass" } }),
  msg(7, "researcher", "Note: confirm the ground scale of the CHM raster.", at(31, "23:40")),
  msg(8, "model", "Noted. Path lengths are in ground metres (UTM zone 47N) from the saved layer.", at(31, "23:41"), { validation: { citationCheck: "pass" } }),
];

const sessions: Session[] = [
  { id: "sample-session-1", title: "Session 1", createdAt: at(27, "14:00"), endedAt: at(27, "15:10"), mode: "take-notes", sample: true, messages: [
    msg(1, "researcher", "Reading Paper A. Noting the crown detection steps.", at(27, "14:01"), { id: "sample-msg-1-1" }),
    msg(2, "model", "Paper A describes smoothing, local-maximum search, a height filter and ordering.", at(27, "14:05"), { id: "sample-msg-1-2", validation: { citationCheck: "pass" } }),
  ] },
  { id: "sample-session-2", title: "Session 2", createdAt: at(29, "16:00"), endedAt: at(29, "17:20"), mode: "reproduce", sample: true, messages: [
    msg(1, "researcher", "Draft a wind-aware route cost from Paper A.", at(29, "16:40"), { id: "sample-msg-2-1" }),
    msg(2, "model", "Wind-aware route cost (draft v0): weight each leg by wind direction. No wind source is defined.", at(29, "17:00"), { id: "sample-msg-2-2", validation: { citationCheck: "fail" } }),
  ] },
  { id: "sample-session-3", title: "Session 3", createdAt: at(31, "23:10"), endedAt: at(31, "23:55"), mode: "reproduce", sample: true, messages: session3Messages },
];

const unitDraft = (title: string, cited: string[], impl: string, u: { purpose: string; inputs: string; outputs: string; parameters: string }, extra: Partial<ItemDraft> = {}): ItemDraft => ({
  batchId: B.paperA,
  type: "unit",
  title,
  body: u.purpose,
  citedSpans: cited,
  implementation: impl,
  unit: { ...u, paperItemId: "sample-paper-a" },
  ...extra,
});

function paperAItems(): Item[] {
  const paper = mk("sample-paper-a", at(27, "14:02"), {
    batchId: B.paperA, type: "paper", title: "Crown detection from a canopy height model",
    body: PAPER_A.map((s) => s.text).join(" "), review: "reviewed",
    paper: { doi: "10.0000/sample-a (sample)", spans: PAPER_A },
  });
  const u1 = mk("sample-u1", at(27, "14:20"), unitDraft("U1 CHM smoothing", ["S2"], "chm-smoothing", { purpose: "Smooth the canopy height model before the peak search.", inputs: "CHMv2 height raster", outputs: "Smoothed raster", parameters: "3x3 mean (the paper says Gaussian; width not given)" }, { citationCheck: "pass", review: "reviewed" }));
  const u2 = mk("sample-u2", at(27, "14:20"), unitDraft("U2 Local-maximum search", ["S3", "S4"], "local-maximum-search", { purpose: "Take local maxima of the smoothed raster as candidate crown apexes.", inputs: "Smoothed raster", outputs: "Candidate peaks", parameters: "3x3 window (the paper ties window size to crown diameter)" }, { citationCheck: "pass", review: "reviewed" }));
  const u3 = mk("sample-u3", at(27, "14:21"), unitDraft("U3 Height filter", ["S5"], "height-filter", { purpose: "Remove candidates below a minimum height.", inputs: "Candidate peaks, raw raster", outputs: "Filtered candidates", parameters: "Minimum height 5 m (the paper gives no value)" }, { citationCheck: "pass" }));
  const u4 = mk("sample-u4", at(27, "14:21"), unitDraft("U4 Nearest-neighbour ordering", ["S6"], "nn-ordering", { purpose: "Order the candidates into a closed visiting sequence.", inputs: "Filtered candidates, home point", outputs: "Ordered route", parameters: "Ties go to the lower peak id" }, { citationCheck: "pass", review: "reviewed" }));
  const u5 = mk("sample-u5", at(29, "16:48"), unitDraft("U5 2-opt route refinement", [], "two-opt-refinement", { purpose: "Shorten the nearest-neighbour route by reversing segments.", inputs: "Ordered route", outputs: "Refined route", parameters: "Tolerance 1e-9 m" }, { review: "reviewed", body: "Researcher-added unit, not in the paper." }));
  const u6 = mk("sample-u6", at(29, "17:02"), unitDraft("U6 Wind-aware route cost", ["S8"], "none", { purpose: "Weight route legs by wind direction.", inputs: "Ordered route (no source)", outputs: "Per-leg cost", parameters: "Wind source (undefined)" }, { citationCheck: "fail", source: { sessionId: "sample-session-2", messageId: "sample-msg-2-2", model: "sample-replay", requestId: "sample-req-2" } }));
  const u7 = mk("sample-u7", at(31, "23:25"), unitDraft("U7 Row-end start point", [], "none", { purpose: "Start each route at the end of a planted row.", inputs: "Row geometry (not available)", outputs: "Start point", parameters: "None defined" }));
  const units123 = [u1, u2, u3, u4];
  const snapA = mk("sample-snap-a", at(27, "14:30"), {
    batchId: B.paperA, type: "snapshot", title: "Paper reproduction", review: "reviewed",
    snapshot: buildSnapshotData(units123, undefined, { slot: "A", paperItemId: paper.id }),
  });
  const snapB = mk("sample-snap-b", at(29, "16:50"), {
    batchId: B.paperA, type: "snapshot", title: "2-opt refinement", review: "reviewed",
    snapshot: buildSnapshotData([u1, u2, u3, u4, u5, u6], undefined, { slot: "B", paperItemId: paper.id }),
  });
  const finding = mk("sample-finding-a", at(27, "15:00"), {
    batchId: B.paperA, type: "finding", title: "Heights are predicted, not measured",
    body: "CHMv2 heights are predicted canopy height from 2019-10-23. Peaks are candidates, not field-verified trees.", review: "reviewed",
  });
  return [paper, u1, u2, u3, u4, u5, u6, u7, snapA, snapB, finding];
}

function otherItems(): Item[] {
  const paperB = mk("sample-paper-b", at(28, "10:05"), {
    batchId: B.paperB, type: "paper", title: "Gap detection in planted rows",
    body: PAPER_B.map((s) => s.text).join(" "), review: "reviewed",
    paper: { doi: "10.0000/sample-b (sample)", spans: PAPER_B },
  });
  const gap = mk("sample-gap", at(28, "10:31"), {
    batchId: B.paperB, type: "unit", title: "Gap detection", body: "Declare a gap where along-row spacing exceeds a multiple of the median.",
    citedSpans: ["S3"], implementation: "none", citationCheck: "fail",
    unit: { purpose: "Declare a gap where along-row spacing exceeds a multiple of the median.", inputs: "Peaks, row direction", outputs: "Gap list", parameters: "Multiple (tuned on training plots, no value given)", paperItemId: paperB.id },
  });
  const rows = mk("sample-rows", at(28, "10:40"), {
    batchId: B.paperB, type: "unit", title: "Row direction estimate", body: "Estimate row direction from the dominant crown orientation.",
    citedSpans: ["S2"], implementation: "none",
    unit: { purpose: "Estimate row direction from the dominant crown orientation.", inputs: "Peaks", outputs: "Row angle", parameters: "None given", paperItemId: paperB.id },
  });
  const noteB = mk("sample-note-b", at(28, "11:00"), {
    batchId: B.paperB, type: "note", title: "Paper B needs a spacing value", body: "The gap multiple is not given in the text, so Gap detection cannot run.",
  });

  const s2a = mk("sample-s2-wind", at(29, "17:00"), {
    batchId: B.s2, type: "unit", title: "Wind-aware route cost (draft v0)", body: "Weight each leg by wind direction. No wind source is defined.",
    citationCheck: "fail", implementation: "none", unit: { purpose: "Weight each leg by wind direction.", inputs: "Route, wind field (undefined)", outputs: "Per-leg cost", parameters: "Wind source (undefined)" },
    source: { sessionId: "sample-session-2", messageId: "sample-msg-2-2", model: "sample-replay", requestId: "sample-req-2" },
  });
  const s2b = mk("sample-s2-note1", at(29, "16:45"), { batchId: B.s2, type: "note", title: "Try a wind term after the base route works", body: "Try a wind term after the base route works." });
  const s2c = mk("sample-s2-note2", at(29, "17:05"), { batchId: B.s2, type: "note", title: "Ask where wind data would come from", body: "Ask where wind data would come from." });
  const s2d = mk("sample-s2-find", at(29, "17:10"), { batchId: B.s2, type: "finding", title: "Wind source is not defined in Paper A", body: "S8 mentions a wind field but gives no source." });

  const fromMsg = (n: number) => ({ sessionId: "sample-session-3", messageId: `sample-msg-3-${n}`, model: n % 2 === 0 ? "sample-replay" : "researcher", requestId: n % 2 === 0 ? `sample-req-${n}` : "none" });
  const s3a = mk("sample-s3-sweep", at(31, "23:18"), {
    batchId: B.s3, type: "unit", title: "Refinement sweep", body: session3Messages[1]!.text, citationCheck: "fail", implementation: "none",
    unit: { purpose: "Run U5 with several pass caps and keep the route with the fewest turns over 45 deg.", inputs: "Ordered route", outputs: "Best route", parameters: "Pass cap (several)" }, source: fromMsg(2),
  });
  const s3b = mk("sample-s3-note1", at(31, "23:20"), { batchId: B.s3, type: "note", title: "Compare A and B before adding units.", body: session3Messages[2]!.text, source: fromMsg(3) });
  const s3c = mk("sample-s3-find", at(31, "23:24"), { batchId: B.s3, type: "finding", title: "S5 supports the height filter", body: session3Messages[3]!.text, citationCheck: "pass", source: fromMsg(4) });
  const s3d = mk("sample-s3-note2", at(31, "23:40"), { batchId: B.s3, type: "note", title: "Note: confirm the ground scale of the CHM raster.", body: session3Messages[6]!.text, source: fromMsg(7) });
  return [paperB, gap, rows, noteB, s2a, s2b, s2c, s2d, s3a, s3b, s3c, s3d];
}

export const SAMPLE_ITEM_COUNT = 23;

export const hasSampleData = (s: LabState): boolean =>
  s.batches.some((b) => b.sample) || s.items.some((i) => i.sample) || s.sessions.some((x) => x.sample);

/** Adds the sample objects. Only the explicit "Load sample data" button calls this. A second call changes nothing. */
export function loadSampleData(state: LabState): LabState {
  if (hasSampleData(state)) return state;
  const items = [...paperAItems(), ...otherItems()];
  items.forEach(assertItem);
  return {
    ...state,
    sessions: [...state.sessions, ...sessions],
    batches: [...state.batches, ...batches],
    items: [...state.items, ...items],
  };
}
