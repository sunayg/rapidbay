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
      testIgnore: /tv\.spec/,
      // The player starts on its own; a real user would have clicked to get here.
      use: { browserName: "chromium", launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } },
    },
    // Android TV: the UA flips the app into its tv-ui mode (see src/lib/focus.ts, TV_USER_AGENT);
    // only tv.spec.ts runs here, at the two sizes a TV browser reports (1080p, and 540p at 2x).
    ...[
      { name: "tv-1080", viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
      { name: "tv-540-2x", viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 },
    ].map(({ name, viewport, deviceScaleFactor }) => ({
      name,
      testMatch: /tv\.spec/,
      use: {
        browserName: "chromium" as const,
        viewport,
        deviceScaleFactor,
        userAgent:
          "Mozilla/5.0 (Linux; Android 12; BRAVIA 4K UR3 Build/STT1.220114.003) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
      },
    })),
  ],
});
