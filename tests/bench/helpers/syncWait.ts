import type { Page } from "@playwright/test";
import {
  averageCoresUsed,
  formatBytes,
  type ProcessMetricsTracker,
  type ProcessSample,
} from "./processMetrics";

export type SyncProgress = {
  walletHeight: number | null;
  daemonHeight: number | null;
  synced: boolean;
};

export type SyncWaitResult = {
  durationMs: number;
  finalWalletHeight: number | null;
  finalDaemonHeight: number | null;
  peakRendererRssBytes: number;
  /** Total CPU-seconds on the page renderer (all threads). Comparable across variants. */
  cpuWorkSec: number;
  /** cpuWorkSec / wallSec — how CPU was used (parallelism). */
  avgCoresUsed: number;
  peakWasmMemoryBytes: number | null;
  peakMainJsHeapUsedBytes: number | null;
  samples: ProcessSample[];
};

async function readSyncProgress(page: Page): Promise<SyncProgress> {
  let walletHeight: number | null = null;
  let daemonHeight: number | null = null;
  try {
    const walletText =
      (await page.getByLabel("Wallet current height").first().textContent()) ??
      "";
    const daemonText =
      (await page.getByLabel("Daemon current height").first().textContent()) ??
      "";
    const walletParsed = Number.parseInt(walletText.trim(), 10);
    const daemonParsed = Number.parseInt(daemonText.trim(), 10);
    if (!Number.isNaN(walletParsed)) {
      walletHeight = walletParsed;
    }
    if (!Number.isNaN(daemonParsed)) {
      daemonHeight = daemonParsed;
    }
  } catch {
    // Heights may be absent briefly while status loads.
  }

  const heightsSynced =
    walletHeight !== null &&
    daemonHeight !== null &&
    walletHeight >= daemonHeight &&
    daemonHeight > 0;

  // Do not trust the "Synced" badge alone: before status loads the UI can show
  // "Synced" while walletHeight/daemonHeight are still missing.
  const badgeSynced = await page
    .getByText("Synced", { exact: true })
    .first()
    .isVisible()
    .catch(() => false);

  return {
    walletHeight,
    daemonHeight,
    synced: heightsSynced && badgeSynced,
  };
}

/**
 * Passively wait until the wallet UI reports synced while the main refresh loop runs.
 * Does not click Refresh or reload (that would distort the benchmark).
 */
export async function waitUntilWalletSynced(params: {
  page: Page;
  startedAtMs: number;
  timeoutMs: number;
  metrics: ProcessMetricsTracker;
  baseline: ProcessSample;
  progressLabel: string;
  logEveryMs?: number;
}): Promise<SyncWaitResult> {
  const logEveryMs = params.logEveryMs ?? 10_000;
  let lastLogAt = 0;
  let peakRendererRssBytes = params.baseline.rendererRssBytes;
  let peakWasmMemoryBytes = params.baseline.wasmMemoryBytes;
  let peakMainJsHeapUsedBytes = params.baseline.mainJsHeapUsedBytes;
  const samples: ProcessSample[] = [params.baseline];
  let lastProgress: SyncProgress = {
    walletHeight: null,
    daemonHeight: null,
    synced: false,
  };

  while (Date.now() - params.startedAtMs < params.timeoutMs) {
    lastProgress = await readSyncProgress(params.page);
    const sample = await params.metrics.sample();
    samples.push(sample);
    peakRendererRssBytes = Math.max(
      peakRendererRssBytes,
      sample.rendererRssBytes,
    );
    if (sample.wasmMemoryBytes !== null) {
      peakWasmMemoryBytes =
        peakWasmMemoryBytes === null
          ? sample.wasmMemoryBytes
          : Math.max(peakWasmMemoryBytes, sample.wasmMemoryBytes);
    }
    if (sample.mainJsHeapUsedBytes !== null) {
      peakMainJsHeapUsedBytes =
        peakMainJsHeapUsedBytes === null
          ? sample.mainJsHeapUsedBytes
          : Math.max(peakMainJsHeapUsedBytes, sample.mainJsHeapUsedBytes);
    }

    const elapsedMs = Date.now() - params.startedAtMs;
    const cpuWorkSec = sample.cpuWorkSec - params.baseline.cpuWorkSec;
    const avgCores = averageCoresUsed(cpuWorkSec, elapsedMs);
    if (elapsedMs - lastLogAt >= logEveryMs) {
      lastLogAt = elapsedMs;
      console.log(
        `[bench] ${params.progressLabel} ` +
          `elapsed=${(elapsedMs / 1000).toFixed(1)}s ` +
          `height=${lastProgress.walletHeight ?? "?"}/${lastProgress.daemonHeight ?? "?"} ` +
          `rss=${formatBytes(sample.rendererRssBytes)} ` +
          (sample.wasmMemoryBytes !== null
            ? `wasmMem=${formatBytes(sample.wasmMemoryBytes)} `
            : "") +
          `cpuWork=${cpuWorkSec.toFixed(2)}s ` +
          `avgCores=${avgCores.toFixed(2)}`,
      );
    }

    if (lastProgress.synced) {
      return {
        durationMs: elapsedMs,
        finalWalletHeight: lastProgress.walletHeight,
        finalDaemonHeight: lastProgress.daemonHeight,
        peakRendererRssBytes,
        cpuWorkSec,
        avgCoresUsed: avgCores,
        peakWasmMemoryBytes,
        peakMainJsHeapUsedBytes,
        samples,
      };
    }

    await params.page.waitForTimeout(1_000);
  }

  throw new Error(
    `Timed out waiting for sync (${params.progressLabel}). ` +
      `Last height ${lastProgress.walletHeight ?? "?"}/${lastProgress.daemonHeight ?? "?"}`,
  );
}
