import { runnableCount } from "../domain/snapshots";
import { routeRun } from "../geo/layer";
import type { Batch, Item } from "../domain/types";
import { SampleBadge } from "./Badges";
import { fmtNum } from "./format";
import { slotLetter } from "./snapshotScope";

interface Props {
  batch: Batch | undefined;
  snapshots: Item[];
  canRegister: boolean;
  onRegister(): void;
  onCompare(): void;
  selectedId?: string | undefined;
  onSelect(id: string): void;
}

const ON_MAP = ["Solid light line", "Dashed red line"];

export function Snapshots({ batch, snapshots, canRegister, onRegister, onCompare, selectedId, onSelect }: Props) {
  return (
    <section className="snapshots" aria-label="Snapshots">
      <header>
        <h2>Snapshots</h2>
        <span className="sub">
          {snapshots.length} registered{batch ? ` · ${batch.name}` : ""}
        </span>
        {snapshots.some((s) => s.sample) && <SampleBadge />}
        <span className="spacer" />
        <button type="button" className="btn" onClick={onRegister} disabled={!canRegister} title={canRegister ? "" : "The batch has no units to register"}>
          Register from current units
        </button>
        <button type="button" className="btn primary" onClick={onCompare} disabled={snapshots.length < 2}>
          Compare {snapshots.length >= 2 ? `${slotLetter(0)} with ${slotLetter(1)}` : "snapshots"}
        </button>
      </header>
      {snapshots.length === 0 ? (
        <p className="empty">No snapshots yet. Register one from the current units of a paper batch.</p>
      ) : (
        <div className="snap-grid">
          {snapshots.map((s, i) => {
            const d = s.snapshot!;
            const run = d.route ? routeRun(d.route) : null;
            return (
              <button type="button" key={s.id} className={`snap-card${s.id === selectedId ? " selected" : ""}`} onClick={() => onSelect(s.id)}>
                <span className="eyebrow">Snapshot {slotLetter(i)}</span>
                <strong>{s.title}</strong>
                {s.sample && <SampleBadge />}
                <dl>
                  <dt>Hash</dt>
                  <dd>{d.hash}</dd>
                  <dt>Units</dt>
                  <dd>
                    {d.units.length} ({runnableCount(d.units)} runnable)
                  </dd>
                  <dt>Path length</dt>
                  <dd>{run ? `${fmtNum(run.metrics.pathLengthM)} m` : "—"}</dd>
                  <dt>Turns &gt; 45 deg</dt>
                  <dd>{run ? run.metrics.turnsOver45Deg : "—"}</dd>
                  <dt>On map</dt>
                  <dd>{run && i < 2 ? ON_MAP[i] : "Not drawn"}</dd>
                </dl>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
