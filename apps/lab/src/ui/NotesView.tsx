import { useMemo, useState, type CSSProperties } from "react";
import { classify, implementationStatus, LABEL_TEXT, STATUS_TEXT } from "../domain/labelRule";
import { batchOverview, noFilters, queryItems, sortText, statusOf, type Filters, type Sort, type SortKey } from "../domain/query";
import { NO_IMPLEMENTATION, REGISTRY, isRegistered } from "../domain/registry";
import { runnableCount } from "../domain/snapshots";
import { routeRun } from "../geo/layer";
import type { Batch, CitationCheck, ImplStatus, Item, ItemType, Label, LabState, Review } from "../domain/types";
import { CheckCell, ImplChip, LabelChip, SampleBadge, VerdictLine } from "./Badges";
import { fmtNum, formatDate, formatDateTime, MODE_TEXT, plural } from "./format";
import { LineageView } from "./LineageView";
import { ChatMarkdown } from "./ChatMarkdown";
import { ResizeHandle } from "./ResizeHandle";
import { clampDetail, defaultDetailHeight, DETAIL_KEY_STEP, DETAIL_MIN_HEIGHT, loadDetailLayout, maxDetailHeight, saveDetailLayout, type DetailLayout } from "./detailDock";
import { RoadmapCard } from "./RoadmapCard";

const TYPE_TEXT: Record<ItemType, string> = { paper: "Paper", unit: "Unit", finding: "Finding", snapshot: "Snapshot", note: "Note" };
const IMPL_TEXT: Record<ImplStatus | "na", string> = { runnable: "Runnable", "spec-only": "Spec only", na: "Not a unit" };
const VERDICT_TEXT: Record<CitationCheck, string> = { pass: "PASS", fail: "FAIL", "not-run": "Not run" };

interface Props {
  state: LabState;
  filters: Filters;
  setFilters(f: Filters): void;
  sort: Sort | undefined;
  setSort(s: Sort | undefined): void;
  selectedId: string | undefined;
  onSelect(id: string): void;
  onNewBatch(input: Pick<Batch, "name" | "kind" | "source">): void;
  onReview(id: string, review: Review): void;
  onLoadSample(): void;
}

export function NotesView(p: Props) {
  const [layout, setLayout] = useState(() => loadDetailLayout(window.innerHeight));
  const changeLayout = (patch: Partial<DetailLayout>) => { const next = clampDetail({ ...layout, ...patch }, window.innerHeight); setLayout(next); saveDetailLayout(next); };
  const { state, filters, setFilters, sort, setSort } = p;
  const [mode, setMode] = useState<"table" | "lineage">("table");
  const [lsel, setLsel] = useState<string | undefined>();
  const { rows, shown, total } = queryItems(state, filters, sort);
  const overview = useMemo(() => batchOverview(state.items, filters.batch), [state.items, filters.batch]);
  const batchName = (id: string | undefined) => state.batches.find((b) => b.id === id)?.name;
  const selected = state.items.find((i) => i.id === p.selectedId);
  const scopeTitle = filters.batch ? batchName(filters.batch) : "All batches";

  const cycleSort = (key: SortKey) => {
    if (sort?.key !== key) setSort({ key, dir: "asc" });
    else if (sort.dir === "asc") setSort({ key, dir: "desc" });
    else setSort(undefined);
  };
  const set = <K extends keyof Filters>(k: K, v: Filters[K] | "") => {
    const next = { ...filters };
    if (v === "" || v === undefined) delete next[k];
    else next[k] = v as Filters[K];
    setFilters(next);
  };

  const chips: { key: string; text: string; clear(): void }[] = [];
  if (filters.type) chips.push({ key: "type", text: `Type: ${TYPE_TEXT[filters.type]}`, clear: () => set("type", "") });
  if (filters.label) chips.push({ key: "label", text: `Label: ${filters.label === "none" ? "No label" : LABEL_TEXT[filters.label]}`, clear: () => set("label", "") });
  if (filters.verdict) chips.push({ key: "verdict", text: `Citation check: ${VERDICT_TEXT[filters.verdict]}`, clear: () => set("verdict", "") });
  if (filters.impl) chips.push({ key: "impl", text: `Implementation: ${IMPL_TEXT[filters.impl]}`, clear: () => set("impl", "") });
  if (filters.review) chips.push({ key: "review", text: `Review: ${filters.review === "pending" ? "Pending" : "Reviewed"}`, clear: () => set("review", "") });
  if (filters.batch) chips.push({ key: "batch", text: `Batch: ${batchName(filters.batch) ?? "?"}`, clear: () => set("batch", "") });
  if (filters.search.trim()) chips.push({ key: "search", text: `Search: ${filters.search.trim()}`, clear: () => setFilters({ ...filters, search: "" }) });
  if (sort) chips.push({ key: "sort", text: sortText(sort), clear: () => setSort(undefined) });

  const header = (key: SortKey, text: string) => {
    const active = sort?.key === key;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={active ? "sorted" : ""}>
        <button type="button" onClick={() => cycleSort(key)}>
          {text} <span aria-hidden="true">{active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
        </button>
      </th>
    );
  };

  const seg = (kind: "label" | "verdict" | "impl" | "review", value: string, count: number, text: string) => {
    const on = filters[kind] === value;
    return (
      <button type="button" key={`${kind}-${value}`} className={`seg ${kind}-${value} ${on ? "on" : ""}`} style={{ flexGrow: Math.max(count, 0.6) }} aria-pressed={on} disabled={count === 0 && !on} onClick={() => set(kind, on ? "" : (value as never))}>
        <b>{count}</b> {text}
      </button>
    );
  };

  return (
    <section className={`notes dock-${layout.dock}${mode === "lineage" ? " lineage-mode" : ""}`} style={{ "--detail-height": `${layout.height}px` } as CSSProperties} aria-label="Notes">
      {mode === "table" && <BatchList state={state} filters={filters} setBatch={(id) => set("batch", id ?? "")} onNewBatch={p.onNewBatch} />}

      <div className="table-col">
        <div className="toggle view-toggle" role="group" aria-label="Notes view">
          <button type="button" aria-pressed={mode === "table"} onClick={() => setMode("table")}>Table</button>
          <button type="button" aria-pressed={mode === "lineage"} onClick={() => setMode("lineage")}>Lineage</button>
        </div>
        {mode === "lineage" ? (
          <LineageView
            state={state}
            batchId={filters.batch}
            selected={lsel}
            onBatch={(id) => { set("batch", id); setLsel(undefined); }}
            onSelect={(key, itemId) => { setLsel(key); if (itemId) p.onSelect(itemId); }}
          />
        ) : (<>
        <div className="table-head">
          <h2>{scopeTitle}</h2>
          <span className="count" aria-live="polite">
            Showing {shown} of {total}
          </span>
        </div>

        {total > 0 && (
          <div className="overview" aria-label={`Overview of ${scopeTitle}`}>
            <div>
              <span className="ov-title">Label · {plural(overview.units, "unit")}</span>
              <span className="bar">
                {seg("label", "reproduced", overview.label.reproduced, LABEL_TEXT.reproduced)}
                {seg("label", "new", overview.label.new, LABEL_TEXT.new)}
              </span>
            </div>
            <div>
              <span className="ov-title">Implementation · {plural(overview.units, "unit")}</span>
              <span className="bar">
                {seg("impl", "runnable", overview.impl.runnable, "Runnable")}
                {seg("impl", "spec-only", overview.impl["spec-only"], "Spec only")}
              </span>
            </div>
            <div>
              <span className="ov-title">Citation check · {plural(overview.total, "item")}</span>
              <span className="bar">
                {seg("verdict", "pass", overview.verdict.pass, "PASS")}
                {seg("verdict", "fail", overview.verdict.fail, "FAIL")}
                {seg("verdict", "not-run", overview.verdict["not-run"], "Not run")}
              </span>
            </div>
            <div>
              <span className="ov-title">Review · {plural(overview.total, "item")}</span>
              <span className="bar">
                {seg("review", "pending", overview.review.pending, "Review pending")}
                {seg("review", "reviewed", overview.review.reviewed, "Reviewed")}
              </span>
            </div>
          </div>
        )}

        <input
          type="search"
          className="search"
          aria-label="Search titles and text"
          placeholder="Search titles and text"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <div className="filter-row">
          <select aria-label="Type" value={filters.type ?? ""} onChange={(e) => set("type", e.target.value as ItemType | "")}>
            <option value="">Type</option>
            {(Object.keys(TYPE_TEXT) as ItemType[]).map((t) => (
              <option key={t} value={t}>{TYPE_TEXT[t]}</option>
            ))}
          </select>
          <select aria-label="Label" value={filters.label ?? ""} onChange={(e) => set("label", e.target.value as Label | "none" | "")}>
            <option value="">Label</option>
            {(Object.keys(LABEL_TEXT) as Label[]).map((l) => (
              <option key={l} value={l}>{LABEL_TEXT[l]}</option>
            ))}
            <option value="none">No label</option>
          </select>
          <select aria-label="Citation check" value={filters.verdict ?? ""} onChange={(e) => set("verdict", e.target.value as CitationCheck | "")}>
            <option value="">Citation check</option>
            {(Object.keys(VERDICT_TEXT) as CitationCheck[]).map((v) => (
              <option key={v} value={v}>{VERDICT_TEXT[v]}</option>
            ))}
          </select>
          <select aria-label="Implementation" value={filters.impl ?? ""} onChange={(e) => set("impl", e.target.value as ImplStatus | "na" | "")}>
            <option value="">Implementation</option>
            {(Object.keys(IMPL_TEXT) as (ImplStatus | "na")[]).map((v) => (
              <option key={v} value={v}>{IMPL_TEXT[v]}</option>
            ))}
          </select>
          <select aria-label="Review" value={filters.review ?? ""} onChange={(e) => set("review", e.target.value as Review | "")}>
            <option value="">Review</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
          </select>
          <select aria-label="Batch" value={filters.batch ?? ""} onChange={(e) => set("batch", e.target.value)}>
            <option value="">Batch</option>
            {state.batches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        {chips.length > 0 && (
          <ul className="chips" aria-label="Active filters and sort">
            {chips.map((c) => (
              <li key={c.key}>
                {c.text}
                <button type="button" aria-label={`Remove ${c.text}`} onClick={c.clear}>
                  {"×"}
                </button>
              </li>
            ))}
            {chips.length > 1 && (
              <li className="clear-all">
                <button type="button" onClick={() => { setFilters(noFilters()); setSort(undefined); }}>Clear all</button>
              </li>
            )}
          </ul>
        )}

        {total === 0 ? (
          <div className="empty big">
            <p>No notes yet. Save a chat message to notes, or load sample data to see how the Lab looks when filled.</p>
            <button type="button" className="btn primary" onClick={p.onLoadSample}>Load sample data</button>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="items">
              <thead>
                <tr>
                  {header("type", "Type")}
                  {header("title", "Title")}
                  {header("label", "Label")}
                  {header("verdict", "Check")}
                  {header("impl", "Impl.")}
                  {header("review", "Review")}
                  {header("updated", "Updated")}
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={i.id === p.selectedId ? "selected" : ""} onClick={() => p.onSelect(i.id)}>
                    <td>{TYPE_TEXT[i.type]}</td>
                    <th scope="row">
                      <button type="button" className="rowlink" onClick={() => p.onSelect(i.id)} aria-current={i.id === p.selectedId}>
                        {i.title}
                      </button>
                      {!filters.batch && <span className="sub">{batchName(i.batchId)}</span>}
                      {i.sample && <SampleBadge />}
                    </th>
                    <td><LabelChip label={i.label} short /></td>
                    <td><CheckCell check={i.citationCheck} /></td>
                    <td><ImplChip status={statusOf(i)} /></td>
                    <td className={i.review === "pending" ? "pending" : "muted"}>{i.review === "pending" ? "Pending" : "Reviewed"}</td>
                    <td>{formatDateTime(i.updatedAt)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty">No items match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </>)}
      </div>

      <DetailPane state={state} item={selected} onReview={p.onReview} onSelect={p.onSelect} layout={layout} onLayout={changeLayout} />
    </section>
  );
}

function BatchList({ state, filters, setBatch, onNewBatch }: { state: LabState; filters: Filters; setBatch(id: string | undefined): void; onNewBatch: Props["onNewBatch"] }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Batch["kind"]>("paper");
  const [source, setSource] = useState("");
  const count = (id: string) => state.items.filter((i) => i.batchId === id).length;
  const kindText = (b: Batch) => (b.kind === "paper" ? "Paper" : (MODE_TEXT[state.sessions.find((s) => s.id === b.source)?.mode ?? "take-notes"]));

  return (
    <nav className="batches" aria-label="Batches">
      <h2>Batches</h2>
      <ul>
        <li>
          <button type="button" className={!filters.batch ? "on" : ""} aria-current={!filters.batch} onClick={() => setBatch(undefined)}>
            <strong>All batches</strong>
            <span>{plural(state.items.length, "item")}</span>
          </button>
        </li>
        {state.batches.map((b) => (
          <li key={b.id}>
            <button type="button" className={filters.batch === b.id ? "on" : ""} aria-current={filters.batch === b.id} onClick={() => setBatch(b.id)}>
              <strong>{b.name}</strong>
              <span className="kind">{kindText(b)}</span>
              <span>{b.source}</span>
              <span>
                {plural(count(b.id), "item")} · {formatDate(b.createdAt)}
              </span>
              {b.sample && <SampleBadge />}
            </button>
          </li>
        ))}
      </ul>
      <div className="batch-actions">
        {adding ? (
          <form
            className="new-batch"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              onNewBatch({ name, kind, source });
              setName("");
              setSource("");
              setAdding(false);
            }}
          >
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
            <label>Kind
              <select value={kind} onChange={(e) => setKind(e.target.value as Batch["kind"])}>
                <option value="paper">Paper</option>
                <option value="session">Session</option>
              </select>
            </label>
            <label>{kind === "paper" ? "DOI" : "Session id"}<input value={source} onChange={(e) => setSource(e.target.value)} /></label>
            <div>
              <button type="submit" className="btn small primary" disabled={!name.trim()}>Add batch</button>
              <button type="button" className="btn small" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn block" onClick={() => setAdding(true)}>+ New batch</button>
        )}
        <RoadmapCard />
      </div>
    </nav>
  );
}

function NoteBody({ text }: { text: string }) {
  const [raw, setRaw] = useState(false);
  return (
    <div className="note-body">
      <div className="toggle small" role="group" aria-label="Note view">
        <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>Preview</button>
        <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>Raw</button>
      </div>
      {raw ? <p className="body">{text}</p> : <ChatMarkdown text={text} />}
    </div>
  );
}

function DetailPane({ state, item, onReview, onSelect, layout, onLayout }: { state: LabState; item: Item | undefined; onReview(id: string, r: Review): void; onSelect(id: string): void; layout: DetailLayout; onLayout(patch: Partial<DetailLayout>): void }) {
  const bottom = layout.dock === "bottom";
  const handle = bottom ? (
    <ResizeHandle axis="y" value={layout.height} min={DETAIL_MIN_HEIGHT} max={maxDetailHeight(window.innerHeight)} step={DETAIL_KEY_STEP} label="Resize detail height" className="detail-resizer"
      onChange={height => onLayout({ height })} onReset={() => onLayout({ height: defaultDetailHeight(window.innerHeight) })} />
  ) : null;
  const dockButton = (
    <button type="button" className="btn small dock-toggle" onClick={() => onLayout({ dock: bottom ? "right" : "bottom" })} title={bottom ? "Show the detail beside the table" : "Show the detail below the table"}>{bottom ? "Move to side" : "Move to bottom"}</button>
  );
  if (!item) {
    return (
      <aside className="detail is-empty" aria-label="Detail">
        <p className="empty">Select a row to see its detail.</p>
      </aside>
    );
  }
  const batch = state.batches.find((b) => b.id === item.batchId);
  const paper = item.type === "unit" ? state.items.find((i) => i.id === item.unit?.paperItemId) : undefined;
  const session = item.source ? state.sessions.find((s) => s.id === item.source?.sessionId) : undefined;
  const modelDrafted = !!item.source && item.source.model !== "researcher";

  return (
    <aside className="detail" aria-label="Detail">
      {handle}
      <div className="detail-top">
        <p className="eyebrow">
          {TYPE_TEXT[item.type]} · {batch?.name}
        </p>
        {dockButton}
      </div>
      <h2>{item.title}</h2>
      <div className="badges">
        {item.sample && <SampleBadge />}
        {item.type === "unit" && item.label && <LabelChip label={item.label} />}
        {item.type === "unit" && <ImplChip status={statusOf(item)} long />}
        {item.review === "reviewed" ? <span className="badge plain">Reviewed by researcher</span> : <span className="badge outline">Review pending</span>}
      </div>
      <VerdictLine check={item.citationCheck} modelDrafted={modelDrafted} review={item.review} />

      <div className="detail-scroll">
        {item.type === "paper" && <PaperDetail state={state} item={item} />}
        {item.type === "unit" && <UnitDetail item={item} paper={paper} />}
        {item.type === "snapshot" && <SnapshotDetail item={item} />}
        {(item.type === "finding" || item.type === "note") && <NoteBody key={item.id} text={item.body ?? ""} />}

        {item.source && (
          <dl className="fields source">
            <dt>Saved from</dt>
            <dd>
              {session ? `${session.title} (${session.sample ? "sample, " : ""}${session.endedAt ? "read-only" : "current"})` : item.source.sessionId}
            </dd>
            <dt>Model</dt>
            <dd>{item.source.model}</dd>
            <dt>Request</dt>
            <dd>{item.source.requestId}</dd>
          </dl>
        )}
        {item.type === "unit" && paper && (
          <p className="hint">
            <button type="button" className="linklike" onClick={() => onSelect(paper.id)}>Open paper: {paper.title}</button>
          </p>
        )}
      </div>
      <div className="detail-actions">
        <button type="button" className="btn small" onClick={() => onReview(item.id, item.review === "pending" ? "reviewed" : "pending")}>
          {item.review === "pending" ? "Mark reviewed" : "Mark pending"}
        </button>
        <span className="hint">Updated {formatDateTime(item.updatedAt)}</span>
      </div>
    </aside>
  );
}

function Reader({ spans, cited, strong }: { spans: { id: string; text: string }[]; cited: Set<string>; strong: Set<string> }) {
  return (
    <p className="reader" aria-label="Paper text with sentence spans">
      {spans.map((s) => (
        <span key={s.id} className={`span${cited.has(s.id) ? " cited" : ""}${strong.has(s.id) ? " strong" : ""}`} data-span={s.id}>
          <b>{s.id}</b> {s.text}{" "}
        </span>
      ))}
    </p>
  );
}

function PaperDetail({ state, item }: { state: LabState; item: Item }) {
  const paper = item.paper!;
  const units = state.items.filter((i) => i.type === "unit" && i.unit?.paperItemId === item.id);
  const [picked, setPicked] = useState<string | undefined>();
  const citedBy = new Set(units.flatMap((u) => u.citedSpans));
  const spansCited = paper.spans.filter((s) => citedBy.has(s.id)).length;
  const citingUnits = units.filter((u) => u.citedSpans.length > 0).length;
  const pickedUnit = units.find((u) => u.id === picked);
  return (
    <>
      <dl className="fields">
        <dt>Source</dt>
        <dd>DOI {paper.doi}</dd>
        <dt>Spans</dt>
        <dd>{plural(paper.spans.length, "sentence")}</dd>
        <dt>Cited</dt>
        <dd>{spansCited} spans by {plural(citingUnits, "unit")}</dd>
      </dl>
      <h3>Reader</h3>
      <div className="unit-chips" role="group" aria-label="Units citing this paper">
        {units.map((u) => (
          <button type="button" key={u.id} aria-pressed={picked === u.id} onClick={() => setPicked(picked === u.id ? undefined : u.id)}>
            {u.title.split(" ")[0]}
          </button>
        ))}
      </div>
      <p className="hint">{pickedUnit ? `${pickedUnit.title} cites ${pickedUnit.citedSpans.join(", ") || "no spans"}.` : "Select a unit to highlight its cited spans."}</p>
      <Reader spans={paper.spans} cited={citedBy} strong={new Set(pickedUnit?.citedSpans ?? [])} />
    </>
  );
}

function UnitDetail({ item, paper }: { item: Item; paper: Item | undefined }) {
  const u = item.unit;
  const { label, status } = classify(item);
  const impl = isRegistered(item.implementation) ? REGISTRY[item.implementation!]! : undefined;
  return (
    <>
      <dl className="fields">
        <dt>Purpose</dt><dd>{u?.purpose || item.body || "—"}</dd>
        <dt>Inputs</dt><dd>{u?.inputs || "—"}</dd>
        <dt>Outputs</dt><dd>{u?.outputs || "—"}</dd>
        <dt>Parameters</dt><dd>{u?.parameters || "—"}</dd>
        <dt>Implementation</dt>
        <dd>{impl ? `${impl.name} (${impl.version})` : item.implementation === NO_IMPLEMENTATION || !item.implementation ? "None (spec only)" : item.implementation}</dd>
        <dt>Cited spans</dt><dd>{item.citedSpans.join(", ") || "None"}</dd>
        <dt>Label</dt>
        <dd>{LABEL_TEXT[label]} <span className="hint">({label === "reproduced" ? "cites spans of the paper" : "cites no span"})</span></dd>
        <dt>Status</dt>
        <dd>{STATUS_TEXT[status]}</dd>
        <dt>Citation check</dt>
        <dd>{item.citationCheck === "not-run" ? "Not run" : item.citationCheck.toUpperCase()} <span className="hint">(separate from implementation status)</span></dd>
      </dl>
      {paper?.paper && (
        <>
          <h3>Cited in {paper.title}</h3>
          <Reader spans={paper.paper.spans} cited={new Set(item.citedSpans)} strong={new Set(item.citedSpans)} />
        </>
      )}
    </>
  );
}

function SnapshotDetail({ item }: { item: Item }) {
  const d = item.snapshot!;
  const run = d.route ? routeRun(d.route) : null;
  return (
    <>
      <dl className="fields">
        <dt>Hash</dt><dd>{d.hash}</dd>
        <dt>Units</dt><dd>{d.units.length} ({runnableCount(d.units)} runnable)</dd>
        <dt>Route</dt><dd>{run ? `${run.version} over the saved layer` : "No route unit"}</dd>
        {run && (<><dt>Path length</dt><dd>{fmtNum(run.metrics.pathLengthM)} m</dd><dt>Turns &gt; 45 deg</dt><dd>{run.metrics.turnsOver45Deg}</dd></>)}
        <dt>Detector</dt><dd>{Object.entries(d.parameters.detector).map(([k, v]) => `${k} ${v}`).join(", ")}</dd>
      </dl>
      <h3>Units</h3>
      <ul className="snap-units">
        {d.units.map((u) => (
          <li key={u.unitId}>
            <span>{u.title}</span> <LabelChip label={u.label} short /> <ImplChip status={implementationStatus(u)} /> <span className="hint">{u.implementationVersion}</span>
          </li>
        ))}
      </ul>
      <p className="hint">Hash covers units, parameters and implementation versions. Review state is not part of it.</p>
    </>
  );
}
