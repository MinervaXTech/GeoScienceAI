import { sessionAttachments } from "./attachments";
import type { Attachment } from "./types";
import { itemErrors } from "./validate";
import { savedMapError } from "./maps";
import { emptyState, SCHEMA_VERSION, type LabState } from "./types";

const sessionJson = (key: string, value: unknown) => key === "attachments" && Array.isArray(value) ? sessionAttachments(value as Attachment[]) : value;

export const STORAGE_KEY = "lab.state";
export const EXPORT_APP = "geoscience-lab";

export interface ExportFile {
  app: typeof EXPORT_APP;
  schemaVersion: number;
  exportedAt: string;
  state: LabState;
}

export type ParseResult = { ok: true; state: LabState } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Validates a state read from storage or a file. Items that contradict the label rule reject the whole state. */
export function parseState(raw: unknown): ParseResult {
  if (!isObj(raw)) return { ok: false, errors: ["Not a Lab state object."] };
  if (raw.schemaVersion !== SCHEMA_VERSION)
    return { ok: false, errors: [`Unsupported schema version ${String(raw.schemaVersion)}; this build reads version ${SCHEMA_VERSION}.`] };
  const { sessions, batches, items } = raw;
  if (!Array.isArray(sessions) || !Array.isArray(batches) || !Array.isArray(items))
    return { ok: false, errors: ["sessions, batches and items must all be arrays."] };
  const state = raw as unknown as LabState;
  const errors: string[] = [];
  if (state.maps !== undefined) {
    if (!Array.isArray(state.maps)) errors.push("maps must be an array.");
    else {
      const mapIds = new Set<string>();
      for (const map of state.maps) {
        const error = savedMapError(map);
        if (error) errors.push(error);
        else if (mapIds.has(map.id)) errors.push(`Duplicate map id ${map.id}.`);
        else mapIds.add(map.id);
      }
    }
  }
  if (state.activeMapId !== undefined && (typeof state.activeMapId !== "string" || (state.activeMapId !== "upm" && (!Array.isArray(state.maps) || !state.maps.some((map) => map?.id === state.activeMapId))))) errors.push("The active map is missing.");
  const batchIds = new Set(state.batches.map((b) => b?.id));
  const ids = new Set<string>();
  for (const i of state.items) {
    if (!isObj(i) || typeof i.id !== "string" || typeof i.title !== "string" || typeof i.type !== "string") {
      errors.push("An item is missing its id, title or type.");
      continue;
    }
    if (ids.has(i.id)) errors.push(`Duplicate item id ${i.id}.`);
    ids.add(i.id);
    if (!batchIds.has(i.batchId)) errors.push(`Item ${i.id} points to a missing batch.`);
    errors.push(...itemErrors(i));
  }
  if (state.sessions.filter((s) => s?.endedAt === undefined).length > 1) errors.push("More than one session is open.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, state: { schemaVersion: SCHEMA_VERSION, sessions: state.sessions, batches: state.batches, items: state.items, ...(state.maps !== undefined ? { maps: state.maps } : {}), ...(state.activeMapId !== undefined ? { activeMapId: state.activeMapId } : {}) } };
}

export function exportJson(state: LabState, now: string = new Date().toISOString()): string {
  const file: ExportFile = { app: EXPORT_APP, schemaVersion: SCHEMA_VERSION, exportedAt: now, state };
  return JSON.stringify(file, sessionJson, 2);
}

export function importJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["The file is not valid JSON."] };
  }
  if (!isObj(raw) || raw.app !== EXPORT_APP) return { ok: false, errors: ["This is not a Lab export file."] };
  if (raw.schemaVersion !== SCHEMA_VERSION)
    return { ok: false, errors: [`Unsupported export version ${String(raw.schemaVersion)}; this build reads version ${SCHEMA_VERSION}.`] };
  return parseState(raw.state);
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const defaultStorage = (): StorageLike | null => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

/** Reads the saved state. Anything missing, blocked or invalid gives an empty state plus a note for the UI. */
export function loadState(storage: StorageLike | null = defaultStorage()): { state: LabState; warning?: string } {
  if (!storage) return { state: emptyState(), warning: "Local storage is unavailable; changes will not persist." };
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (text === null) return { state: emptyState() };
    const parsed = parseState(JSON.parse(text));
    if (parsed.ok) return { state: parsed.state };
    return { state: emptyState(), warning: `Saved data was not loaded: ${parsed.errors[0]}` };
  } catch {
    return { state: emptyState(), warning: "Saved data could not be read." };
  }
}

export function saveState(state: LabState, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state, sessionJson));
    return true;
  } catch {
    return false;
  }
}
