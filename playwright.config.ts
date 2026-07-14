import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  // The product and its managed data-package store are intentionally single-instance.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm --filter @fly-setting/map-workbench build && " +
      "pnpm --filter @fly-setting/desktop-shell build && " +
      "node scripts/run-e2e-server.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: "electron",
      testMatch: /task001-electron\.spec\.ts/,
    },
    {
      name: "desktop-1440",
      testIgnore: /task001-electron\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "desktop-1366",
      testIgnore: /task001-electron\.spec\.ts/,
      use: { viewport: { width: 1366, height: 768 } },
    },
  ],
});
