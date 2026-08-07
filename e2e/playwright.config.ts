import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    // In Docker, BASE_URL is set to http://frontend:3000. The fallback is for
    // running Playwright from the host against `make e2e-up`, which publishes
    // the e2e frontend on 3002 (3001 belongs to the app stack / `make dev`).
    baseURL: process.env.BASE_URL ?? "http://localhost:3002",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: ".auth/session.json" },
      dependencies: ["setup"],
    },
  ],
});
