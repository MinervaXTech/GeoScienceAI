import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { contours } from "d3-contour";
import polygonClipping from "polygon-clipping";
import type { Polygon } from "geojson";
import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import type { Connect, Plugin } from "vite";
import { ESRI_CREDITS, imagePixelToLngLat, lngLatToImagePixel, type SamFrame, type SamRequest, type SamResult, type SamDecodeSummary, type SamRunLog } from "../src/geo/sam.ts";
import { normalizeSamEvents, samOutputText, type SamEvent } from "./samProtocol.ts";
import { isSamRunLog, mergeSamRunLogs, newSamRunLog, SAM_LOG_LIMIT } from "../src/geo/samRunLog.ts";
import { samAreaError } from "../src/geo/samArea.ts";

const MAX_BODY = 8 * 1024 * 1024;
const MAX_RESPONSE = 16 * 1024 * 1024;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
class SamError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

export function validateSamRequest(value: unknown): SamRequest {
  if (!value || typeof value !== "object") throw new SamError("Invalid SAM image request.");
  const input = value as SamRequest;
  if (input.mapId !== undefined && (typeof input.mapId !== "string" || !/^[\w-]{1,100}$/.test(input.mapId))) throw new SamError("Invalid saved map id.");
  if (input.runId !== undefined && (typeof input.runId !== "string" || !/^[\w-]{1,100}$/.test(input.runId))) throw new SamError("Invalid SAM run id.");
  if (input.source !== "esri") throw new SamError("Select Esri World Imagery for SAM segmentation.");
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 100 || /[\n,;+<>]/.test(input.prompt)) throw new SamError("Enter one short concept, such as palm tree.");
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1 || input.width > 1024 || input.height > 1024) throw new SamError("SAM input must be a bounded image up to 1024 × 1024 pixels.");
  if (!Array.isArray(input.corners) || input.corners.length !== 4 || !input.corners.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85.051129)) throw new SamError("Map image coordinates are missing or invalid.");
  const areaError = samAreaError(input.area);
  if (areaError) throw new SamError(areaError);
  for (const point of input.area.coordinates[0]!) {
    const [x, y] = lngLatToImagePixel(input, [point[0]!, point[1]!]);
    if (x < -1 || x > input.width + 1 || y < -1 || y > input.height + 1) throw new SamError("The selected polygon is outside the captured image.");
  }
  if (typeof input.imageDataUrl !== "string" || input.imageDataUrl.length > MAX_BODY || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.imageDataUrl)) throw new SamError("Capture a PNG of the current satellite view.");
  const png = Buffer.from(input.imageDataUrl.split(",")[1]!, "base64");
  if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.readUInt32BE(16) !== input.width || png.readUInt32BE(20) !== input.height) throw new SamError("Captured PNG dimensions do not match its map coordinates.");
  return { ...input, prompt: input.prompt.trim() };
}

/** Decode the official SAM wire format, then georeference mask contours to the captured image. */
export async function decodeSamEvents(events: SamEvent[], frame: SamFrame, area?: Polygon, audit: SamDecodeSummary = newSamRunLog("decode", "upm", "").decoding): Promise<SamResult["regions"]> {
  audit.status = "error";
  let normalized: SamEvent[];
  try { normalized = normalizeSamEvents(events, audit.normalization); }
  catch (error) { throw new SamError(error instanceof Error ? error.message : "Invalid SAM event stream.", 502); }
  const parsed = await parseImageStream((async function* () { yield* normalized; })()).finalResult;
  audit.records = parsed.records.length;
  audit.boxes = recordsOfKind(parsed.records, "box").length;
  audit.masks = recordsOfKind(parsed.records, "mask").length;
  audit.diagnostics = parsed.diagnostics.map(({ severity, code, message, line }) => ({ severity, code, message, line }));
  if (parsed.outcome.status !== "completed" || parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) throw new SamError("SAM returned incomplete or malformed segmentation. See the run log.", 502);
  if (parsed.rawOutput.trim() && audit.masks === 0) throw new SamError("SAM returned text without segmentation masks. This is not a verified zero-match result.", 502);
  for (const match of parsed.rawOutput.matchAll(/<\|box;([^|]*)\|>/g)) {
    const fields = Object.fromEntries(match[1]!.split(";").map((part) => { const at = part.indexOf("="); return [part.slice(0, at).trim(), part.slice(at + 1).trim()]; }));
    if (Number(fields.w) !== frame.width || Number(fields.h) !== frame.height) throw new SamError("SAM output dimensions do not match the captured map.", 502);
  }
  const masks = recordsOfKind(parsed.records, "mask");
  if (masks.length > 2000) throw new SamError("Too many segments for this view. Zoom in and run a smaller area.", 502);
  let decodedPixels = 0, vertices = 0;
  const regions: SamResult["regions"] = { type: "FeatureCollection", features: [] };
  for (const record of masks) {
    const { mask, bounds: b } = record;
    decodedPixels += mask.width * mask.height;
    if ((record.frame?.frameIndex ?? 0) !== 0 || mask.width < 1 || mask.height < 1 || decodedPixels > 20_000_000 || b.left < 0 || b.top < 0 || b.right > frame.width || b.bottom > frame.height || b.right <= b.left || b.bottom <= b.top) throw new SamError("SAM mask bounds are invalid for the captured image.", 502);
    const raster = decodeMaskToRaster(mask);
    if (!raster.some((value) => value > 0)) { audit.emptyMasks++; continue; }
    const outline = contours().size([mask.width, mask.height]).smooth(false).contour(Array.from(raster), 0.5);
    const pixels = outline.coordinates.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [b.left + x! / mask.width * (b.right - b.left), b.top + y! / mask.height * (b.bottom - b.top)] as [number, number])));
    const clipped = area ? polygonClipping.intersection(pixels, [area.coordinates[0]!.map((point) => lngLatToImagePixel(frame, [point[0]!, point[1]!]))]) : pixels;
    const coordinates = clipped.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => {
      if (++vertices > 200_000) throw new SamError("Segmentation is too complex. Zoom in to a smaller area.", 502);
      return imagePixelToLngLat(frame, x, y);
    })));
    if (!coordinates.length) audit.clippedAway++;
    if (coordinates.length) regions.features.push({ type: "Feature", properties: { objectId: record.objectId, confidence: record.confidence ?? null, model: "sam-3.1" }, geometry: { type: "MultiPolygon", coordinates } });
  }
  audit.displayedSegments = regions.features.length; audit.status = "completed";
  return regions;
}

async function readEvents(response: Response, signal: AbortSignal) {
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw new SamError("SAM did not return its documented segmentation stream.", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE) throw new SamError("SAM response exceeded the image result limit.", 502);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const text = Buffer.concat(chunks).toString("utf8");
  const events: { type: string; [key: string]: unknown }[] = [];
  for (const block of text.replaceAll("\r\n", "\n").split("\n\n")) {
    const payload = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!payload || payload === "[DONE]") continue;
    const event = JSON.parse(payload);
    if (!event || typeof event.type !== "string") throw new SamError("Malformed SAM event stream.", 502);
    events.push(event);
  }
  return events;
}

interface SamStore {
  initial: SamResult | null;
  save(result: SamResult): Promise<void>;
  initialRuns?: SamRunLog[];
  saveRuns?(runs: SamRunLog[]): Promise<void>;
  hasResult?(id: string): boolean;
  loadResult?(id: string): Promise<SamResult | null>;
  saveResult?(result: SamResult): Promise<void>;
}

export function createSamHandler(key: string, send: typeof fetch = fetch, store?: SamStore) {
  let running = false;
  let latest = store?.initial ?? null;
  let runs = (store?.initialRuns?.length ? store.initialRuns : latest?.runLog ? [latest.runLog] : []).slice(0, SAM_LOG_LIMIT);
  const results = new Map<string, SamResult>();
  if (latest?.runLog?.id) results.set(latest.runLog.id, latest);
  const referenceFor = (run: SamRunLog) => [latest, ...results.values()].find((result) => result && (result.mapId ?? "upm") === run.mapId && result.imageSha256 === run.input?.imageSha256 && result.frame.width === run.input?.width && result.frame.height === run.input?.height);
  const recoverable = (run: SamRunLog) => run.status === "completed" && run.decoding.status === "completed" && !run.provider.outputTextTruncated && run.provider.outputTextPreview.length === run.provider.outputTextLength && !!referenceFor(run);
  const available = (run: SamRunLog) => run.status === "completed" && (results.has(run.id) || store?.hasResult?.(run.id) === true || recoverable(run));
  const loadRun = async (run: SamRunLog): Promise<SamResult | null> => {
    let result = results.get(run.id) ?? await store?.loadResult?.(run.id) ?? null;
    if (result && ((result.mapId ?? "upm") !== run.mapId || result.runLog?.id !== run.id)) return null;
    if (!result && recoverable(run)) {
      const reference = referenceFor(run)!;
      const audit = newSamRunLog(run.id, run.mapId, run.prompt).decoding;
      const regions = await decodeSamEvents([{ type: "response.output_text.done", item_id: "restored-output", output_index: 0, content_index: 0, text: run.provider.outputTextPreview }, { type: "response.completed", response: { model: "sam-3.1", status: "completed" } }], reference.frame, reference.area, audit);
      if (audit.masks !== run.decoding.masks || regions.features.length !== run.decoding.displayedSegments) return null;
      result = { model: "sam-3.1", mapId: run.mapId, prompt: run.prompt, source: reference.source, attribution: reference.attribution, frame: reference.frame, area: reference.area, imageSha256: reference.imageSha256, receivedAt: run.finishedAt!, durationMs: run.durationMs ?? 0, objects: regions.features.length, regions, runLog: { ...run, resultAvailable: true } };
      if (store?.saveResult) await store.saveResult(result);
    }
    if (result) results.set(run.id, result);
    return result;
  };
  const redact = (text: string, limit = 2000) => (key ? text.replaceAll(key, "[REDACTED]") : text).replace(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/g, "[image omitted]").slice(0, limit);
  const cleanLog = (run: SamRunLog): SamRunLog => JSON.parse(JSON.stringify(run, (_name, value: unknown) => typeof value === "string" ? redact(value, 8000) : value));
  const safeValue = (value: unknown, depth = 0): unknown => {
    if (typeof value === "string") return redact(value, 1000);
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (depth > 4) return "[truncated]";
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 30).map(([name, item]) => [name, safeValue(item, depth + 1)]));
    return undefined;
  };
  const recordRun = async (run: SamRunLog) => {
    const safe = cleanLog(run);
    runs = mergeSamRunLogs(runs, [safe]);
    if (store?.saveRuns) await store.saveRuns(runs).catch(() => { safe.warnings = [...(safe.warnings ?? []), "Run history could not be saved to disk; available in memory."]; });
    return safe;
  };
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === "/api/sam/status" && req.method === "GET") return json({ configured: !!key.trim(), model: "sam-3.1", usdPerImage: 0.0025, running, lastRunAt: latest?.receivedAt ?? null });
    if (url.pathname === "/api/sam/result" && req.method === "GET") {
      const id = url.searchParams.get("runId");
      if (!id) return json({ result: latest });
      if (!/^[\w-]{1,100}$/.test(id)) return json({ error: "Invalid SAM run id." }, 400);
      const run = runs.find((entry) => entry.id === id && entry.status === "completed");
      if (!run || (url.searchParams.has("mapId") && url.searchParams.get("mapId") !== run.mapId)) return json({ error: "No completed result was found for this map and run." }, 404);
      try {
        const result = await loadRun(run);
        return result ? json({ result }) : json({ error: "Only the JSON summary remains for this run; its masks cannot be restored." }, 404);
      } catch { return json({ error: "This saved SAM result could not be restored." }, 502); }
    }
    if (url.pathname === "/api/sam/runs" && req.method === "GET") return json({ runs: runs.map((run) => ({ ...run, resultAvailable: available(run) })) });
    if (url.pathname !== "/api/sam/run" || req.method !== "POST") return json({ error: "Unknown SAM operation." }, 404);
    if (req.headers.get("origin") !== url.origin || (req.headers.get("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin")) return json({ error: "Run SAM from this app." }, 403);
    if (!key.trim()) return json({ error: "Add MODEL_API_KEY to apps/lab/.env.local and restart the app." }, 503);
    if (running) return json({ error: "A SAM run is already in progress." }, 409);
    let acquired = false, run: SamRunLog | undefined, stage = "request";
    const started = Date.now();
    try {
      const raw = await req.text();
      if (Buffer.byteLength(raw) > MAX_BODY) return json({ error: "Captured image is too large." }, 413);
      let input: SamRequest;
      try { input = validateSamRequest(JSON.parse(raw)); } catch (e) { throw e instanceof SamError ? e : new SamError("Invalid SAM request JSON."); }
      if (running) return json({ error: "A SAM run is already in progress." }, 409);
      running = acquired = true;
      run = newSamRunLog(input.runId ?? randomUUID(), input.mapId ?? "upm", input.prompt);
      run.startedAt = new Date(started).toISOString(); run.status = "running";
      const imageSha256 = createHash("sha256").update(Buffer.from(input.imageDataUrl.split(",")[1]!, "base64")).digest("hex");
      run.input = { source: input.source, width: input.width, height: input.height, polygonCorners: input.area.coordinates[0]!.length - 1, imageSha256 };
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(120000)]);
      stage = "provider";
      const response = await send("https://api.meta.ai/v1/responses", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        redirect: "error", cache: "no-store", signal,
        body: JSON.stringify({ model: "sam-3.1", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: input.prompt }, { type: "input_image", image_url: input.imageDataUrl }] }], stream: true, store: false, metadata: { mask_encoding: "one_bit", include_confidence: "true" } }),
      });
      run.provider.httpStatus = response.status;
      run.provider.requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;
      run.provider.contentType = response.headers.get("content-type") ?? undefined;
      if (!response.ok) {
        const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
        if (reader) try { while (bytes < 8192) { const { value, done } = await reader.read(); if (done) break; chunks.push(value.subarray(0, 8192 - bytes)); bytes += value.byteLength; } } finally { await reader.cancel().catch(() => {}); }
        const body = Buffer.concat(chunks).toString("utf8");
        try {
          const parsed = JSON.parse(body), value = parsed.error && typeof parsed.error === "object" ? parsed.error : parsed;
          run.provider.response = { error: Object.fromEntries(["code", "type", "message", "param"].filter((name) => value[name] !== undefined).map((name) => [name, safeValue(value[name])])) };
        } catch { run.provider.response = { error: { message: redact(body, 1000) } }; }
        throw new SamError(`SAM rejected the image (HTTP ${response.status}). See the provider error in the run log. No automatic retry.`, 502);
      }
      stage = "stream";
      const events = await readEvents(response, signal);
      run.provider.eventCount = events.length;
      for (const event of events) run.provider.eventTypes[event.type] = (run.provider.eventTypes[event.type] ?? 0) + 1;
      const terminal = events.findLast((event) => ["response.completed", "response.failed", "response.incomplete", "error"].includes(event.type));
      run.provider.terminalEvent = terminal?.type;
      const providerResponse = terminal?.response;
      if (providerResponse && typeof providerResponse === "object") {
        const value = providerResponse as Record<string, unknown>;
        run.provider.response = Object.fromEntries(["id", "model", "status", "usage", "error", "incomplete_details"].filter((name) => value[name] !== undefined).map((name) => [name, safeValue(value[name])]));
      }
      const output = samOutputText(events);
      run.provider.outputTextLength = output.length;
      run.provider.outputTextPreview = redact(output);
      run.provider.outputTextTruncated = output.length > 2000;
      stage = "decode";
      const frame = { width: input.width, height: input.height, corners: input.corners };
      const regions = await decodeSamEvents(events, frame, input.area, run.decoding);
      run.status = "completed"; run.finishedAt = new Date().toISOString(); run.durationMs = Date.now() - started; run.resultAvailable = true;
      const result: SamResult = { model: "sam-3.1", ...(input.mapId ? { mapId: input.mapId } : {}), prompt: input.prompt, source: input.source, attribution: ESRI_CREDITS, frame, area: input.area, imageSha256, receivedAt: run.finishedAt, durationMs: run.durationMs, objects: regions.features.length, regions, runLog: cleanLog(run) };
      latest = result;
      results.set(run.id, result);
      if (store?.saveResult) await store.saveResult(result).catch(() => { run!.warnings = ["This run's masks are available in memory but could not be archived to disk."]; });
      if (store) await store.save(result).catch(() => { run!.warnings = ["Result could not be saved to disk; available in memory."]; });
      result.runLog = await recordRun(run);
      return json(result);
    } catch (e) {
      if (run) {
        run.status = req.signal.aborted ? "cancelled" : "error"; run.finishedAt = new Date().toISOString(); run.durationMs = Date.now() - started;
        run.error = { stage, message: redact(e instanceof Error ? e.message : "SAM run failed.", 1000) };
        run = await recordRun(run);
      }
      return json({ error: e instanceof SamError ? redact(e.message) : "SAM could not complete the request. See the run log. No automatic retry was made.", ...(run ? { runLog: run } : {}) }, e instanceof SamError ? e.status : 502);
    } finally { if (acquired) running = false; }
  };
}

export function samPlugin(key: string): Plugin {
  const resultFile = resolve(".local/sam/latest.json"), runsFile = resolve(".local/sam/runs.json");
  const archivedFile = (id: string) => /^[\w-]{1,100}$/.test(id) ? resolve(".local/sam/results", `${id}.json`) : null;
  let initial: SamResult | null = null, initialRuns: SamRunLog[] = [];
  try {
    const data = JSON.parse(readFileSync(resultFile, "utf8"));
    if (data.model === "sam-3.1" && data.source === "esri" && data.regions?.type === "FeatureCollection") initial = data;
  } catch { /* No previous local result. */ }
  try { const data = JSON.parse(readFileSync(runsFile, "utf8")); if (Array.isArray(data)) initialRuns = data.filter(isSamRunLog).filter((run) => run.finishedAt).slice(0, SAM_LOG_LIMIT); } catch { /* No previous run history. */ }
  const saveJson = async (file: string, value: unknown) => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file + ".tmp", JSON.stringify(value), { mode: 0o600 });
    await rename(file + ".tmp", file);
  };
  const handle = createSamHandler(key, fetch, {
    initial, initialRuns, save: (result) => saveJson(resultFile, result), saveRuns: (runs) => saveJson(runsFile, runs),
    hasResult: (id) => { const file = archivedFile(id); return !!file && existsSync(file); },
    loadResult: async (id) => { const file = archivedFile(id); if (!file) return null; try { const value = JSON.parse(readFileSync(file, "utf8")); return value.model === "sam-3.1" && value.regions?.type === "FeatureCollection" ? value : null; } catch { return null; } },
    saveResult: async (result) => { const file = archivedFile(result.runLog?.id ?? ""); if (!file) throw Error("Missing run id."); await saveJson(file, result); },
  });
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/sam/")) return next();
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.on("aborted", abort);
    res.on("close", abort);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size <= MAX_BODY) chunks.push(Buffer.from(chunk));
      }
      if (size > MAX_BODY) { res.statusCode = 413; res.end(JSON.stringify({ error: "Captured image is too large." })); return; }
      const headers = new Headers();
      for (const name of ["origin", "sec-fetch-site", "content-type"]) { const value = req.headers[name]; if (typeof value === "string") headers.set(name, value); }
      const response = await handle(new Request(new URL(req.url, `http://${req.headers.host ?? "localhost"}`), { method: req.method, headers, signal: controller.signal, ...(req.method === "POST" ? { body: Buffer.concat(chunks).toString("utf8") } : {}) }));
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { if (!res.writableEnded) { res.statusCode = 502; res.end(JSON.stringify({ error: "SAM request interrupted." })); } }
    finally { req.off("aborted", abort); res.off("close", abort); }
  };
  return { name: "sam-3-1", configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
