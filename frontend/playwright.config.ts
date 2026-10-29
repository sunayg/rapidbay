import { defineConfig } from "@playwright/test";

// Runs against a running RapidBay stack: BASE_URL=http://localhost:5050 npm run e2e
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:5050",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // The player starts on its own; a real user would have clicked to get here.
      use: { browserName: "chromium", launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } },
    },
  ],
});
