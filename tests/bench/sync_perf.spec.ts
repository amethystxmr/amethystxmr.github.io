/**
 * Mainnet sync performance bench.
 *
 * One restore height: tip - BENCH_HEIGHT_DIFF (default 10080 ≈ 2 weeks).
 * Loop order: daemon → variant so comparable variants stay adjacent.
 *
 * Variants:
 * - asyncify
 * - threads (full navigator.hardwareConcurrency)
 * - threads4 (hardwareConcurrency forced to 4 in the wallet worker)
 * - native0 (monero-wallet-cli --max-concurrency 0 = all cores)
 * - native4 (monero-wallet-cli --max-concurrency 4)
 *
 * CPU: cpuWorkSec (total CPU-seconds) and avgCores (cpuWork/wall).
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
  assertWalletCliExists,
  resolveWalletCliPath,
  runNativeWalletCliSync,
} from "./helpers/nativeWalletCli";
import {
  createProcessMetricsTracker,
  formatBytes,
  pickPageRendererPid,
  readRendererCpuByPid,
  snapshotRendererCpuByPid,
} from "./helpers/processMetrics";
import { waitUntilWalletSynced } from "./helpers/syncWait";

type DaemonKind = "local" | "cake";
type BenchVariant =
  | "asyncify"
  | "threads"
  | "threads4"
  | "native0"
  | "native4";

type CellResult = {
  variant: BenchVariant;
  daemon: DaemonKind;
  daemonAddress: string;
  heightDiff: number;
  restoreHeight: number;
  tipHeight: number;
  durationMs: number;
  finalWalletHeight: number | null;
  finalDaemonHeight: number | null;
  peakRssBytes: number;
  cpuWorkSec: number;
  avgCoresUsed: number;
  peakMainJsHeapUsedBytes: number | null;
  blocksReceived: number | null;
};

const DEFAULT_SEED =
  "dogs zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero";

/** ~2 weeks at 720 blocks/day. */
const DEFAULT_HEIGHT_DIFF = 10_080;

const DEFAULT_LOCAL = "http://localhost:18081";
const DEFAULT_CAKE = "https://xmr-node.cakewallet.com:18081";

function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function parseHeightDiff(): number {
  const raw = process.env.BENCH_HEIGHT_DIFF;
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_HEIGHT_DIFF;
  }
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) {
    throw new Error(`Invalid BENCH_HEIGHT_DIFF=${raw}`);
  }
  return value;
}

function previewUrl(variant: BenchVariant): string {
  if (variant === "asyncify") {
    return `http://${APP_HOST}:${E2E_ASYNCIFY_PREVIEW_PORT}`;
  }
  return `http://${APP_HOST}:${E2E_THREADS_PREVIEW_PORT}`;
}

function isWasmVariant(
  variant: BenchVariant,
): variant is "asyncify" | "threads" | "threads4" {
  return (
    variant === "asyncify" || variant === "threads" || variant === "threads4"
  );
}

async function applyBenchSettings(
  page: Page,
  daemonAddress: string,
  hardwareConcurrencyOverride: number | null,
): Promise<void> {
  await page.addInitScript(
    ({ daemonAddress, networkType, hardwareConcurrencyOverride }) => {
      localStorage.setItem(
        "options",
        JSON.stringify({
          loadLastWallet: false,
          daemonAddress,
          networkType,
          allowMismatchedDaemonVersion: true,
        }),
      );
      if (hardwareConcurrencyOverride !== null) {
        Object.defineProperty(navigator, "hardwareConcurrency", {
          configurable: true,
          enumerable: true,
          get: () => hardwareConcurrencyOverride,
        });
      }
    },
    {
      daemonAddress,
      networkType: NetworkTypes.MAINNET,
      hardwareConcurrencyOverride,
    },
  );
}

function patchWorkerHardwareConcurrency(
  page: Page,
  hardwareConcurrencyOverride: number | null,
): void {
  if (hardwareConcurrencyOverride === null) {
    return;
  }
  page.on("worker", (worker) => {
    void worker
      .evaluate((n) => {
        Object.defineProperty(navigator, "hardwareConcurrency", {
          configurable: true,
          enumerable: true,
          get: () => n,
        });
      }, hardwareConcurrencyOverride)
      .catch(() => {
        // Worker may exit before evaluate runs; WASM download usually leaves enough time.
      });
  });
}

async function assertActiveWasmVariant(
  page: Page,
  expectedUiVariant: "asyncify" | "threads",
): Promise<void> {
  await page.getByRole("button", { name: /options/i }).click();
  const buildInfo = page.locator('[aria-label="Build information"]');
  await expect(buildInfo).toBeVisible();
  await expect(buildInfo).toContainText(expectedUiVariant);
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
  daemon: DaemonKind;
  variant: BenchVariant;
}): string {
  return `${result.daemon}/${result.variant}`;
}

function printCellResult(result: CellResult): void {
  console.log(
    `[bench] DONE ${cellLabel(result)} ` +
      `restoreHeight=${result.restoreHeight} (tip-${result.heightDiff}) ` +
      `duration=${(result.durationMs / 1000).toFixed(1)}s ` +
      `final=${result.finalWalletHeight ?? "?"}/${result.finalDaemonHeight ?? "?"} ` +
      `peakRss=${formatBytes(result.peakRssBytes)} ` +
      `cpuWork=${result.cpuWorkSec.toFixed(2)}s ` +
      `avgCores=${result.avgCoresUsed.toFixed(2)}` +
      (result.blocksReceived !== null
        ? ` blocks=${result.blocksReceived}`
        : "") +
      (result.peakMainJsHeapUsedBytes !== null
        ? ` mainHeapPeak=${formatBytes(result.peakMainJsHeapUsedBytes)}`
        : ""),
  );
}

function printSummary(results: CellResult[]): void {
  console.log("\n[bench] ===== SUMMARY =====");
  console.log(
    "daemon\tvariant\theightDiff\trestoreHeight\tdurationSec\tpeakRssMiB\tcpuWorkSec\tavgCores\tblocks\tfinalHeights",
  );
  for (const result of results) {
    console.log(
      [
        result.daemon,
        result.variant,
        result.heightDiff,
        result.restoreHeight,
        (result.durationMs / 1000).toFixed(1),
        (result.peakRssBytes / (1024 * 1024)).toFixed(1),
        result.cpuWorkSec.toFixed(2),
        result.avgCoresUsed.toFixed(2),
        result.blocksReceived ?? "",
        `${result.finalWalletHeight ?? "?"}/${result.finalDaemonHeight ?? "?"}`,
      ].join("\t"),
    );
  }
  console.log("[bench] ====================\n");
}

async function runWasmCell(params: {
  browser: Browser;
  variant: "asyncify" | "threads" | "threads4";
  daemon: DaemonKind;
  daemonAddress: string;
  heightDiff: number;
  restoreHeight: number;
  tipHeight: number;
  seed: string;
  timeoutMs: number;
}): Promise<CellResult> {
  const label = `${params.daemon}/${params.variant}`;
  const concurrencyOverride = params.variant === "threads4" ? 4 : null;
  const preSnapshot = await snapshotRendererCpuByPid(params.browser);
  const context = await params.browser.newContext({
    baseURL: previewUrl(params.variant),
    serviceWorkers: "block",
    viewport: { width: 1460, height: 920 },
  });
  const page = await context.newPage();
  patchWorkerHardwareConcurrency(page, concurrencyOverride);
  let metrics: Awaited<ReturnType<typeof createProcessMetricsTracker>> | null =
    null;

  try {
    await applyBenchSettings(
      page,
      params.daemonAddress,
      concurrencyOverride,
    );
    await page.goto("/");
    const initial = new InitialWalletListPage(page);
    await initial.waitUntilLoaded();
    await assertActiveWasmVariant(
      page,
      params.variant === "asyncify" ? "asyncify" : "threads",
    );

    const afterLoadCpu = await readRendererCpuByPid(preSnapshot.session);
    const trackedPid = pickPageRendererPid(preSnapshot.cpuByPid, afterLoadCpu);
    await preSnapshot.session.detach().catch(() => undefined);

    const walletName = `bench-${params.variant}-${params.daemon}-${Date.now()}`;
    await fillRestoreForm(page, {
      walletName,
      seed: params.seed,
      startingHeight: String(params.restoreHeight),
    });

    metrics = await createProcessMetricsTracker(
      params.browser,
      page,
      trackedPid,
    );
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
      heightDiff: params.heightDiff,
      restoreHeight: params.restoreHeight,
      tipHeight: params.tipHeight,
      durationMs: sync.durationMs,
      finalWalletHeight: sync.finalWalletHeight,
      finalDaemonHeight: sync.finalDaemonHeight,
      peakRssBytes: sync.peakRendererRssBytes,
      cpuWorkSec: sync.cpuWorkSec,
      avgCoresUsed: sync.avgCoresUsed,
      peakMainJsHeapUsedBytes: sync.peakMainJsHeapUsedBytes,
      blocksReceived: null,
    };
  } finally {
    await preSnapshot.session.detach().catch(() => undefined);
    if (metrics) {
      await metrics.dispose();
    }
    await context.close();
  }
}

async function runNativeCell(params: {
  variant: "native0" | "native4";
  daemon: DaemonKind;
  daemonAddress: string;
  heightDiff: number;
  restoreHeight: number;
  tipHeight: number;
  seed: string;
  timeoutMs: number;
  walletCliPath: string;
}): Promise<CellResult> {
  const label = `${params.daemon}/${params.variant}`;
  const maxConcurrency = params.variant === "native0" ? 0 : 4;
  const sync = await runNativeWalletCliSync({
    walletCliPath: params.walletCliPath,
    seed: params.seed,
    restoreHeight: params.restoreHeight,
    daemonHttpUrl: params.daemonAddress,
    maxConcurrency,
    timeoutMs: params.timeoutMs,
    progressLabel: label,
  });

  return {
    variant: params.variant,
    daemon: params.daemon,
    daemonAddress: params.daemonAddress,
    heightDiff: params.heightDiff,
    restoreHeight: params.restoreHeight,
    tipHeight: params.tipHeight,
    durationMs: sync.durationMs,
    finalWalletHeight: sync.restoreHeight + (sync.blocksReceived ?? 0),
    finalDaemonHeight: sync.finalDaemonHeight,
    peakRssBytes: sync.peakRssBytes,
    cpuWorkSec: sync.cpuWorkSec,
    avgCoresUsed: sync.avgCoresUsed,
    peakMainJsHeapUsedBytes: null,
    blocksReceived: sync.blocksReceived,
  };
}

test.describe.configure({ mode: "serial" });

test("mainnet sync performance matrix", async ({ browser }) => {
  const seed = envOr("BENCH_SEED", DEFAULT_SEED);
  const localAddress = envOr("BENCH_DAEMON_LOCAL", DEFAULT_LOCAL);
  const cakeAddress = envOr("BENCH_DAEMON_REMOTE", DEFAULT_CAKE);
  const timeoutMs = Number(process.env.BENCH_TIMEOUT_MS ?? 4 * 60 * 60 * 1000);
  const heightDiff = parseHeightDiff();
  const walletCliPath = resolveWalletCliPath();

  test.setTimeout(Math.max(timeoutMs * 10, 60_000));

  await assertWalletCliExists(walletCliPath);

  const localInfo = await assertDaemonReadyForBench(localAddress, "local");
  const cakeInfo = await assertDaemonReadyForBench(cakeAddress, "cake");

  // Use the lower tip so restore height is valid for both daemons.
  const tipHeight = Math.min(localInfo.height, cakeInfo.height);
  const restoreHeight = Math.max(0, tipHeight - heightDiff);

  console.log(
    `[bench] local tip=${localInfo.height} synchronized=${localInfo.synchronized}`,
  );
  console.log(
    `[bench] cake tip=${cakeInfo.height} synchronized=${cakeInfo.synchronized}`,
  );
  console.log(
    `[bench] heightDiff=${heightDiff} restoreHeight=${restoreHeight} (from tip ${tipHeight})`,
  );
  console.log(`[bench] wallet-cli=${walletCliPath}`);

  const daemons: Array<{ kind: DaemonKind; address: string }> = [
    { kind: "cake", address: cakeAddress },
    { kind: "local", address: localAddress },
  ];
  const variants: BenchVariant[] = [
    "asyncify",
    "threads",
    "threads4",
    "native0",
    "native4",
  ];
  const results: CellResult[] = [];

  for (const daemon of daemons) {
    for (const variant of variants) {
      console.log(
        `[bench] START ${daemon.kind}/${variant} ` +
          `restoreHeight=${restoreHeight} daemon=${daemon.address}`,
      );
      const result = isWasmVariant(variant)
        ? await runWasmCell({
            browser,
            variant,
            daemon: daemon.kind,
            daemonAddress: daemon.address,
            heightDiff,
            restoreHeight,
            tipHeight,
            seed,
            timeoutMs,
          })
        : await runNativeCell({
            variant,
            daemon: daemon.kind,
            daemonAddress: daemon.address,
            heightDiff,
            restoreHeight,
            tipHeight,
            seed,
            timeoutMs,
            walletCliPath,
          });
      results.push(result);
      printCellResult(result);
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
        startedTips: { local: localInfo, cake: cakeInfo },
        heightDiff,
        tipHeight,
        restoreHeight,
        seedWordCount: seed.trim().split(/\s+/).length,
        walletCliPath,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`[bench] wrote ${outPath}`);
});
