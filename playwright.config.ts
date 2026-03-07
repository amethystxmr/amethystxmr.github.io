import { defineConfig, devices } from "@playwright/test";
import {
  APP_HOST,
  APP_PORT,
  APP_URL,
  MONEROD_RPC_PORT,
} from "./tests/constants";

const IS_HEADED = process.argv.includes("--headed");

export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  expect: {
    timeout: 60_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: APP_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1460, height: 920 },
        launchOptions: {
          devtools: IS_HEADED,
        },
      },
    },
  ],
  globalSetup: "./tests/global.setup.ts",
  globalTeardown: "./tests/global.teardown.ts",
  webServer: {
    command: `npm run dev -- --host ${APP_HOST} --port ${APP_PORT} --strictPort`,
    url: APP_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  metadata: {
    monerodRpcPort: MONEROD_RPC_PORT,
  },
});
