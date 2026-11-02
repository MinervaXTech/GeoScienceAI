import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptureMap } from "../geo/sam";
import type { Polygon } from "geojson";
import { samePolygon } from "../geo/samArea";
import { CROWN_CANDIDATE_LIMIT, CROWN_MAX_ROUNDS, countSectorMatches, crownSectors, type CrownCoverageFeedback, type CrownSector } from "../geo/crownCoverage";
import { applyCrownPolicy, crownSizePolicy, mergeCrownCandidatePool, type CrownSizePolicy } from "../geo/crownPhysical";
import { crownReviewSummary, invalidateChangedReviews, type CrownReviewStatus, type CrownSectorReview } from "../geo/crownReview";
import { DEFAULT_CROWN_AGENT_GOAL, validateCrownAgentCall, type CrownAgentDecision, type CrownAgentRun, type CrownToolOutcome, type MatchCrownsCall } from "../geo/crownAgent";
import { DEFAULT_MATCHING_SETTINGS, type CrownMatchResult, type CrownMatch, type PixelRect, type CrownImage, type MatchingSettings } from "../geo/templateMatch";
import { appendCrownTemplate, crownTemplateCaptureKey, recoverCrownTemplates, validTemplateSample, type CrownTemplateEntry } from "../geo/crownTemplates";

interface SavedMatching { image: CrownImage; sample: PixelRect | null; result: CrownMatchResult | null; agentRun?: CrownAgentRun | null; templateHistory?: CrownTemplateEntry[] }
async function savedMatching(mapId: string, value?: SavedMatching): Promise<SavedMatching | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("lab.crownMatching", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("maps");
    open.onerror = () => reject(Error("Browser storage is unavailable."));
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction("maps", value ? "readwrite" : "readonly");
      const store = transaction.objectStore("maps"), request = value ? store.put(value, mapId) : store.get(mapId);
      transaction.oncomplete = () => { db.close(); resolve(value ?? request.result ?? null); };
      transaction.onerror = () => { db.close(); reject(Error("Browser storage could not save this capture.")); };
    };
  });
}

export function useCrownMatching(mapId: string, activeArea?: Polygon | null, model: import("../geo/mapAgent").AgentModel = "muse-spark-1.3") {
  const [image, setImage] = useState<CrownImage | null>(null);
  const [sample, setSampleState] = useState<PixelRect | null>(null);
  const [result, setResult] = useState<CrownMatchResult | null>(null);
  const [agentGoal, setAgentGoal] = useState(DEFAULT_CROWN_AGENT_GOAL);
  const [agentRun, setAgentRun] = useState<CrownAgentRun | null>(null);
  const [agentConfigured, setAgentConfigured] = useState(false);
  const [agentMaxRounds, setAgentMaxRounds] = useState(8);
  const [keepExisting, setKeepExisting] = useState(true);
  const [settings, setSettings] = useState(DEFAULT_MATCHING_SETTINGS);
  const [shown, setShown] = useState(true);
  const [reviewShown, setReviewShown] = useState(true);
  const [referenceDiameter, setReferenceDiameter] = useState<number | null>(null);
  const [diameterTolerance, setDiameterTolerance] = useState(0.25);
  const [circleClearance, setCircleClearance] = useState(0);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [templateHistory, setTemplateHistory] = useState<CrownTemplateEntry[]>([]);
  const [templateCaptureKey, setTemplateCaptureKey] = useState<string | null>(null);
  const templates = useRef<CrownTemplateEntry[]>([]);
  const lastSaved = useRef<SavedMatching | null>(null);
  const pending = useRef<AbortController | null>(null);
  const worker = useRef<Worker | null>(null);
  const edited = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    let active = true;
    if (image) void crownTemplateCaptureKey(image).then((key) => { if (active) setTemplateCaptureKey(key); }).catch(() => {});
    return () => { active = false; };
  }, [image]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/crown-agent/status", { signal: controller.signal, cache: "no-store" }).then((response) => response.json()).then((data) => { if (!controller.signal.aborted) setAgentConfigured(data.configured === true); }).catch(() => {});
    return () => controller.abort();
  }, []);
  const areaKey = activeArea === undefined ? "unspecified" : JSON.stringify(activeArea);
  useEffect(() => { if (pending.current) pending.current.abort(); }, [areaKey]);
  const save = useCallback((value: SavedMatching) => {
    const snapshot = { ...value, templateHistory: templates.current }; lastSaved.current = snapshot;
    void savedMatching(mapId, snapshot).catch(() => { if (mounted.current) setStorageError("This result could not be saved in the browser. Download GeoJSON before closing."); });
  }, [mapId]);
  const publishTemplates = useCallback(() => {
    setTemplateHistory(templates.current);
    if (lastSaved.current) save(lastSaved.current);
  }, [save]);
  const updateTemplate = useCallback((id: string, patch: Partial<CrownTemplateEntry>) => {
    if (!mounted.current || !templates.current.some((entry) => entry.id === id)) return;
    templates.current = templates.current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry); publishTemplates();
  }, [publishTemplates]);
  const recordTemplate = useCallback((input: CrownImage, entry: CrownTemplateEntry) => {
    if (!validTemplateSample(entry.sample, input)) return;
    templates.current = appendCrownTemplate(templates.current, entry); publishTemplates();
    void (async () => {
      const captureKey = await crownTemplateCaptureKey(input);
      updateTemplate(entry.id, { captureKey });
      const bitmap = await createImageBitmap(await (await fetch(input.imageDataUrl)).blob());
      try {
        const canvas = document.createElement("canvas"), sample = entry.sample; canvas.width = sample.width; canvas.height = sample.height;
        const context = canvas.getContext("2d"); if (!context) return;
        context.drawImage(bitmap, sample.x, sample.y, sample.width, sample.height, 0, 0, sample.width, sample.height);
        updateTemplate(entry.id, { captureKey, thumbnail: canvas.toDataURL("image/png") });
      } finally { bitmap.close(); }
    })().catch(() => { /* Selection metadata remains available without a thumbnail. */ });
  }, [publishTemplates, updateTemplate]);
  useEffect(() => {
    mounted.current = true;
    void savedMatching(mapId).then((saved) => {
      if (!mounted.current || edited.current || !saved) return;
      lastSaved.current = saved;
      templates.current = (saved.templateHistory ?? []).map((entry) => entry.status === "running" ? { ...entry, status: "cancelled" as const, reason: `${entry.reason ?? ""} Matching was interrupted before an outcome was saved.`.trim() } : entry);
      setTemplateHistory(templates.current);
      const policy = saved.result ? saved.result.physical?.policy ?? crownSizePolicy(saved.result.sample) : null;
      const restored = saved.result && policy ? applyCrownPolicy(saved.result, policy) : null;
      setImage(saved.image); setSampleState(saved.sample); setResult(restored);
      if (restored) setSettings(restored.settings);
      if (policy) { setReferenceDiameter(policy.referenceDiameterPx); setDiameterTolerance(Math.max(0.1, Math.min(0.5, policy.maxDiameterPx / policy.referenceDiameterPx - 1))); setCircleClearance(policy.clearancePx); }
      const audit = saved.agentRun ?? restored?.agent ?? null;
      setAgentRun(audit?.areaReview && restored ? { ...audit, areaReview: { sectors: countSectorMatches(audit.areaReview.sectors, restored.matches), reviews: invalidateChangedReviews(audit.areaReview.sectors, countSectorMatches(audit.areaReview.sectors, restored.matches), audit.areaReview.reviews) } } : audit);
      if (!saved.templateHistory) void crownTemplateCaptureKey(saved.image).then((key) => {
        if (!mounted.current || edited.current) return;
        for (const entry of recoverCrownTemplates(key, restored, audit, saved.sample, restored?.settings ?? DEFAULT_MATCHING_SETTINGS).reverse()) recordTemplate(saved.image, entry);
      }).catch(() => {});
    }).catch(() => { if (mounted.current) setStorageError("Browser storage is unavailable; this session still works."); });
    return () => { mounted.current = false; pending.current?.abort(); worker.current?.terminate(); };
  }, [mapId, recordTemplate]);
  const loadImage = async (input: CrownImage, signal: AbortSignal) => {
    if (worker.current) return;
    if (input.source !== "esri" && input.source !== "earth-engine") throw Error("Use original Esri or Earth Engine imagery for crown detection.");
    edited.current = true;
    const bitmap = await createImageBitmap(await (await fetch(input.imageDataUrl)).blob());
    try {
      const scale = Math.min(1, 1024 / Math.max(input.width, input.height));
      const canvas = document.createElement("canvas"); canvas.width = Math.round(input.width * scale); canvas.height = Math.round(input.height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw Error("Image processing is unavailable.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const next = { ...input, width: canvas.width, height: canvas.height, imageDataUrl: canvas.toDataURL("image/png") };
      if (!mounted.current || signal.aborted) return;
      setImage(next); setTemplateCaptureKey(null); setSampleState(null); setResult(null); setAgentRun(null); setReferenceDiameter(null); setError(""); setShown(true);
      save({ image: next, sample: null, result: null });
    } finally { bitmap.close(); }
  };
  const capture = async (getImage: CaptureMap) => {
    if (pending.current || worker.current) return;
    const controller = new AbortController(); pending.current = controller;
    edited.current = true; setError(""); setPhase("Capturing selected polygon…");
    try { await loadImage(await getImage(controller.signal), controller.signal); }
    catch (e) { if (mounted.current && pending.current === controller) setError(controller.signal.aborted ? "Capture cancelled." : e instanceof Error ? e.message : "Capture failed."); }
    finally { if (pending.current === controller) { pending.current = null; if (mounted.current) setPhase(""); } }
  };
  const useImage = async (input: CrownImage) => {
    if (pending.current || worker.current) return;
    const controller = new AbortController(); pending.current = controller;
    try { setPhase("Loading capture…"); await loadImage(input, controller.signal); }
    catch (e) { if (mounted.current && pending.current === controller) setError(e instanceof Error ? e.message : "Capture could not be loaded."); }
    finally { if (pending.current === controller) { pending.current = null; if (mounted.current) setPhase(""); } }
  };
  const setSample = (value: PixelRect | null) => {
    if (!image || pending.current || worker.current) return;
    edited.current = true; setSampleState(value); setError("");
    if (value) recordTemplate(image, { id: crypto.randomUUID(), selectedAt: new Date().toISOString(), source: "manual", status: "selected", sample: value, settings: { ...settings } });
    save({ image, sample: value, result, agentRun });
  };
  const useTemplate = (id: string) => {
    const entry = templates.current.find((entry) => entry.id === id);
    if (!image || !entry || !templateCaptureKey || entry.captureKey !== templateCaptureKey || pending.current || worker.current) return;
    edited.current = true; setSampleState(entry.sample); setSettings(entry.settings); setError("");
    save({ image, sample: entry.sample, result, agentRun });
  };
  const cancel = () => {
    pending.current?.abort(); worker.current?.terminate(); worker.current = null;
    setPhase(""); setError("Detection cancelled. Previous successful matches are retained.");
  };
  const execute = async (input: CrownImage, template: PixelRect, parameters: MatchingSettings, controller: AbortController): Promise<CrownMatchResult> => {
    const started = performance.now();
    const bitmap = await createImageBitmap(await (await fetch(input.imageDataUrl, { signal: controller.signal })).blob());
    let rgba: Uint8ClampedArray;
    try {
      const canvas = document.createElement("canvas"); canvas.width = input.width; canvas.height = input.height;
      const context = canvas.getContext("2d"); if (!context) throw Error("Image processing is unavailable.");
      context.drawImage(bitmap, 0, 0); rgba = context.getImageData(0, 0, input.width, input.height).data;
    } finally { bitmap.close(); }
    controller.signal.throwIfAborted();
    const sectors = crownSectors(input.width, input.height, rgba);
    return new Promise((resolve, reject) => {
      const current = new Worker(new URL("./templateMatch.worker.ts", import.meta.url), { type: "module" }); worker.current = current;
      const finish = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); current.terminate(); if (worker.current === current) worker.current = null; };
      const abort = () => { finish(); reject(Error("Crown detection cancelled.")); };
      const timer = setTimeout(() => { finish(); reject(Error("Matching exceeded two minutes. Use a smaller capture or sample.")); }, 120000);
      controller.signal.addEventListener("abort", abort, { once: true });
      current.onmessage = (event: MessageEvent<{ type: string; progress: number; error: string; matches: CrownMatch[]; truncated: boolean }>) => {
        if (worker.current !== current || !mounted.current) return;
        if (event.data.type === "progress") { setProgress(event.data.progress); return; }
        finish();
        if (event.data.type === "error") reject(Error(event.data.error));
        else if (event.data.type === "result") resolve({ method: "normalized-cross-correlation-v1", mapId, receivedAt: new Date().toISOString(), durationMs: performance.now() - started, image: input, sample: template, settings: { ...parameters }, matches: event.data.matches, truncated: event.data.truncated, coverage: { mergedCount: event.data.matches.length, addedCandidates: event.data.matches.length, stagnantPasses: 0, initialCandidates: 0, templateCount: 1, mergeSpacing: parameters.spacing, samples: [template], sectors: countSectorMatches(sectors, event.data.matches), reviews: [] } });
        else reject(Error("Unexpected matching worker output."));
      };
      current.onerror = () => { finish(); reject(Error("The matching worker failed. Use a smaller capture or sample.")); };
      try { current.postMessage({ width: input.width, height: input.height, rgba, sample: template, settings: parameters }, [rgba.buffer]); }
      catch (e) { finish(); reject(e); }
    });
  };
  const run = async () => {
    if (!image || !sample || pending.current || worker.current) return;
    const controller = new AbortController(); pending.current = controller;
    edited.current = true; setAgentRun(null); setError(""); setProgress(0); setPhase("Matching crown template…");
    const templateId = crypto.randomUUID();
    recordTemplate(image, { id: templateId, selectedAt: new Date().toISOString(), source: "manual", status: "running", sample, settings: { ...settings } });
    try {
      const raw = await execute(image, sample, settings, controller);
      const policy = crownSizePolicy({ width: referenceDiameter ?? Math.min(sample.width, sample.height), height: referenceDiameter ?? Math.min(sample.width, sample.height) }, diameterTolerance, circleClearance);
      const completed = applyCrownPolicy(raw, policy); setReferenceDiameter(policy.referenceDiameterPx);
      if (!mounted.current || pending.current !== controller || controller.signal.aborted) return;
      updateTemplate(templateId, { status: "completed", candidates: completed.matches.length });
      setResult(completed); setShown(true); save({ image, sample, result: completed });
    } catch (e) { updateTemplate(templateId, { status: controller.signal.aborted ? "cancelled" : "error", reason: e instanceof Error ? e.message : "Matching failed." }); if (mounted.current && pending.current === controller) setError(controller.signal.aborted ? "Detection cancelled. Previous successful matches are retained." : e instanceof Error ? e.message : "Matching failed."); }
    finally { if (pending.current === controller) { pending.current = null; if (mounted.current) setPhase(""); } }
  };
  const runAgent = async () => {
    if (!image || !agentConfigured || !agentGoal.trim() || pending.current || worker.current) return;
    if (activeArea !== undefined && !samePolygon(image.area, activeArea)) { setError("Capture the current polygon before running the crown agent."); return; }
    if ("earthEngine" in image && image.earthEngine?.nativeResolutionM != null && image.earthEngine.nativeResolutionM >= 10) { setError("This source is too coarse for individual palm crowns. Use higher-resolution original imagery."); return; }
    let requestedPolicy: CrownSizePolicy | null;
    try { requestedPolicy = referenceDiameter !== null ? crownSizePolicy({ width: referenceDiameter, height: referenceDiameter }, diameterTolerance, circleClearance) : null; }
    catch (e) { setError(e instanceof Error ? e.message : "Invalid crown size."); return; }
    const controller = new AbortController(); pending.current = controller; edited.current = true; setError(""); setProgress(0);
    const maxRounds = Math.max(2, Math.min(CROWN_MAX_ROUNDS, Math.round(agentMaxRounds)));
    const base = keepExisting && result?.image.imageDataUrl === image.imageDataUrl && samePolygon(result.image.area, image.area) ? result : null;
    const sampleHint = sample && (!base || JSON.stringify(sample) !== JSON.stringify(base.sample)) ? sample : null;
    const audit: CrownAgentRun = { id: crypto.randomUUID(), model, objective: agentGoal.trim(), startedAt: new Date().toISOString(), status: "running", steps: [], maxRounds, initialCandidates: base?.matches.length ?? 0 };
    const publish = () => { if (mounted.current && pending.current === controller) setAgentRun(structuredClone(audit)); };
    let previous: { call: MatchCrownsCall; outcome: CrownToolOutcome; imageSha256: string } | undefined;
    let successful: CrownMatchResult | null = base;
    let sectors: CrownSector[] = [], stagnantPasses = 0, templateCount = base?.coverage?.templateCount ?? (base ? 1 : 0);
    const samples: PixelRect[] = (base?.coverage?.samples ?? (base ? [base.sample] : [])).slice(-CROWN_MAX_ROUNDS);
    let coverage: CrownCoverageFeedback = { mergedCount: base?.matches.length ?? 0, addedCandidates: 0, stagnantPasses: 0, samples, sectors: [] };
    let matchingMs = 0;
    let shapePolicy: CrownSizePolicy | null = requestedPolicy ?? base?.physical?.policy ?? null;
    let reviews: CrownSectorReview[] = base ? agentRun?.areaReview?.reviews ?? base.coverage?.reviews ?? [] : [];
    const overlay = async (completed: CrownMatchResult) => {
      const bitmap = await createImageBitmap(await (await fetch(completed.image.imageDataUrl, { signal: controller.signal })).blob());
      try {
        const canvas = document.createElement("canvas"); canvas.width = completed.image.width; canvas.height = completed.image.height;
        const ctx = canvas.getContext("2d"); if (!ctx) throw Error("Candidate overlay is unavailable.");
        ctx.drawImage(bitmap, 0, 0); ctx.strokeStyle = "#ffda00"; ctx.lineWidth = 1;
        for (const hit of completed.matches) { ctx.beginPath(); ctx.arc(hit.x + hit.width / 2, hit.y + hit.height / 2, hit.radiusPx ?? Math.min(hit.width, hit.height) / 2, 0, Math.PI * 2); ctx.stroke(); }
        ctx.strokeStyle = "#00dfff"; ctx.fillStyle = "#ffffff"; ctx.font = "12px sans-serif";
        for (const sector of sectors) { ctx.strokeRect(sector.x, sector.y, sector.width, sector.height); ctx.fillText(`${sector.id}: ${sector.count}`, sector.x + 3, sector.y + 14); }
        return canvas.toDataURL("image/png");
      } finally { bitmap.close(); }
    };
    try {
      publish();
      const bitmap = await createImageBitmap(await (await fetch(image.imageDataUrl, { signal: controller.signal })).blob());
      try {
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext("2d"); if (!ctx) throw Error("Coverage analysis is unavailable.");
        ctx.drawImage(bitmap, 0, 0); sectors = countSectorMatches(crownSectors(image.width, image.height, ctx.getImageData(0, 0, image.width, image.height).data), base?.matches ?? []);
        coverage = { ...coverage, sectors, reviews }; audit.areaReview = { sectors, reviews }; publish();
      } finally { bitmap.close(); }
      for (let round = 1; round <= maxRounds; round++) {
        setPhase(`Muse is inspecting missed crown areas · round ${round}/${maxRounds}…`);
        const reviewOnly = round === maxRounds || stagnantPasses >= 3 || (successful?.matches.length ?? 0) >= CROWN_CANDIDATE_LIMIT;
        const overlayImageDataUrl = successful ? await overlay(successful) : undefined;
        const response = await fetch("/api/crown-agent/step", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ ...image, mapId, model, objective: audit.objective, sample: round === 1 ? sampleHint : null, previous, overlayImageDataUrl, round, maxRounds, coverage, shapePolicy, reviewOnly }) });
        const data = await response.json() as CrownAgentDecision & { error?: string };
        controller.signal.throwIfAborted();
        if (!response.ok) throw Error(data.error ?? "Muse could not plan crown detection.");
        if (data.model !== model || data.round !== round || typeof data.imageSha256 !== "string" || (audit.imageSha256 && data.imageSha256 !== audit.imageSha256)) throw Error("Muse agent returned mismatched image feedback.");
        audit.imageSha256 = data.imageSha256;
        const call = validateCrownAgentCall(data.call, image), step: CrownAgentRun["steps"][number] = { round, call, provider: data.provider };
        audit.steps.push(step); publish();
        if (call.name === "finish_crown_detection") {
          const incoming = call.arguments.sectorReviews ?? [];
          if (incoming.some((review) => !sectors.some((sector) => sector.id === review.id))) throw Error("Muse reviewed an area outside this image.");
          reviews = sectors.flatMap((sector) => { const review = incoming.find((r) => r.id === sector.id) ?? reviews.find((r) => r.id === sector.id); return review ? [{ ...review, ...(incoming.some((r) => r.id === sector.id) ? { reviewer: "muse" as const, reviewedAt: new Date().toISOString() } : {}) }] : []; });
          coverage = { ...coverage, reviews }; audit.areaReview = { sectors, reviews };
          const summary = crownReviewSummary(sectors, reviews);
          audit.status = summary.complete ? "completed" : "stopped";
          audit.reason = call.arguments.reason + (summary.complete ? " All image sectors have explicit assessments; these are not field verification." : ` Area review is incomplete: ${summary.pending} sectors are unreviewed, uncertain, missed, or conflicting.`);
          if (successful?.coverage) successful = { ...successful, coverage: { ...successful.coverage, reviews } };
          break;
        }
        if (reviewOnly) throw Error("The final step must review all image areas instead of running another matching pass.");
        const { sample: chosen, settings: parameters } = call.arguments;
        const templateId = `${audit.id}-${round}`;
        recordTemplate(image, { id: templateId, selectedAt: new Date().toISOString(), source: "muse", status: "running", sample: chosen, settings: parameters, round, runId: audit.id, reason: call.arguments.reason });
        setSampleState(chosen); setSettings(parameters); setPhase(`Matching crown candidates · agent round ${round}…`); setProgress(0);
        const started = performance.now();
        let outcome: CrownToolOutcome;
        try {
          const completed = await execute(image, chosen, parameters, controller); controller.signal.throwIfAborted();
          const beforeCount = successful?.matches.length ?? 0;
          const pool = mergeCrownCandidatePool(successful?.rawMatches ?? successful?.matches ?? [], completed.matches.map((hit) => ({ ...hit, templateRound: round })));
          const policy = shapePolicy ?? crownSizePolicy(chosen, diameterTolerance, circleClearance);
          const constrained = applyCrownPolicy({ ...completed, matches: pool.matches }, policy);
          shapePolicy = policy; setReferenceDiameter(policy.referenceDiameterPx);
          const merged = { matches: constrained.matches, truncated: pool.truncated, addedCandidates: Math.max(0, constrained.matches.length - beforeCount) };
          matchingMs += completed.durationMs; templateCount++;
          samples.push(chosen); if (samples.length > CROWN_MAX_ROUNDS) samples.shift();
          stagnantPasses = merged.addedCandidates === 0 ? stagnantPasses + 1 : 0;
          const nextSectors = countSectorMatches(sectors, merged.matches); reviews = invalidateChangedReviews(sectors, nextSectors, reviews); sectors = nextSectors;
          coverage = { mergedCount: merged.matches.length, addedCandidates: merged.addedCandidates, stagnantPasses, samples: [...samples], sectors, reviews }; audit.areaReview = { sectors, reviews };
          successful = { ...constrained, method: "multi-template-ncc-v1", rawMatches: pool.matches, matches: merged.matches, durationMs: matchingMs,
            truncated: !!successful?.truncated || completed.truncated || merged.truncated,
            coverage: { ...coverage, initialCandidates: audit.initialCandidates ?? 0, templateCount, mergeSpacing: 1, mergeMethod: "reference-size-nonoverlap-v1" } };
          const scores = completed.matches.map((m) => m.score);
          outcome = { status: "completed", count: scores.length, truncated: completed.truncated, durationMs: completed.durationMs,
            selfMatchOnly: completed.matches.length === 1 && completed.matches[0]!.x === chosen.x && completed.matches[0]!.y === chosen.y,
            scores: scores.length ? { min: Math.min(...scores), max: Math.max(...scores), mean: scores.reduce((a, b) => a + b, 0) / scores.length } : null,
            matches: completed.matches.slice(0, 30).map(({ x, y, width, height, score }) => ({ x, y, width, height, score })), coverage };
          setResult(successful); setShown(true);
        } catch (e) {
          if (controller.signal.aborted) updateTemplate(templateId, { status: "cancelled", reason: "Matching cancelled before an outcome was available." });
          controller.signal.throwIfAborted();
          stagnantPasses++; coverage = { ...coverage, stagnantPasses };
          outcome = { status: "error", count: 0, truncated: false, durationMs: performance.now() - started, selfMatchOnly: false, scores: null, matches: [], error: e instanceof Error ? e.message : "Matching failed.", coverage };
        }
        updateTemplate(templateId, { status: outcome.status, candidates: outcome.status === "completed" ? outcome.count : undefined, addedCandidates: outcome.coverage?.addedCandidates, ...(outcome.error ? { reason: outcome.error } : {}) });
        step.outcome = outcome; publish(); previous = { call, outcome, imageSha256: data.imageSha256 };
        if (successful) {
          const checkpoint: CrownAgentRun = { ...structuredClone(audit), status: "stopped", finishedAt: new Date().toISOString(), reason: "Saved coverage progress. Continue the search if this run was interrupted." };
          save({ image, sample: successful.sample, result: { ...successful, agent: checkpoint }, agentRun: checkpoint });
        }
        // No-gain and candidate-limit conditions reserve the next request for area review.
        if (round === maxRounds) { audit.status = successful ? "stopped" : "error"; audit.reason = `The ${maxRounds}-round search budget was reached. ${successful?.matches.length ?? 0} accumulated candidates are saved. Continue coverage to search further; this does not certify that all trees were found.`; }
      }
    } catch (e) { audit.status = controller.signal.aborted ? "cancelled" : "error"; audit.reason = e instanceof Error ? e.message : "Crown agent failed."; if (mounted.current && pending.current === controller) setError(audit.reason); }
    finally {
      audit.finishedAt = new Date().toISOString(); publish();
      if (mounted.current && pending.current === controller) {
        if (successful) { const completed = { ...successful, agent: structuredClone(audit) }; setResult(completed); save({ image, sample: completed.sample, result: completed, agentRun: structuredClone(audit) }); }
        else save({ image, sample, result, agentRun: structuredClone(audit) });
      }
      if (pending.current === controller) { pending.current = null; if (mounted.current) setPhase(""); }
    }
  };
  const areaReview = useMemo(() => agentRun?.areaReview ?? (result?.coverage ? { sectors: result.coverage.sectors, reviews: result.coverage.reviews ?? [] } : null), [agentRun?.areaReview, result?.coverage]);
  const updateReview = (review: NonNullable<typeof areaReview>) => {
    if (!agentRun) return null;
    const summary = crownReviewSummary(review.sectors, review.reviews);
    const finished = agentRun.status === "completed" || agentRun.status === "stopped";
    return { ...agentRun, areaReview: review, ...(finished ? { status: summary.complete ? "completed" as const : "stopped" as const, reason: `Area review updated: ${summary.resolved}/${summary.total} sectors assessed without an outstanding issue; ${summary.pending} pending. Assessments are not field verification. Original model decisions remain in the step log.` } : {}) };
  };
  const applyConstraints = () => {
    if (!image || !result || pending.current) return;
    try {
      const diameter = referenceDiameter ?? Math.min(sample?.width ?? result.sample.width, sample?.height ?? result.sample.height);
      const updated = applyCrownPolicy(result, crownSizePolicy({ width: diameter, height: diameter }, diameterTolerance, circleClearance));
      const review = areaReview ? { sectors: countSectorMatches(areaReview.sectors, updated.matches), reviews: invalidateChangedReviews(areaReview.sectors, countSectorMatches(areaReview.sectors, updated.matches), areaReview.reviews) } : null;
      const audit = review ? updateReview(review) : agentRun;
      if (audit) updated.agent = audit;
      setResult(updated); setAgentRun(audit); setReferenceDiameter(diameter); save({ image, sample, result: updated, agentRun: audit });
    } catch (e) { setError(e instanceof Error ? e.message : "Crown constraints could not be applied."); }
  };
  const setSectorReview = (id: string, status: CrownReviewStatus) => {
    if (!image || !areaReview || pending.current || !areaReview.sectors.some((s) => s.id === id)) return;
    const reviews = [...areaReview.reviews.filter((r) => r.id !== id), { id, status, reason: "User review of the original image sector.", reviewer: "user" as const, reviewedAt: new Date().toISOString() }];
    const review = { sectors: areaReview.sectors, reviews };
    const audit = updateReview(review);
    const updated = result?.coverage ? { ...result, coverage: { ...result.coverage, reviews } } : result;
    if (updated && audit) updated.agent = audit;
    setAgentRun(audit); setResult(updated); save({ image, sample, result: updated, agentRun: audit });
  };
  return { image, sample, setSample, settings, setSettings, shown, setShown, result, phase, progress, error, storageError, busy: !!phase, capture, useImage, run, cancel,
    templateHistory, templateCaptureKey, useTemplate,
    agentConfigured, agentGoal, setAgentGoal, agentRun, runAgent, agentMaxRounds, setAgentMaxRounds, keepExisting, setKeepExisting, referenceDiameter, setReferenceDiameter, diameterTolerance, setDiameterTolerance, circleClearance, setCircleClearance, applyConstraints, areaReview, reviewShown, setReviewShown, setSectorReview };
}
export type CrownMatchingController = ReturnType<typeof useCrownMatching>;
