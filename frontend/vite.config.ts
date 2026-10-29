/// <reference types="vitest" />
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

// Served by FastAPI at / (every SPA route gets index.html; real files in dist are served as-is).
export default defineConfig({
  base: "/",
  plugins: [vue()],
  server: { proxy: { "/api": "http://localhost:5000" } },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], exclude: ["e2e/**", "node_modules/**"] },
});
