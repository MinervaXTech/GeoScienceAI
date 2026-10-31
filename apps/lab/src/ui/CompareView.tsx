import { compareMetrics, compareUnits, type RowStatus } from "../domain/compare";
import { implementationStatus, LABEL_TEXT } from "../domain/labelRule";
import type { Item, SnapshotUnit } from "../domain/types";
import { ImplChip, SampleBadge } from "./Badges";
import { fmtNum } from "./format";
import { slotLetter } from "./snapshotScope";

const STATUS_TEXT: Record<RowStatus, string> = { same: "Same", changed: "Changed", added: "+ Added", removed: "− Removed" };

function UnitCell({ unit, missing }: { unit?: SnapshotUnit; missing: string }) {
  if (!unit) return <div className="cmp-cell empty">{missing}</div>;
  return (
    <div className="cmp-cell">
      <span className="unit-title">{unit.title}</span>
      <span className="axes">
        <span className={`label-block ${unit.label}`}>
          {unit.label === "new" && <b>NEW </b>}
          {LABEL_TEXT[unit.label]}
          {unit.citedSpans.length > 0 && <> · {unit.citedSpans.join(", ")}</>}
        </span>
        <ImplChip status={implementationStatus(unit)} long />
      </span>
    </div>
  );
}

interface Props {
  snapshots: Item[];
  a: string;
  b: string;
  onPick(side: "a" | "b", id: string): void;
  onClose(): void;
}

export function CompareView({ snapshots, a, b, onPick, onClose }: Props) {
  const sa = snapshots.find((s) => s.id === a);
  const sb = snapshots.find((s) => s.id === b);
  if (!sa?.snapshot || !sb?.snapshot) return <p className="empty">Pick two snapshots to compare.</p>;
  const letter = (s: Item) => slotLetter(snapshots.indexOf(s));
  const rows = compareUnits(sa.snapshot, sb.snapshot);
  const metrics = compareMetrics(sa.snapshot, sb.snapshot);

  return (
    <section className="compare" aria-label="Compare snapshots">
      <header className="compare-head">
        <span>
          Comparing snapshot {letter(sa)} with snapshot {letter(sb)}
        </span>
        {snapshots.length > 2 && (
          <span className="pickers">
            <select aria-label="Snapshot on the left" value={a} onChange={(e) => onPick("a", e.target.value)}>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>{`${slotLetter(snapshots.indexOf(s))} ${s.title}`}</option>
              ))}
            </select>
            <select aria-label="Snapshot on the right" value={b} onChange={(e) => onPick("b", e.target.value)}>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>{`${slotLetter(snapshots.indexOf(s))} ${s.title}`}</option>
              ))}
            </select>
          </span>
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          Close compare
        </button>
      </header>

      <div className="cmp-grid">
        <div className="cmp-col-head">
          <span className="eyebrow">
            Snapshot {letter(sa)} · <span className="hash">{sa.snapshot.hash}</span>
          </span>
          <h3>{sa.title}</h3>
        </div>
        <div className="cmp-col-head right">
          <span className="eyebrow">
            Snapshot {letter(sb)} · <span className="hash">{sb.snapshot.hash}</span>
          </span>
          <h3>{sb.title}</h3>
        </div>
        {rows.map((r) => (
          <div key={r.key} className={`cmp-row ${r.status}`}>
            <UnitCell unit={r.a} missing={`Not in snapshot ${letter(sa)}`} />
            <div className="cmp-right">
              <UnitCell unit={r.b} missing={`Not in snapshot ${letter(sb)}`} />
              <span className="status">{STATUS_TEXT[r.status]}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="metrics">
        <header>
          <h3>Metrics</h3>
          <span className="spacer" />
          {(sa.sample || sb.sample) && <SampleBadge />}
          <span className="badge outline">Simulated ordering, not flight-validated</span>
        </header>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>{letter(sa)}</th>
              <th>{letter(sb)}</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.metric}>
                <td>{m.metric}</td>
                <td>{show(m.a, m.unit)}</td>
                <td>{show(m.b, m.unit)}</td>
                <td>{m.difference === null ? "—" : `${m.difference > 0 ? "+" : m.difference < 0 ? "−" : ""}${fmtNum(Math.abs(m.difference))}${m.unit ? ` ${m.unit}` : ""}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          Computed now by running the registered tour algorithms over the saved layer. Climb and descent are CHMv2 height differences between consecutive peaks, a proxy and not an energy model.
        </p>
      </div>
    </section>
  );
}

const show = (v: number | null, unit?: string) => (v === null ? "—" : `${fmtNum(v)}${unit ? ` ${unit}` : ""}`);
