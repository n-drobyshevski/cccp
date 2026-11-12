import { defineConfig } from "@playwright/test";

// Specs run against the dev server on :8791. Locally the installed Chrome is used; CI installs
// Playwright's chromium. Traces are off.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  workers: process.env.CI ? 2 : undefined,
  retries: 0,
  use: {
    baseURL: "http://localhost:8791",
    trace: "off",
    screenshot: "off",
    video: "off",
    ...(process.env.CI ? {} : { channel: "chrome" }),
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8791/favicon.ico",
    reuseExistingServer: true,
    timeout: 60_000,
    env: { PORT: "8791" },
  },
});
