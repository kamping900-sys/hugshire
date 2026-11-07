import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against a sandbox server (never live).
 * Start it first with `npm run dev`, or set E2E_BASE_URL.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  retries: 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3200", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 860 } } },
    { name: "mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
