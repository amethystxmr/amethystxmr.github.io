/**
 * Mainnet sync performance bench.
 *
 * Loop order is height → daemon → variant so Asyncify and Threads run back-to-back
 * for the same restore height and daemon (fairer comparison).
 *
 * Primary CPU/RSS metrics are Chromium renderer process totals (includes the wallet
 * web worker and WASM pthread workers). Main-isolate JS heap is logged only as a
 * secondary curiosity — it under-counts worker/WASM memory.
 *
 * Does not start monerod; verifies local/Cake are mainnet + synchronized.
 * Intermediate results print after each cell. Results JSON is written under
 * tests/bench/results/ (gitignored).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  APP_HOST,
  E2E_ASYNCIFY_PREVIEW_PORT,
  E2E_THREADS_PREVIEW_PORT,
} from "../constants";
import { NetworkTypes } from "../../monero-wasm-module/walletApi";
import { InitialWalletListPage } from "../pages/initial-wallet-list.page";
import { WalletMainPage } from "../pages/wallet-main.page";
import { assertDaemonReadyForBench } from "./helpers/daemonInfo";
import {
  createProcessMetricsTracker,
  formatBytes,
} from "./helpers/processMetrics";
import { waitUntilWalletSynced } from "./helpers/syncWait";

type WasmVariant = "asyncify" | "threads";
type DaemonKind = "local" | "cake";

type HeightCase = {
  label: string;
  height: number;
};

type CellResult = {
  variant: WasmVariant;
  daemon: DaemonKind;
  daemonAddress: string;
  heightLabel: string;
  restoreHeight: number;
  durationMs: number;
  finalWalletHeight: number | null;
  finalDaemonHeight: number | null;
  peakRendererRssBytes: number;
  cpuTimeDeltaSec: number;
  peakMainJsHeapUsedBytes: number | null;
};

const DEFAULT_SEED =
  "dogs zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero";

const DEFAULT_HEIGHTS: HeightCase[] = [
  { label: "today", height: 3723655 },
  { label: "1w", height: 3718615 },
  { label: "1m", height: 3702055 },
  { label: "2m", height: 3680455 },
];

const DEFAULT_LOCAL = "http://localhost:18081";
const DEFAULT_CAKE = "https://xmr-node.cakewallet.com:18081";

function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function parseHeights(): HeightCase[] {
  const raw = process.env.BENCH_HEIGHTS;
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_HEIGHTS;
  }
  const heights = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10));
  if (heights.some((height) => Number.isNaN(height))) {
    throw new Error(`Invalid BENCH_HEIGHTS=${raw}`);
  }
  const labels = ["today", "1w", "1m", "2m"];
  return heights.map((height, index) => ({
    label: labels[index] ?? `h${height}`,
    height,
  }));
}

function previewUrl(variant: WasmVariant): string {
  const port =
    variant === "threads"
      ? E2E_THREADS_PREVIEW_PORT
      : E2E_ASYNCIFY_PREVIEW_PORT;
  return `http://${APP_HOST}:${port}`;
}

async function applyBenchSettings(
  page: Page,
  daemonAddress: string,
): Promise<void> {
  await page.addInitScript(
    ({ daemonAddress, networkType }) => {
      localStorage.setItem(
        "options",
        JSON.stringify({
          loadLastWallet: false,
          daemonAddress,
          networkType,
          allowMismatchedDaemonVersion: true,
        }),
      );
    },
    {
      daemonAddress,
      networkType: NetworkTypes.MAINNET,
    },
  );
}

async function assertActiveWasmVariant(
  page: Page,
  expected: WasmVariant,
): Promise<void> {
  await page.getByRole("button", { name: /options/i }).click();
  const buildInfo = page.locator('[aria-label="Build information"]');
  await expect(buildInfo).toBeVisible();
  await expect(buildInfo).toContainText(expected);
  await page.getByRole("button", { name: /←\s*Back/i }).click();
  await expect(
    page.getByRole("button", { name: /^(?:↺\s*)?Restore$/i }),
  ).toBeVisible();
}

async function fillRestoreForm(
  page: Page,
  params: { walletName: string; seed: string; startingHeight: string },
): Promise<void> {
  const initial = new InitialWalletListPage(page);
  await initial.openRestoreWallet();
  await page
    .locator("div")
    .filter({ hasText: /^Wallet name$/ })
    .locator("input")
    .first()
    .fill(params.walletName);
  await page
    .locator("div")
    .filter({ hasText: /^Seed phrase/ })
    .locator("textarea")
    .first()
    .fill(params.seed);
  const heightInput = page
    .locator("div")
    .filter({ hasText: /^Starting height/ })
    .locator("input")
    .first();
  await heightInput.fill(params.startingHeight);
  await expect(heightInput).toHaveValue(params.startingHeight);
}

function cellLabel(result: {
  heightLabel: string;
  daemon: DaemonKind;
  variant: WasmVariant;
}): string {
  return `${result.heightLabel}/${result.daemon}/${result.variant}`;
}

function printCellResult(result: CellResult): void {
  console.log(
    `[bench] DONE ${cellLabel(result)} ` +
      `height=${result.restoreHeight} ` +
      `duration=${(result.durationMs / 1000).toFixed(1)}s ` +
      `final=${result.finalWalletHeight ?? "?"}/${result.finalDaemonHeight ?? "?"} ` +
      `peakRss=${formatBytes(result.peakRendererRssBytes)} ` +
      `cpuΔ=${result.cpuTimeDeltaSec.toFixed(2)}s ` +
      `mainHeapPeak=${
        result.peakMainJsHeapUsedBytes === null
          ? "n/a"
          : formatBytes(result.peakMainJsHeapUsedBytes)
      }`,
  );
}

function printSummary(results: CellResult[]): void {
  console.log("\n[bench] ===== SUMMARY =====");
  console.log(
    "heightLabel\tdaemon\tvariant\trestoreHeight\tdurationSec\tpeakRssMiB\tcpuDeltaSec\tfinalHeights",
  );
  for (const result of results) {
    console.log(
      [
        result.heightLabel,
        result.daemon,
        result.variant,
        result.restoreHeight,
        (result.durationMs / 1000).toFixed(1),
        (result.peakRendererRssBytes / (1024 * 1024)).toFixed(1),
        result.cpuTimeDeltaSec.toFixed(2),
        `${result.finalWalletHeight ?? "?"}/${result.finalDaemonHeight ?? "?"}`,
      ].join("\t"),
    );
  }
  console.log("[bench] ====================\n");
}

async function runOneCell(params: {
  browser: Browser;
  variant: WasmVariant;
  daemon: DaemonKind;
  daemonAddress: string;
  heightCase: HeightCase;
  seed: string;
  timeoutMs: number;
}): Promise<CellResult> {
  const label = `${params.heightCase.label}/${params.daemon}/${params.variant}`;
  const context = await params.browser.newContext({
    baseURL: previewUrl(params.variant),
    serviceWorkers: "block",
    viewport: { width: 1460, height: 920 },
  });
  const page = await context.newPage();
  let metrics: Awaited<ReturnType<typeof createProcessMetricsTracker>> | null =
    null;

  try {
    await applyBenchSettings(page, params.daemonAddress);
    await page.goto("/");
    const initial = new InitialWalletListPage(page);
    await initial.waitUntilLoaded();
    await assertActiveWasmVariant(page, params.variant);

    const walletName = `bench-${params.variant}-${params.daemon}-${params.heightCase.label}-${Date.now()}`;
    await fillRestoreForm(page, {
      walletName,
      seed: params.seed,
      startingHeight: String(params.heightCase.height),
    });

    metrics = await createProcessMetricsTracker(params.browser, page);
    const baseline = await metrics.sample();
    const startedAtMs = Date.now();
    await page.getByRole("button", { name: /restore wallet/i }).click();

    const walletMain = new WalletMainPage(page);
    await walletMain.waitUntilLoaded(Math.min(params.timeoutMs, 120_000));

    const sync = await waitUntilWalletSynced({
      page,
      startedAtMs,
      timeoutMs: params.timeoutMs,
      metrics,
      baseline,
      progressLabel: label,
    });

    return {
      variant: params.variant,
      daemon: params.daemon,
      daemonAddress: params.daemonAddress,
      heightLabel: params.heightCase.label,
      restoreHeight: params.heightCase.height,
      durationMs: sync.durationMs,
      finalWalletHeight: sync.finalWalletHeight,
      finalDaemonHeight: sync.finalDaemonHeight,
      peakRendererRssBytes: sync.peakRendererRssBytes,
      cpuTimeDeltaSec: sync.cpuTimeDeltaSec,
      peakMainJsHeapUsedBytes: sync.peakMainJsHeapUsedBytes,
    };
  } finally {
    if (metrics) {
      await metrics.dispose();
    }
    await context.close();
  }
}

test.describe.configure({ mode: "serial" });

test("mainnet sync performance matrix", async ({ browser }) => {
  const seed = envOr("BENCH_SEED", DEFAULT_SEED);
  const localAddress = envOr("BENCH_DAEMON_LOCAL", DEFAULT_LOCAL);
  const cakeAddress = envOr("BENCH_DAEMON_REMOTE", DEFAULT_CAKE);
  const timeoutMs = Number(process.env.BENCH_TIMEOUT_MS ?? 4 * 60 * 60 * 1000);
  const heights = parseHeights();

  test.setTimeout(Math.max(timeoutMs * heights.length * 4, 60_000));

  const localInfo = await assertDaemonReadyForBench(localAddress, "local");
  const cakeInfo = await assertDaemonReadyForBench(cakeAddress, "cake");
  console.log(
    `[bench] local tip=${localInfo.height} synchronized=${localInfo.synchronized}`,
  );
  console.log(
    `[bench] cake tip=${cakeInfo.height} synchronized=${cakeInfo.synchronized}`,
  );
  console.log(
    `[bench] heights=${heights
      .map((height) => `${height.label}:${height.height}`)
      .join(", ")}`,
  );

  const daemons: Array<{ kind: DaemonKind; address: string }> = [
    { kind: "cake", address: cakeAddress },
    { kind: "local", address: localAddress },
  ];
  const variants: WasmVariant[] = ["asyncify", "threads"];
  const results: CellResult[] = [];

  // height → daemon → variant: keep Asyncify/Threads adjacent for fair comparisons
  for (const heightCase of heights) {
    for (const daemon of daemons) {
      for (const variant of variants) {
        console.log(
          `[bench] START ${heightCase.label}/${daemon.kind}/${variant} ` +
            `restoreHeight=${heightCase.height} daemon=${daemon.address}`,
        );
        const result = await runOneCell({
          browser,
          variant,
          daemon: daemon.kind,
          daemonAddress: daemon.address,
          heightCase,
          seed,
          timeoutMs,
        });
        results.push(result);
        printCellResult(result);
      }
    }
  }

  printSummary(results);

  const resultsDir = path.join(process.cwd(), "tests/bench/results");
  await mkdir(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(resultsDir, `sync-perf-${stamp}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        startedTips: {
          local: localInfo,
          cake: cakeInfo,
        },
        seedWordCount: seed.trim().split(/\s+/).length,
        heights,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`[bench] wrote ${outPath}`);
});
