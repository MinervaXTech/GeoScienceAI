import { useCallback, useReducer } from "react";
import type { Polygon } from "geojson";
import { samePolygon, samAreaError, type AreaPoint } from "../geo/samArea";

interface AreaState {
  mode: "idle" | "draw" | "edit";
  vertices: AreaPoint[];
  polygon: Polygon | null;
  defaultPolygon: Polygon | null;
  history: AreaPoint[][];
  error: string;
}
type Action = { type: "start" | "edit" | "cancel" | "clear" | "undo" | "finish" }
  | { type: "restore"; polygon: Polygon | null; defaultPolygon: Polygon | null }
  | { type: "add"; point: AreaPoint }
  | { type: "move"; index: number; point: AreaPoint; checkpoint: boolean }
  | { type: "insert"; after: number; point: AreaPoint };
const idle = (polygon: Polygon | null, defaultPolygon: Polygon | null = null): AreaState => ({ mode: "idle", vertices: [], polygon, defaultPolygon, history: [], error: "" });
function reduceArea(state: AreaState, action: Action): AreaState {
  switch (action.type) {
    case "start": return { ...idle(state.polygon, state.defaultPolygon), mode: "draw" };
    case "edit": return state.mode === "idle" && state.polygon ? { ...idle(state.polygon, state.defaultPolygon), mode: "edit", vertices: state.polygon.coordinates[0]!.slice(0, -1).map((p) => [p[0]!, p[1]!]) } : state;
    case "cancel": return idle(state.polygon, state.defaultPolygon);
    case "clear": return idle(state.defaultPolygon, state.defaultPolygon);
    case "restore": return idle(action.polygon ?? action.defaultPolygon, action.defaultPolygon);
    case "add":
      if (state.mode !== "draw") return state;
      return state.vertices.length < 64 ? { ...state, vertices: [...state.vertices, action.point], error: "" } : { ...state, error: "Choose between 3 and 64 polygon corners." };
    case "move":
      if (state.mode !== "edit" || !state.vertices[action.index]) return state;
      return { ...state, vertices: state.vertices.map((p, i) => i === action.index ? action.point : p), history: action.checkpoint ? [...state.history, state.vertices] : state.history, error: "" };
    case "insert":
      if (state.mode !== "edit" || !state.vertices[action.after]) return state;
      if (state.vertices.length >= 64) return { ...state, error: "Choose between 3 and 64 polygon corners." };
      return { ...state, vertices: [...state.vertices.slice(0, action.after + 1), action.point, ...state.vertices.slice(action.after + 1)], history: [...state.history, state.vertices], error: "" };
    case "undo":
      if (state.mode === "edit") return state.history.length ? { ...state, vertices: state.history.at(-1)!, history: state.history.slice(0, -1), error: "" } : state;
      return { ...state, vertices: state.vertices.slice(0, -1), error: "" };
    case "finish": {
      if (state.mode === "idle") return state;
      const polygon: Polygon = { type: "Polygon", coordinates: [[...state.vertices, ...(state.vertices[0] ? [state.vertices[0]] : [])]] };
      const error = samAreaError(polygon);
      return error ? { ...state, error } : idle(polygon, state.defaultPolygon);
    }
  }
}

export function useSamArea(initialArea?: Polygon, defaultArea?: Polygon) {
  const [state, dispatch] = useReducer(reduceArea, { initialArea, defaultArea }, (value) => idle(value.initialArea ?? value.defaultArea ?? null, value.defaultArea ?? null));
  const start = useCallback(() => dispatch({ type: "start" }), []);
  const edit = useCallback(() => dispatch({ type: "edit" }), []);
  const cancel = useCallback(() => dispatch({ type: "cancel" }), []);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);
  const restore = useCallback((polygon: Polygon | null, defaultPolygon: Polygon | null = null) => dispatch({ type: "restore", polygon, defaultPolygon }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const addVertex = useCallback((point: AreaPoint) => dispatch({ type: "add", point }), []);
  const moveVertex = useCallback((index: number, point: AreaPoint, checkpoint: boolean) => dispatch({ type: "move", index, point, checkpoint }), []);
  const insertVertex = useCallback((after: number, point: AreaPoint) => dispatch({ type: "insert", after, point }), []);
  const finish = useCallback(() => dispatch({ type: "finish" }), []);
  return { defaultPolygon: state.defaultPolygon, usingDefault: !!state.defaultPolygon && samePolygon(state.polygon, state.defaultPolygon), drawing: state.mode !== "idle", editing: state.mode === "edit", vertices: state.vertices, polygon: state.polygon, error: state.error, canUndo: state.mode === "edit" ? state.history.length > 0 : state.vertices.length > 0, start, edit, cancel, clear, restore, undo, addVertex, moveVertex, insertVertex, finish };
}
export type SamAreaController = ReturnType<typeof useSamArea>;
