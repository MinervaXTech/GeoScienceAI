import { DEFAULT_SAM_CONCEPT } from "../src/geo/sam.ts";
import { validateEarthEngineProvenance } from "../src/geo/earthEngine.ts";
import type { MuseImage } from "../src/geo/muse.ts";
import { validateSamRequest } from "./sam.ts";

export function validateMuseInput(value: Record<string, unknown>) {
  if (value.source !== "esri" && value.source !== "earth-engine") throw Error("Choose an Esri capture or a previewed Earth Engine image for Muse.");
  // Reuse image/frame/polygon validation without extending SAM's source policy.
  const validated = validateSamRequest({ ...value, source: "esri", prompt: DEFAULT_SAM_CONCEPT });
  const { imageDataUrl, width, height, area, corners } = validated;
  const input: MuseImage = { imageDataUrl, width, height, area, corners, source: value.source,
    ...(value.source === "earth-engine" ? { earthEngine: validateEarthEngineProvenance(value.earthEngine) } : {}) };
  return { input, mapId: validated.mapId ?? "upm" };
}
