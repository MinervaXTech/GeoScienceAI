/** The chat agent can call only these app actions; no code or arbitrary URLs. */
export const AGENT_MODELS = ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1", "muse-wonder-1.0"] as const;
export type AgentModel = typeof AGENT_MODELS[number];
export const isAgentModel = (value: unknown): value is AgentModel => AGENT_MODELS.includes(value as AgentModel);
export type AgentModelChoice = AgentModel | "auto";
export const isAgentModelChoice = (value: unknown): value is AgentModelChoice => value === "auto" || isAgentModel(value);
export const agentModelLabel = (model: AgentModel) => model.replace("muse-spark-", "Muse Spark ").replace("muse-wonder-", "Muse Wonder ");

/** Local routing policy: no extra model call, and one concrete model per turn. */
export function resolveAgentModel(choice: AgentModelChoice, text: string, previous?: AgentModel): AgentModel {
  if (choice !== "auto") return choice;
  const prompt = text.trim();
  if (/\b(analy[sz]\w*|inspect\w*|compar\w*|detect\w*|diagnos\w*|reason\w*|optimi[sz]\w*|recommend\w*|trade[ -]?offs?|step[ -]by[ -]step)\b/i.test(prompt) || /\b(and then|after that|followed by)\b/i.test(prompt) || prompt.length > 500) return "muse-wonder-1.0";
  if (/^(yes|ok(?:ay)?|go ahead|continue|proceed|do (?:it|that)|try again)[.!\s]*$/i.test(prompt) && previous) return previous;
  return "muse-spark-1.3";
}
export const AGENT_ACTIONS = ["inspect_area", "open_tool", "open_sidebar", "set_basemap", "set_layer", "set_opacity", "fit_area", "polygon", "configure_planning", "generate_points", "load_matched_points", "edit_points", "undo_points", "compare_routes", "export_planning", "configure_sam", "run_sam", "use_sam_run", "configure_muse", "run_muse", "use_muse", "capture_crowns", "configure_crowns", "select_template", "use_template", "match_crowns", "detect_crowns", "apply_crown_constraints", "open_map", "add_map", "delete_map", "locate_map", "preview_earth_engine", "search_earth_engine", "cancel_operation", "propose_knowledge_capture", "query_knowledge", "read_paper", "compare_papers", "transcribe_page"] as const;
export type AgentAction = typeof AGENT_ACTIONS[number];
export interface MapAgentCall { action: AgentAction; parameters: Record<string, unknown> }
export interface MapAgentReceipt { ok: boolean; message: string; context?: Record<string, unknown> }
export interface MapAgentHandle {
  context(): Record<string, unknown>;
  execute(call: MapAgentCall, signal: AbortSignal, model: AgentModel): Promise<unknown>;
  cancel(): void;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function validateMapAgentCall(value: unknown): MapAgentCall {
  if (!object(value) || Object.keys(value).some(k => !["action", "parameters"].includes(k)) || !AGENT_ACTIONS.includes(value.action as AgentAction) || !object(value.parameters)) throw Error("Unknown map action or invalid arguments.");
  const p = value.parameters, a = value.action as AgentAction;
  const schemas: Record<AgentAction, Record<string, (v: unknown) => boolean>> = {
    propose_knowledge_capture: { attachmentId: string(100), url: (v: unknown) => typeof v === "string" && v.length <= 2000 && /^https:\/\/(arxiv\.org|doi\.org)\//i.test(v), reason: string(200) }, query_knowledge: { question: string(300), collection: string(60) }, read_paper: { paper: string(200), query: string(200), collection: string(60) }, compare_papers: { collection: string(60) }, transcribe_page: { paper: string(200), page: number(1, 300), collection: string(60) },
    inspect_area: {}, open_tool: { tab: choice("planning", "clusters", "sam", "muse", "crowns", "hide") }, open_sidebar: { tab: choice("maps", "layers", "snapshots", "knowledge", "collapse") },
    set_basemap: { value: choice("esri", "google") }, set_layer: { layer: choice("canopy", "peaks", "boundary", "sam", "muse", "crowns", "review", "points", "labels", "cover", "clusters", "route_a", "route_b"), shown: bool }, set_opacity: { layer: choice("canopy", "muse"), value: number(0, 100) }, fit_area: {},
    polygon: { operation: choice("draw", "edit", "finish", "cancel", "undo", "clear") },
    configure_planning: { scope: choice("map", "selection"), spacingM: number(2, 50), sensitivity: number(0, 1), useChmv2: bool, useSam: bool, minimumHeightM: number(0, 254) },
    generate_points: {}, load_matched_points: {}, edit_points: { mode: choice("view", "add", "move", "delete", "home", "exclude") }, undo_points: {}, compare_routes: {}, export_planning: { format: choice("csv", "geojson", "svg") },
    configure_sam: { prompt: string(100) }, run_sam: {}, use_sam_run: { id: string(100) }, configure_muse: { objective: string(2000), method: choice("adjustments", "generative"), source: choice("esri", "earth-engine") }, run_muse: {}, use_muse: {},
    capture_crowns: { source: choice("capture", "muse", "earth-engine") }, configure_crowns: { threshold: number(.4, .99), spacing: number(.25, 2), multiScale: bool, goal: string(1000), rounds: number(2, 12), diameter: number(6, 64), tolerance: number(0, .8), clearance: number(0, 16), keepExisting: bool }, select_template: { x: number(0, 1024), y: number(0, 1024), width: number(6, 64), height: number(6, 64) }, use_template: { id: string(100) }, match_crowns: {}, detect_crowns: {}, apply_crown_constraints: {},
    open_map: { id: string(100) }, add_map: { name: string(80) }, delete_map: { id: string(100) }, locate_map: { longitude: number(-180, 180), latitude: number(-85, 85), zoom: number(1, 22) }, preview_earth_engine: {}, search_earth_engine: {}, cancel_operation: {},
  };
  const required: Partial<Record<AgentAction, string[]>> = { propose_knowledge_capture: ["reason"], query_knowledge: ["question"], read_paper: ["paper", "query"], transcribe_page: ["paper", "page"], open_tool: ["tab"], open_sidebar: ["tab"], set_basemap: ["value"], set_layer: ["layer", "shown"], set_opacity: ["layer", "value"], polygon: ["operation"], edit_points: ["mode"], export_planning: ["format"], configure_sam: ["prompt"], use_sam_run: ["id"], capture_crowns: ["source"], select_template: ["x", "y", "width", "height"], use_template: ["id"], open_map: ["id"], delete_map: ["id"], locate_map: ["longitude", "latitude", "zoom"] };
  for (const [key, v] of Object.entries(p)) if (!schemas[a][key]?.(v)) throw Error(`Invalid ${key} for ${a}.`);
  for (const key of required[a] ?? []) if (!(key in p)) throw Error(`Missing ${key} for ${a}.`);
  if (a === "propose_knowledge_capture" && (!!p.attachmentId === !!p.url)) throw Error("Propose exactly one attachmentId or URL.");
  if (["rounds", "x", "y", "width", "height", "page"].some(k => k in p && !Number.isInteger(p[k]))) throw Error("Rounds and pixel coordinates must be integers.");
  return { action: a, parameters: p };
}
const choice = (...options: string[]) => (v: unknown) => typeof v === "string" && options.includes(v);
const bool = (v: unknown) => typeof v === "boolean";
const number = (min: number, max: number) => (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const string = (max: number) => (v: unknown) => typeof v === "string" && !!v.trim() && v.length <= max;
export interface AgentTrace { action: AgentAction; parameters: Record<string, unknown>; status: "running" | "completed" | "error"; result?: unknown; at: string }
export interface AgentChatMeta { model: AgentModel; modelSelection?: AgentModelChoice; mapId: string; status: "running" | "completed" | "error" | "cancelled"; steps: AgentTrace[]; requests: number; usage?: unknown }
