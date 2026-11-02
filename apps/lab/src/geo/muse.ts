import { isAgentModel, type AgentModel } from "./mapAgent.ts";
import type { SamFrame, SamImage } from "./sam.ts";
import type { EarthEngineProvenance } from "./earthEngine.ts";

export const MUSE_MODEL = "muse-spark-1.3";
export const MUSE_IMAGE_MODEL = "muse-image-1.0";
export type MuseMethod = "adjustments" | "generative";
export const isMuseModel = (value: unknown) => isAgentModel(value) || value === MUSE_IMAGE_MODEL;
export const DEFAULT_MUSE_OBJECTIVE = "Conservatively restore the selected satellite area: reduce noise and mild blur while preserving observed crown sizes, centres, spacing and gaps. Leave unresolved detail uncertain. Analyze the original land cover, canopy patterns and access routes, and suggest useful map improvements.";
export interface EnhancementSettings { brightness: number; contrast: number; saturation: number; sharpen: number; reason: string }
export interface MuseAnalysis {
  summary: string;
  observations: string[];
  improvements: { title: string; action: string; reason: string }[];
  limitations: string[];
  enhancementReview: string;
}
export interface MuseStep {
  stage: string;
  status: "completed" | "error";
  at: string;
  detail: Record<string, unknown>;
}
export interface MuseImage extends Omit<SamImage, "source"> { source: "esri" | "earth-engine"; earthEngine?: EarthEngineProvenance }
export type MuseCapture = (signal: AbortSignal) => Promise<MuseImage>;
export const museSourceLabel = (image: MuseImage) => image.source === "earth-engine" ? `Earth Engine · ${image.earthEngine?.assetId ?? "image asset"}` : "Esri World Imagery";
export interface MuseResult {
  id: string;
  model: AgentModel | typeof MUSE_IMAGE_MODEL;
  reviewModel?: AgentModel;
  method?: MuseMethod;
  mapId: string;
  mapName: string;
  objective: string;
  receivedAt: string;
  durationMs: number;
  status: "completed" | "partial";
  input: MuseImage;
  inputSha256: string;
  enhancedImageDataUrl: string;
  enhancedSha256: string;
  settings?: EnhancementSettings;
  enhancedFrame?: SamFrame;
  generation?: { model: typeof MUSE_IMAGE_MODEL; prompt: string; nativeWidth: number; nativeHeight: number; nativeSha256: string; geometryVerified: false };
  analysis: MuseAnalysis | null;
  error?: string;
  trace: MuseStep[];
}
