/**
 * Mainnet sync performance bench.
 *
 * One restore height: tip - BENCH_HEIGHT_DIFF (default 20160 ≈ 4 weeks).
 * Execution order: run → daemon → variant (full matrix per run, local first).
 * Summary table order: daemon → variant → run (same daemon/variant rows stay adjacent).
 *
 * Variants:
 * - asyncify
 * - threads (full navigator.hardwareConcurrency)
 * - threads2 / threads4 (hardwareConcurrency forced to 2 / 4 in the wallet worker)
 * - native0 (monero-wallet-cli --max-concurrency 0 = all cores)
 * - native2 / native4 (--max-concurrency 2 / 4)
 *
 * BENCH_RUNS (default 5) repeats the full matrix; summary lists run1, run2, … under each
 * daemon/variant group.
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
import {
  assertDaemonReadyForBench,
  fetchBlockTimestamp,
  formatAgeFromUnixSeconds,
} from "./helpers/daemonInfo";
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
  | "threads2"
  | "threads4"
  | "native0"
  | "native2"
  | "native4";

type CellResult = {
  run: number;
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

/** ~4 weeks at 720 blocks/day. */
const DEFAULT_HEIGHT_DIFF = 20_160;
const DEFAULT_RUNS = 5;

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

function parseRuns(): number {
  const raw = process.env.BENCH_RUNS;
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_RUNS;
  }
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 1) {
    throw new Error(`Invalid BENCH_RUNS=${raw}`);
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
): variant is "asyncify" | "threads" | "threads2" | "threads4" {
  return (
    variant === "asyncify" ||
    variant === "threads" ||
    variant === "threads2" ||
    variant === "threads4"
  );
}

function wasmConcurrencyOverride(variant: BenchVariant): number | null {
  if (variant === "threads2") {
    return 2;
  }
  if (variant === "threads4") {
    return 4;
  }
  return null;
}

function nativeMaxConcurrency(
  variant: "native0" | "native2" | "native4",
): 0 | 2 | 4 {
  if (variant === "native0") {
    return 0;
  }
  if (variant === "native2") {
    return 2;
  }
  return 4;
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
  run: number;
}): string {
  return `${result.daemon}/${result.variant}/run${result.run}`;
}

function formatDurationHuman(durationMs: number): string {
  const totalSec = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function padCell(value: string, width: number): string {
  return value.length >= width
    ? value
    : `${value}${" ".repeat(width - value.length)}`;
}

const DAEMON_REPORT_ORDER: DaemonKind[] = ["local", "cake"];
const VARIANT_REPORT_ORDER: BenchVariant[] = [
  "asyncify",
  "threads",
  "threads2",
  "threads4",
  "native0",
  "native2",
  "native4",
];

/** Table/report order: daemon → variant → run (independent of execution order). */
function sortResultsForReport(results: CellResult[]): CellResult[] {
  return [...results].sort((a, b) => {
    const daemonCmp =
      DAEMON_REPORT_ORDER.indexOf(a.daemon) -
      DAEMON_REPORT_ORDER.indexOf(b.daemon);
    if (daemonCmp !== 0) {
      return daemonCmp;
    }
    const variantCmp =
      VARIANT_REPORT_ORDER.indexOf(a.variant) -
      VARIANT_REPORT_ORDER.indexOf(b.variant);
    if (variantCmp !== 0) {
      return variantCmp;
    }
    return a.run - b.run;
  });
}

function printSummary(results: CellResult[]): void {
  const headers = [
    "daemon",
    "variant",
    "run",
    "diff",
    "restoreH",
    "duration",
    "durHuman",
    "rssMiB",
    "cpuWork",
    "avgCores",
    "blocks",
    "finalH",
  ] as const;

  const rows = sortResultsForReport(results).map((result) => [
    result.daemon,
    result.variant,
    String(result.run),
    String(result.heightDiff),
    String(result.restoreHeight),
    `${(result.durationMs / 1000).toFixed(1)}s`,
    formatDurationHuman(result.durationMs),
    (result.peakRssBytes / (1024 * 1024)).toFixed(1),
    `${result.cpuWorkSec.toFixed(2)}s`,
    result.avgCoresUsed.toFixed(2),
    result.blocksReceived === null ? "-" : String(result.blocksReceived),
    `${result.finalWalletHeight ?? "?"}/${result.finalDaemonHeight ?? "?"}`,
  ]);

  const widths = headers.map((header, col) =>
    Math.max(
      header.length,
      ...(rows.length === 0 ? [0] : rows.map((row) => row[col].length)),
    ),
  );

  const formatRow = (cells: string[]) =>
    cells.map((cell, i) => padCell(cell, widths[i])).join("  ");

  const separator = widths.map((width) => "-".repeat(width)).join("  ");

  console.log("\n[bench] ===== SUMMARY =====");
  console.log(formatRow([...headers]));
  console.log(separator);
  for (const row of rows) {
    console.log(formatRow(row));
  }
  console.log("[bench] ====================\n");
}

function printCellResult(result: CellResult): void {
  console.log(
    `[bench] DONE ${cellLabel(result)} ` +
      `restoreHeight=${result.restoreHeight} (tip-${result.heightDiff}) ` +
      `duration=${(result.durationMs / 1000).toFixed(1)}s (${formatDurationHuman(result.durationMs)}) ` +
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

async function runWasmCell(params: {
  browser: Browser;
  variant: "asyncify" | "threads" | "threads2" | "threads4";
  daemon: DaemonKind;
  daemonAddress: string;
  heightDiff: number;
  restoreHeight: number;
  tipHeight: number;
  seed: string;
  timeoutMs: number;
  run: number;
}): Promise<CellResult> {
  const label = `${params.daemon}/${params.variant}/run${params.run}`;
  const concurrencyOverride = wasmConcurrencyOverride(params.variant);
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
    await applyBenchSettings(page, params.daemonAddress, concurrencyOverride);
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

    const walletName = `bench-${params.variant}-${params.daemon}-r${params.run}-${Date.now()}`;
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
      run: params.run,
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
  variant: "native0" | "native2" | "native4";
  daemon: DaemonKind;
  daemonAddress: string;
  heightDiff: number;
  restoreHeight: number;
  tipHeight: number;
  seed: string;
  timeoutMs: number;
  walletCliPath: string;
  run: number;
}): Promise<CellResult> {
  const label = `${params.daemon}/${params.variant}/run${params.run}`;
  const maxConcurrency = nativeMaxConcurrency(params.variant);
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
    run: params.run,
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
  const runs = parseRuns();
  const walletCliPath = resolveWalletCliPath();

  test.setTimeout(Math.max(timeoutMs * 14 * runs, 60_000));

  await assertWalletCliExists(walletCliPath);

  const localInfo = await assertDaemonReadyForBench(localAddress, "local");
  const cakeInfo = await assertDaemonReadyForBench(cakeAddress, "cake");

  const tipHeight = Math.min(localInfo.height, cakeInfo.height);
  const restoreHeight = Math.max(0, tipHeight - heightDiff);
  const restoreBlockTimestamp = await fetchBlockTimestamp(
    localAddress,
    restoreHeight,
  );
  const restoreAge = formatAgeFromUnixSeconds(restoreBlockTimestamp);

  console.log(
    `[bench] local tip=${localInfo.height} synchronized=${localInfo.synchronized}`,
  );
  console.log(
    `[bench] cake tip=${cakeInfo.height} synchronized=${cakeInfo.synchronized}`,
  );
  console.log(
    `[bench] heightDiff=${heightDiff} restoreHeight=${restoreHeight} (from tip ${tipHeight}, block age ${restoreAge})`,
  );
  console.log(`[bench] runs=${runs}`);
  console.log(`[bench] wallet-cli=${walletCliPath}`);

  const daemons: Array<{ kind: DaemonKind; address: string }> = [
    { kind: "local", address: localAddress },
    { kind: "cake", address: cakeAddress },
  ];
  const variants: BenchVariant[] = VARIANT_REPORT_ORDER;
  const results: CellResult[] = [];

  for (let run = 1; run <= runs; run++) {
    console.log(`[bench] ===== RUN ${run}/${runs} =====`);
    for (const daemon of daemons) {
      for (const variant of variants) {
        console.log(
          `[bench] START ${daemon.kind}/${variant}/run${run} ` +
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
              run,
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
              run,
            });
        results.push(result);
        printCellResult(result);
        printSummary(results);
      }
    }
  }

  printSummary(results);

  const resultsDir = path.join(process.cwd(), "tests/bench/results");
  await mkdir(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(resultsDir, `sync-perf-${stamp}.json`);
  const resultsForReport = sortResultsForReport(results);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        startedTips: { local: localInfo, cake: cakeInfo },
        heightDiff,
        tipHeight,
        restoreHeight,
        restoreBlockTimestamp,
        restoreAge,
        runs,
        seedWordCount: seed.trim().split(/\s+/).length,
        walletCliPath,
        results: resultsForReport,
      },
      null,
      2,
    ),
  );
  console.log(`[bench] wrote ${outPath}`);
});
