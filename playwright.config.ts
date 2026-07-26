import { defineConfig, devices } from "@playwright/test";
import {
  APP_HOST,
  APP_PORT,
  APP_URL,
  E2E_ASYNCIFY_PREVIEW_PORT,
  E2E_THREADS_PREVIEW_PORT,
  MONEROD_RPC_PORT,
} from "./tests/constants";

const IS_HEADED = process.argv.includes("--headed");
const VARIANT_MATRIX_SPEC = "**/wasm_variant_matrix.spec.ts";

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
      name: "chromium-asyncify",
      testIgnore: VARIANT_MATRIX_SPEC,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: previewUrl(E2E_ASYNCIFY_PREVIEW_PORT),
        serviceWorkers: "block",
        viewport: { width: 1460, height: 920 },
        launchOptions: {
          devtools: IS_HEADED,
        },
      },
    },
    {
      name: "chromium-threads",
      testIgnore: VARIANT_MATRIX_SPEC,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: previewUrl(E2E_THREADS_PREVIEW_PORT),
        serviceWorkers: "block",
        viewport: { width: 1460, height: 920 },
        launchOptions: {
          devtools: IS_HEADED,
        },
      },
    },
    {
      name: "variant-no-headers-no-sw",
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
      name: "variant-headers-no-sw",
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
      name: "variant-no-headers-sw",
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
      name: "variant-headers-sw",
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
      command: previewCommand(E2E_ASYNCIFY_PREVIEW_PORT),
      url: previewUrl(E2E_ASYNCIFY_PREVIEW_PORT),
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: previewCommand(E2E_THREADS_PREVIEW_PORT, {
        AMETHYST_E2E_PREVIEW_COI: "1",
      }),
      url: previewUrl(E2E_THREADS_PREVIEW_PORT),
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: previewCommand(APP_PORT + 3),
      url: previewUrl(APP_PORT + 3),
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: previewCommand(APP_PORT + 4, {
        AMETHYST_E2E_PREVIEW_COI: "1",
      }),
      url: previewUrl(APP_PORT + 4),
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  metadata: {
    monerodRpcPort: MONEROD_RPC_PORT,
  },
});
