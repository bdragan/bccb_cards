import { defineConfig } from "@playwright/test";

const apiUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:3000";
const webUrl = process.env.E2E_WEB_URL ?? "http://127.0.0.1:5173";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://cardgames:cardgames@localhost:5432/cardgames";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 120_000,
  use: {
    baseURL: webUrl,
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "corepack pnpm --filter @card-games/api dev",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        JWT_SECRET: process.env.JWT_SECRET ?? "change-me-in-dev",
        WEB_ORIGIN: webUrl,
      },
      url: `${apiUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "corepack pnpm --filter @card-games/web dev -- --host 127.0.0.1",
      env: {
        ...process.env,
        VITE_API_URL: apiUrl,
      },
      url: webUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
