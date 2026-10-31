import { useMemo } from "react";
import { classify, LABEL_TEXT, STATUS_TEXT } from "../domain/labelRule";
import { buildLineage, GEO, litKeys, paperBatches } from "../domain/lineage";
import type { LabState } from "../domain/types";

interface Props {
  state: LabState;
  batchId: string | undefined;
  selected: string | undefined;
  onBatch(id: string): void;
  onSelect(key: string | undefined, itemId?: string): void;
}

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const m = (x1 + x2) / 2;
  return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`;
};

/** Spans on the left, units in the middle, snapshots on the right. Drawn from the same items as the table. */
export function LineageView({ state, batchId, selected, onBatch, onSelect }: Props) {
  const options = paperBatches(state);
  const id = options.find((b) => b.id === batchId)?.id ?? options[0]?.id;
  const lin = useMemo(() => (id ? buildLineage(state, id) : undefined), [state, id]);
  if (!lin || !id)
    return <p className="empty">Lineage needs a paper batch with a paper in it. Load sample data or import one.</p>;
  const lit = litKeys(lin, selected);
  const op = (key: string) => (!lit || lit.has(key) ? 1 : 0.3);
  const ring = (key: string) => (selected === key ? "0 0 0 3px var(--red)" : "none");
  const { spanX, spanW, unitX, unitW, snapX, snapW, spanH, unitH, snapH } = GEO;
  const width = snapX + snapW;

  return (
    <div className="lineage">
      <div className="lin-head">
        <select aria-label="Paper batch" value={id} onChange={(e) => onBatch(e.target.value)}>
          {options.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <span className="hint">{lin.summary}</span>
      </div>
      <div className="lin-legend" aria-label="Legend">
        <span><i className="lg cited" />Cited span</span>
        <span><i className="lg uncited" />Not cited</span>
        <span><i className="lg reproduced" />Reproduced from paper</span>
        <span><i className="lg new" />New (researcher-added)</span>
        <span><i className="lg spec" />Spec only unit</span>
      </div>
      <div className="lin-cols" style={{ width }}><span style={{ left: spanX }}>Paper spans</span><span style={{ left: unitX }}>Units</span><span style={{ left: snapX }}>Snapshots</span></div>
      <div className="lin-canvas" style={{ height: lin.height, width }}>
        <svg width={width} height={lin.height} aria-hidden="true">
          {[...lin.edges].sort((a, b) => Number(!!lit?.has(a.from) && !!lit.has(a.to)) - Number(!!lit?.has(b.from) && !!lit.has(b.to))).map((e) => {
            const hot = !!lit && lit.has(e.from) && lit.has(e.to);
            const [x1, x2] = e.kind === "span-unit" ? [spanX + spanW, unitX] : [unitX + unitW, snapX];
            return (
              <path
                key={`${e.from}>${e.to}`}
                d={curve(x1, e.y1, x2, e.y2)}
                fill="none"
                stroke={hot ? "var(--red)" : e.kind === "span-unit" ? "var(--ink)" : "#777"}
                strokeWidth={hot ? 3 : 1.5}
                strokeDasharray={e.kind === "unit-snap" && !hot ? "5 4" : undefined}
                opacity={!lit || hot ? 1 : 0.18}
              />
            );
          })}
        </svg>

        {lin.spans.map((s) => (
          <button
            type="button"
            key={s.key}
            className={`ln span${s.cited ? " cited" : ""}`}
            aria-pressed={selected === s.key}
            style={{ left: spanX, top: s.y, width: spanW, height: spanH, opacity: op(s.key), boxShadow: ring(s.key) }}
            title={s.text}
            onClick={() => onSelect(selected === s.key ? undefined : s.key)}
          >
            <b>{s.id}</b>
            <span>{s.text}</span>
            {!s.cited && <em>not cited</em>}
          </button>
        ))}

        {lin.newHeaderY !== null && (
          <div className="lin-new-head" style={{ left: unitX, top: lin.newHeaderY, width: unitW }}>New, cites no span</div>
        )}
        {lin.units.map((u) => {
          const { label, status } = classify(u.item);
          const code = /^(U\d+) (.*)$/.exec(u.item.title);
          return (
            <button
              type="button"
              key={u.key}
              className={`ln unit ${label} ${status}`}
              aria-pressed={selected === u.key}
              style={{ left: unitX, top: u.y, width: unitW, height: unitH, opacity: op(u.key), boxShadow: ring(u.key) }}
              onClick={() => (selected === u.key ? onSelect(undefined) : onSelect(u.key, u.item.id))}
            >
              <strong>{code ? <><b>{code[1]}</b> {code[2]}</> : u.item.title}</strong>
              <span>
                {LABEL_TEXT[label]} · {status === "runnable" ? STATUS_TEXT.runnable : "Spec only"}
                {u.item.citationCheck === "fail" && " · check FAIL"}
              </span>
            </button>
          );
        })}

        {lin.snaps.map((sn) => (
          <button
            type="button"
            key={sn.key}
            className="ln snap"
            aria-pressed={selected === sn.key}
            style={{ left: snapX, top: sn.y, width: snapW, height: snapH, opacity: op(sn.key), boxShadow: ring(sn.key) }}
            onClick={() => (selected === sn.key ? onSelect(undefined) : onSelect(sn.key, sn.item.id))}
          >
            <strong>{sn.item.title}</strong>
            <span>{sn.hash} · {sn.count} units</span>
          </button>
        ))}
        {!lin.snaps.length && <p className="hint lin-nosnap" style={{ left: snapX, top: 24, width: snapW }}>No snapshots in this batch.</p>}
      </div>
    </div>
  );
}
