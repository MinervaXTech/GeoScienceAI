import { LABEL_TEXT, STATUS_TEXT } from "../domain/labelRule";
import type { CitationCheck, ImplStatus, Item, Label } from "../domain/types";

export const SampleBadge = () => (
  <span className="badge sample" title="This object came from the sample data loader">
    <i aria-hidden="true" />
    Sample data
  </span>
);

/** PASS or FAIL only. A check that has not run shows no chip; callers show "Not run" text instead. */
export function VerdictChip({ check }: { check: CitationCheck }) {
  if (check === "not-run") return null;
  return <span className={`verdict ${check}`}>{check === "pass" ? "PASS" : "FAIL"}</span>;
}

/** Table and detail cell for the citation check: a chip, or the words "Not run". */
export function CheckCell({ check }: { check: CitationCheck }) {
  return check === "not-run" ? <span className="muted">Not run</span> : <VerdictChip check={check} />;
}

/** Provenance. Never replaced by implementation status. */
export function LabelChip({ label, short = false }: { label: Label | undefined; short?: boolean }) {
  if (!label) return <span className="muted">{"—"}</span>;
  const text = short ? (label === "reproduced" ? "Reproduced" : "New") : LABEL_TEXT[label];
  return (
    <span className={`label-chip ${label}`}>
      <i aria-hidden="true" />
      {text}
    </span>
  );
}

/** Implementation status, shown beside the label: solid when runnable, dashed when spec only. */
export function ImplChip({ status, long = false }: { status: ImplStatus | undefined; long?: boolean }) {
  if (!status) return <span className="muted">{"—"}</span>;
  return <span className={`impl-chip ${status}`}>{status === "runnable" ? STATUS_TEXT.runnable : long ? STATUS_TEXT["spec-only"] : "Spec only"}</span>;
}

/** "Model-drafted, validator verdict: FAIL, human review pending". Only for items with a PASS or FAIL. */
export function VerdictLine({ check, modelDrafted, review }: { check: CitationCheck; modelDrafted: boolean; review: Item["review"] }) {
  if (check === "not-run") return null;
  return (
    <div className={`verdict-line ${check}`}>
      {modelDrafted ? "Model-drafted, v" : "V"}alidator verdict: <VerdictChip check={check} />, human review {review}
    </div>
  );
}
