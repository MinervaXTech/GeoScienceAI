/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { googleMapsPlugin } from "./server/googleMaps.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), googleMapsPlugin(env.GOOGLE_MAPS_API_KEY ?? "")],
    test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"] },
  };
});
