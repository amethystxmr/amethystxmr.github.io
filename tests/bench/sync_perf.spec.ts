/**
 * Mainnet sync performance bench.
 *
 * One restore height: tip - BENCH_HEIGHT_DIFF (default 20160 ≈ 4 weeks).
 * Execution order: run → daemon → variant (full matrix per run, local first).
 * Summary table order: daemon → variant → run.
 *
 * Local: asyncify, thread1, threads, threads2, threads4, native0/1/2/4.
 * Cake: asyncify, threads4, native0 only.
 *
 * BENCH_RUNS (default 10). Console output is appended to a timestamped .txt log.
 */
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";
import {
  chromium,
  expect,
  test,
  type Browser,
  type Page,
} from "@playwright/test";
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
  isBenchHeaded,
  resolveWalletCliPath,
  runNativeWalletCliSync,
  type NativeMaxConcurrency,
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
type WasmBenchVariant =
  | "asyncify"
  | "thread1"
  | "threads"
  | "threads2"
  | "threads4";
type NativeBenchVariant = "native0" | "native1" | "native2" | "native4";
type BenchVariant = WasmBenchVariant | NativeBenchVariant;
type WasmThreadingMode = "none" | "1" | "2" | "4" | "all";

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
  rxBytes: number | null;
  txBytes: number | null;
  /** Page workers after sync (WASM only): includes the primary wallet worker. */
  workers: number | null;
};

const DEFAULT_SEED =
  "dogs zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero";

/** ~4 weeks at 720 blocks/day. */
const DEFAULT_HEIGHT_DIFF = 20_160;
const DEFAULT_RUNS = 10;

const DEFAULT_LOCAL = "http://localhost:18081";
const DEFAULT_CAKE = "https://xmr-node.cakewallet.com:18081";
const WASM_THREADING_MODE_STORAGE_KEY = "amethystxmr:threads-mode";

const DAEMON_REPORT_ORDER: DaemonKind[] = ["local", "cake"];
const LOCAL_VARIANTS: BenchVariant[] = [
  "asyncify",
  "thread1",
  "threads",
  "threads2",
  "threads4",
  "native0",
  "native1",
  "native2",
  "native4",
];
const CAKE_VARIANTS: BenchVariant[] = ["asyncify", "threads4", "native0"];
const VARIANT_REPORT_ORDER: BenchVariant[] = LOCAL_VARIANTS;

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

/** Comma-separated: local,cake (default both). Use BENCH_DAEMONS=local to skip cake. */
function parseDaemons(): DaemonKind[] {
  const raw = process.env.BENCH_DAEMONS;
  if (!raw || raw.trim().length === 0) {
    return ["local", "cake"];
  }
  const kinds = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const out: DaemonKind[] = [];
  for (const kind of kinds) {
    if (kind !== "local" && kind !== "cake") {
      throw new Error(`Invalid BENCH_DAEMONS entry=${kind}`);
    }
    if (!out.includes(kind)) {
      out.push(kind);
    }
  }
  if (out.length === 0) {
    throw new Error(`Invalid BENCH_DAEMONS=${raw}`);
  }
  return out;
}

const WASM_VARIANTS: WasmBenchVariant[] = [
  "asyncify",
  "thread1",
  "threads",
  "threads2",
  "threads4",
];
const NATIVE_VARIANTS: NativeBenchVariant[] = [
  "native0",
  "native1",
  "native2",
  "native4",
];

/**
 * Comma-separated variant names, or groups: native, wasm.
 * Default: no filter (daemon matrix as usual).
 * Example: BENCH_VARIANTS=native or BENCH_VARIANTS=native0,native4
 */
function parseVariantFilter(): BenchVariant[] | null {
  const raw = process.env.BENCH_VARIANTS;
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const out: BenchVariant[] = [];
  const add = (variant: BenchVariant) => {
    if (!out.includes(variant)) {
      out.push(variant);
    }
  };
  for (const part of parts) {
    if (part === "native") {
      for (const variant of NATIVE_VARIANTS) {
        add(variant);
      }
      continue;
    }
    if (part === "wasm") {
      for (const variant of WASM_VARIANTS) {
        add(variant);
      }
      continue;
    }
    if (
      !(LOCAL_VARIANTS as string[]).includes(part) &&
      !(CAKE_VARIANTS as string[]).includes(part)
    ) {
      throw new Error(`Invalid BENCH_VARIANTS entry=${part}`);
    }
    add(part as BenchVariant);
  }
  if (out.length === 0) {
    throw new Error(`Invalid BENCH_VARIANTS=${raw}`);
  }
  return out;
}

function previewUrl(variant: BenchVariant): string {
  if (variant === "asyncify") {
    return `http://${APP_HOST}:${E2E_ASYNCIFY_PREVIEW_PORT}`;
  }
  return `http://${APP_HOST}:${E2E_THREADS_PREVIEW_PORT}`;
}

function isWasmVariant(variant: BenchVariant): variant is WasmBenchVariant {
  return (
    variant === "asyncify" ||
    variant === "thread1" ||
    variant === "threads" ||
    variant === "threads2" ||
    variant === "threads4"
  );
}

function isNativeVariant(variant: BenchVariant): variant is NativeBenchVariant {
  return (
    variant === "native0" ||
    variant === "native1" ||
    variant === "native2" ||
    variant === "native4"
  );
}

function variantsForDaemon(
  daemon: DaemonKind,
  filter: BenchVariant[] | null,
): BenchVariant[] {
  const base = daemon === "cake" ? CAKE_VARIANTS : LOCAL_VARIANTS;
  if (filter === null) {
    return base;
  }
  return base.filter((variant) => filter.includes(variant));
}

function wasmThreadingMode(variant: WasmBenchVariant): WasmThreadingMode {
  if (variant === "asyncify") {
    return "none";
  }
  if (variant === "thread1") {
    return "1";
  }
  if (variant === "threads") {
    return "all";
  }
  if (variant === "threads2") {
    return "2";
  }
  if (variant === "threads4") {
    return "4";
  }
  const _exhaustive: never = variant;
  return _exhaustive;
}

function nativeMaxConcurrency(
  variant: NativeBenchVariant,
): NativeMaxConcurrency {
  if (variant === "native0") {
    return 0;
  }
  if (variant === "native1") {
    return 1;
  }
  if (variant === "native2") {
    return 2;
  }
  return 4;
}

function formatStampForFilename(date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

function formatMiB(bytes: number | null): string {
  if (bytes === null) {
    return "-";
  }
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Append the same text console.log/warn would print; never truncates the file. */
function installConsoleLogTee(logPath: string): () => void {
  const originalLog = console.log;
  const originalWarn = console.warn;

  const formatArgs = (args: unknown[]): string =>
    args
      .map((arg) => {
        if (typeof arg === "string") {
          return arg;
        }
        return inspect(arg, { depth: 4, colors: false, breakLength: 120 });
      })
      .join(" ");

  const append = (args: unknown[]) => {
    try {
      appendFileSync(logPath, `${formatArgs(args)}\n`, "utf8");
    } catch {
      // Never fail the bench because the tee could not write.
    }
  };

  console.log = (...args: unknown[]) => {
    originalLog(...args);
    append(args);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    append(args);
  };

  return () => {
    console.log = originalLog;
    console.warn = originalWarn;
  };
}

async function applyBenchSettings(
  page: Page,
  daemonAddress: string,
  threadingMode: WasmThreadingMode,
): Promise<void> {
  await page.addInitScript(
    ({
      daemonAddress,
      networkType,
      threadingMode,
      threadingModeStorageKey,
    }) => {
      localStorage.setItem(
        "options",
        JSON.stringify({
          loadLastWallet: false,
          daemonAddress,
          networkType,
          allowMismatchedDaemonVersion: true,
        }),
      );
      localStorage.setItem(threadingModeStorageKey, threadingMode);
    },
    {
      daemonAddress,
      networkType: NetworkTypes.MAINNET,
      threadingMode,
      threadingModeStorageKey: WASM_THREADING_MODE_STORAGE_KEY,
    },
  );
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

function formatSummaryTable(results: CellResult[]): string {
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
    "rxMiB",
    "txMiB",
    "workers",
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
    formatMiB(result.rxBytes),
    formatMiB(result.txBytes),
    result.workers === null ? "-" : String(result.workers),
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
  return [formatRow([...headers]), separator, ...rows.map(formatRow)].join(
    "\n",
  );
}

function printSummary(results: CellResult[]): void {
  console.log("\n[bench] ===== SUMMARY =====");
  console.log(formatSummaryTable(results));
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
      (result.rxBytes !== null ? ` rx=${formatMiB(result.rxBytes)} MiB` : "") +
      (result.txBytes !== null ? ` tx=${formatMiB(result.txBytes)} MiB` : "") +
      (result.workers !== null ? ` workers=${result.workers}` : "") +
      (result.blocksReceived !== null
        ? ` blocks=${result.blocksReceived}`
        : "") +
      (result.peakMainJsHeapUsedBytes !== null
        ? ` mainHeapPeak=${formatBytes(result.peakMainJsHeapUsedBytes)}`
        : ""),
  );
}

async function writeResultsJson(
  jsonPath: string,
  meta: Record<string, unknown>,
  results: CellResult[],
): Promise<void> {
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        ...meta,
        results: sortResultsForReport(results),
      },
      null,
      2,
    ),
    "utf8",
  );
}

function isBrowserClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /has been closed/i.test(message) ||
    /browser has been closed/i.test(message) ||
    /Target closed/i.test(message) ||
    /Target page, context or browser has been closed/i.test(message)
  );
}

/**
 * Prefer X11 for long headed runs. Wayland often kills Chromium after hours with:
 * "Fatal Wayland communication error: Connection reset by peer".
 * Override: BENCH_CHROMIUM_OZONE=wayland|auto|x11
 */
function chromiumOzoneArgs(headed: boolean): string[] {
  if (!headed) {
    return [];
  }
  const ozone = (process.env.BENCH_CHROMIUM_OZONE ?? "x11")
    .trim()
    .toLowerCase();
  if (ozone === "auto" || ozone.length === 0) {
    return [];
  }
  if (ozone === "wayland" || ozone === "x11") {
    return [`--ozone-platform=${ozone}`];
  }
  throw new Error(
    `Invalid BENCH_CHROMIUM_OZONE=${process.env.BENCH_CHROMIUM_OZONE}`,
  );
}

async function launchBenchBrowser(): Promise<Browser> {
  const headed = isBenchHeaded();
  return chromium.launch({
    headless: !headed,
    args: ["--disable-dev-shm-usage", ...chromiumOzoneArgs(headed)],
  });
}

async function runWasmCellOnce(params: {
  variant: WasmBenchVariant;
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
  const threadingMode = wasmThreadingMode(params.variant);
  // Fresh browser per cell: a shared headed Chromium often dies mid-matrix on Wayland.
  const browser = await launchBenchBrowser();
  let preSnapshot: Awaited<ReturnType<typeof snapshotRendererCpuByPid>> | null =
    null;
  let context: Awaited<ReturnType<Browser["newContext"]>> | null = null;
  let metrics: Awaited<ReturnType<typeof createProcessMetricsTracker>> | null =
    null;

  try {
    preSnapshot = await snapshotRendererCpuByPid(browser);
    context = await browser.newContext({
      baseURL: previewUrl(params.variant),
      serviceWorkers: "block",
      viewport: { width: 1460, height: 920 },
    });
    const page = await context.newPage();

    await applyBenchSettings(page, params.daemonAddress, threadingMode);
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
    preSnapshot = null;

    const walletName = `bench-${params.variant}-${params.daemon}-r${params.run}-${Date.now()}`;
    await fillRestoreForm(page, {
      walletName,
      seed: params.seed,
      startingHeight: String(params.restoreHeight),
    });

    metrics = await createProcessMetricsTracker(browser, page, trackedPid);
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

    const workers = page.workers().length;

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
      rxBytes: null,
      txBytes: null,
      workers,
    };
  } finally {
    if (preSnapshot) {
      await preSnapshot.session.detach().catch(() => undefined);
    }
    if (metrics) {
      await metrics.dispose();
    }
    if (context) {
      await context.close().catch(() => undefined);
    }
    await browser.close().catch(() => undefined);
  }
}

async function runWasmCell(params: {
  variant: WasmBenchVariant;
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
  try {
    return await runWasmCellOnce(params);
  } catch (error) {
    if (!isBrowserClosedError(error)) {
      throw error;
    }
    console.log(
      `[bench] ${label} browser closed unexpectedly; retrying cell once`,
    );
    return await runWasmCellOnce(params);
  }
}

async function runNativeCell(params: {
  variant: NativeBenchVariant;
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
    rxBytes: sync.rxBytes,
    txBytes: sync.txBytes,
    workers: null,
  };
}

test.describe.configure({ mode: "serial" });

test("mainnet sync performance matrix", async () => {
  const seed = envOr("BENCH_SEED", DEFAULT_SEED);
  const localAddress = envOr("BENCH_DAEMON_LOCAL", DEFAULT_LOCAL);
  const cakeAddress = envOr("BENCH_DAEMON_REMOTE", DEFAULT_CAKE);
  const timeoutMs = Number(process.env.BENCH_TIMEOUT_MS ?? 4 * 60 * 60 * 1000);
  const heightDiff = parseHeightDiff();
  const runs = parseRuns();
  const enabledDaemons = parseDaemons();
  const variantFilter = parseVariantFilter();
  const walletCliPath = resolveWalletCliPath();
  const localVariants = variantsForDaemon("local", variantFilter);
  const cakeVariants = variantsForDaemon("cake", variantFilter);
  const cellsPerRun =
    (enabledDaemons.includes("local") ? localVariants.length : 0) +
    (enabledDaemons.includes("cake") ? cakeVariants.length : 0);
  if (cellsPerRun === 0) {
    throw new Error(
      "No bench cells selected (check BENCH_DAEMONS / BENCH_VARIANTS)",
    );
  }

  test.setTimeout(Math.max(timeoutMs * cellsPerRun * runs, 60_000));

  const needsNativeCli =
    localVariants.some(isNativeVariant) || cakeVariants.some(isNativeVariant);
  if (needsNativeCli) {
    await assertWalletCliExists(walletCliPath);
  }

  const localInfo = enabledDaemons.includes("local")
    ? await assertDaemonReadyForBench(localAddress, "local")
    : null;
  const cakeInfo = enabledDaemons.includes("cake")
    ? await assertDaemonReadyForBench(cakeAddress, "cake")
    : null;

  const tipCandidates = [localInfo?.height, cakeInfo?.height].filter(
    (h): h is number => typeof h === "number",
  );
  const tipHeight = Math.min(...tipCandidates);
  const restoreHeight = Math.max(0, tipHeight - heightDiff);
  const tipDaemonAddress = localInfo !== null ? localAddress : cakeAddress;
  const restoreBlockTimestamp = await fetchBlockTimestamp(
    tipDaemonAddress,
    restoreHeight,
  );
  const restoreAge = formatAgeFromUnixSeconds(restoreBlockTimestamp);

  const resultsDir = path.join(process.cwd(), "tests/bench/results");
  await mkdir(resultsDir, { recursive: true });
  const stamp = formatStampForFilename();
  const logPath = path.join(resultsDir, `sync-perf-${stamp}.txt`);
  const jsonPath = path.join(resultsDir, `sync-perf-${stamp}.json`);
  appendFileSync(logPath, "", "utf8");
  const restoreConsole = installConsoleLogTee(logPath);

  try {
    if (localInfo !== null) {
      console.log(
        `[bench] local tip=${localInfo.height} synchronized=${localInfo.synchronized}`,
      );
    }
    if (cakeInfo !== null) {
      console.log(
        `[bench] cake tip=${cakeInfo.height} synchronized=${cakeInfo.synchronized}`,
      );
    }
    console.log(
      `[bench] heightDiff=${heightDiff} restoreHeight=${restoreHeight} (from tip ${tipHeight}, block age ${restoreAge})`,
    );
    console.log(`[bench] runs=${runs}`);
    console.log(`[bench] daemons=${enabledDaemons.join(",")}`);
    console.log(
      `[bench] local variants=${localVariants.join(",") || "(none)"} cake variants=${cakeVariants.join(",") || "(none)"}`,
    );
    if (needsNativeCli) {
      console.log(`[bench] wallet-cli=${walletCliPath}`);
    }
    console.log(`[bench] log file=${logPath}`);

    const daemons: Array<{ kind: DaemonKind; address: string }> = [
      ...(enabledDaemons.includes("local") && localVariants.length > 0
        ? [{ kind: "local" as const, address: localAddress }]
        : []),
      ...(enabledDaemons.includes("cake") && cakeVariants.length > 0
        ? [{ kind: "cake" as const, address: cakeAddress }]
        : []),
    ];
    const results: CellResult[] = [];
    const metaBase = {
      startedTips: { local: localInfo, cake: cakeInfo },
      heightDiff,
      tipHeight,
      restoreHeight,
      restoreBlockTimestamp,
      restoreAge,
      runs,
      daemons: enabledDaemons,
      variantFilter,
      localVariants,
      cakeVariants,
      seedWordCount: seed.trim().split(/\s+/).length,
      walletCliPath: needsNativeCli ? walletCliPath : null,
      logPath,
    };

    await writeResultsJson(jsonPath, metaBase, results);

    for (let run = 1; run <= runs; run++) {
      console.log(`[bench] ===== RUN ${run}/${runs} =====`);
      for (const daemon of daemons) {
        for (const variant of variantsForDaemon(daemon.kind, variantFilter)) {
          console.log(
            `[bench] START ${daemon.kind}/${variant}/run${run} ` +
              `restoreHeight=${restoreHeight} daemon=${daemon.address}`,
          );
          const result = isWasmVariant(variant)
            ? await runWasmCell({
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
          await writeResultsJson(jsonPath, metaBase, results);
        }
      }
    }

    console.log(`[bench] ===== MATRIX COMPLETE =====`);
    printSummary(results);
    console.log(`[bench] final log ${logPath}`);
    console.log(`[bench] final json ${jsonPath}`);
  } finally {
    restoreConsole();
  }
});
