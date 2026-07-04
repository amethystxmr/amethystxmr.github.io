import { defineConfig, devices } from "@playwright/test";
import {
  APP_HOST,
  APP_PORT,
  APP_URL,
  MONEROD_RPC_PORT,
} from "./tests/constants";

const IS_HEADED = process.argv.includes("--headed");
const VARIANT_MATRIX_SPEC = "wasm_variant_matrix.spec.ts";

function previewCommand(port: number, env: Record<string, string> = {}) {
  const envPrefix = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const command = `npm run preview -- --host ${APP_HOST} --port ${port} --strictPort`;
  return envPrefix ? `${envPrefix} ${command}` : command;
}

function previewUrl(port: number) {
  return `http://${APP_HOST}:${port}`;
}

export default defineConfig({
  testDir: "./tests",
  timeout: 600_000,
  expect: {
    timeout: 60_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["html", { open: "never" }],
    ["list", { printSteps: true }],
  ],
  use: {
    baseURL: APP_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-production",
      testIgnore: VARIANT_MATRIX_SPEC,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: APP_URL,
        viewport: { width: 1460, height: 920 },
        launchOptions: {
          devtools: IS_HEADED,
        },
      },
    },
    {
      name: "variant-asyncify-no-sw-no-sab",
      testMatch: VARIANT_MATRIX_SPEC,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: previewUrl(APP_PORT + 1),
        serviceWorkers: "block",
        viewport: { width: 1460, height: 920 },
        launchOptions: {
          devtools: IS_HEADED,
        },
      },
    },
    {
      name: "variant-threads-no-sw-sab",
      testMatch: VARIANT_MATRIX_SPEC,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: previewUrl(APP_PORT + 2),
        serviceWorkers: "block",
        viewport: { width: 1460, height: 920 },
        launchOptions: {
          devtools: IS_HEADED,
        },
      },
    },
    {
      name: "variant-asyncify-sw-no-sab",
      testMatch: VARIANT_MATRIX_SPEC,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: previewUrl(APP_PORT + 3),
        serviceWorkers: "allow",
        viewport: { width: 1460, height: 920 },
        launchOptions: {
          devtools: IS_HEADED,
        },
      },
    },
    {
      name: "variant-threads-sw-sab",
      testMatch: VARIANT_MATRIX_SPEC,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: previewUrl(APP_PORT + 4),
        serviceWorkers: "allow",
        viewport: { width: 1460, height: 920 },
        launchOptions: {
          devtools: IS_HEADED,
        },
      },
    },
  ],
  globalSetup: "./tests/global.setup.ts",
  globalTeardown: "./tests/global.teardown.ts",
  webServer: [
    {
      command: previewCommand(APP_PORT),
      url: APP_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: previewCommand(APP_PORT + 1),
      url: previewUrl(APP_PORT + 1),
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: previewCommand(APP_PORT + 2, {
        AMETHYST_E2E_PREVIEW_COI: "1",
      }),
      url: previewUrl(APP_PORT + 2),
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: previewCommand(APP_PORT + 3, {
        AMETHYST_E2E_SW_MODE: "claim-only",
      }),
      url: previewUrl(APP_PORT + 3),
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: previewCommand(APP_PORT + 4),
      url: previewUrl(APP_PORT + 4),
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  metadata: {
    monerodRpcPort: MONEROD_RPC_PORT,
  },
});
