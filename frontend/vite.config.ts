/// <reference types="vitest" />
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

// Served by FastAPI under /v2/ (entry page at /settings).
export default defineConfig({
  base: "/v2/",
  plugins: [vue()],
  server: { proxy: { "/api": "http://localhost:5000" } },
  test: { environment: "jsdom" },
});
