/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { googleMapsPlugin } from "./server/googleMaps.ts";
import { samPlugin } from "./server/sam.ts";
import { placeSearchPlugin } from "./server/places.ts";
import { mapAgentPlugin } from "./server/mapAgent.ts";
import { musePlugin } from "./server/muse.ts";
import { musePyramidPlugin } from "./server/musePyramid.ts";
import { canopyPlugin } from "./server/canopy.ts";
import { createKnowledgeHandler, knowledgePlugin } from "./server/knowledge.ts";
import { paperRunPlugin } from "./server/paperrun.ts";
import { environmentsPlugin } from "./server/environments.ts";
import { crownAgentPlugin } from "./server/crownAgent.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const knowledge = createKnowledgeHandler(env.MODEL_API_KEY ?? "", { bin: env.GRAPHIFY_BIN });
  return {
    plugins: [react(), knowledgePlugin(env.MODEL_API_KEY ?? "", env.GRAPHIFY_BIN, knowledge), paperRunPlugin(env.MODEL_API_KEY ?? "", knowledge), environmentsPlugin(), mapAgentPlugin(env.MODEL_API_KEY ?? ""), googleMapsPlugin(env.GOOGLE_MAPS_API_KEY ?? ""), samPlugin(env.MODEL_API_KEY ?? ""), canopyPlugin(), crownAgentPlugin(env.MODEL_API_KEY ?? ""), musePyramidPlugin(), musePlugin(env.MODEL_API_KEY ?? ""), placeSearchPlugin(env.PHOTON_GEOCODER_URL)],
    test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"] },
  };
});
