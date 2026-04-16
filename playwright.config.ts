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
  globalTimeout: 1_200_000,
  timeout: 600_000,
  // CI sometimes leaves open handles (monerod child process / worker threads),
  // which can prevent the Playwright process from exiting even after tests finish.
  // Force the process to end so the workflow can complete deterministically.
  forceExit: true,
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
    command: `npm run build && npm run preview -- --host ${APP_HOST} --port ${APP_PORT} --strictPort`,
    url: APP_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  metadata: {
    monerodRpcPort: MONEROD_RPC_PORT,
  },
});
