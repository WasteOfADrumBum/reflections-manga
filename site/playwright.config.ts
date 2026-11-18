import { defineConfig, devices } from "@playwright/test";

/** End-to-end browser tests. They use the local dev server, which mocks OpenAI and GitHub. */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:8137", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8137/api/studio/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { PORT: "8137" },
  },
});
