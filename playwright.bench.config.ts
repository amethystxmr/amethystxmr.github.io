import { defineConfig, devices } from "@playwright/test";
import {
  APP_HOST,
  E2E_ASYNCIFY_PREVIEW_PORT,
  E2E_THREADS_PREVIEW_PORT,
} from "./tests/constants";

/**
 * Mainnet sync performance bench (not part of CI e2e).
 *
 * Primary CPU/memory numbers come from Chromium renderer process metrics
 * (covers the wallet web worker). Page JS heap is secondary only.
 */
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

const BENCH_TIMEOUT_MS = Number(
  process.env.BENCH_TIMEOUT_MS ?? 4 * 60 * 60 * 1000,
);
const BENCH_RUNS = Number(process.env.BENCH_RUNS ?? 10);
/** local: 8 variants + cake: 3 variants. */
const CELLS_PER_RUN = 11;

export default defineConfig({
  testDir: "./tests/bench",
  timeout: Math.max(
    BENCH_TIMEOUT_MS * CELLS_PER_RUN * Math.max(1, BENCH_RUNS),
    48 * 60 * 60 * 1000,
  ),
  expect: {
    timeout: 60_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list", { printSteps: true }]],
  use: {
    ...devices["Desktop Chrome"],
    // Headed by default (easier to diagnose stalls). BENCH_HEADLESS=1 or CI → headless.
    headless: process.env.BENCH_HEADLESS === "1" || Boolean(process.env.CI),
    serviceWorkers: "block",
    viewport: { width: 1460, height: 920 },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "bench",
      use: {
        baseURL: previewUrl(E2E_ASYNCIFY_PREVIEW_PORT),
      },
    },
  ],
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
  ],
});
