import type { Page } from "@playwright/test";
import {
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
  cpuTimeDeltaSec: number;
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
    if (sample.mainJsHeapUsedBytes !== null) {
      peakMainJsHeapUsedBytes =
        peakMainJsHeapUsedBytes === null
          ? sample.mainJsHeapUsedBytes
          : Math.max(peakMainJsHeapUsedBytes, sample.mainJsHeapUsedBytes);
    }

    const elapsedMs = Date.now() - params.startedAtMs;
    const cpuDelta =
      sample.rendererCpuTimeSec - params.baseline.rendererCpuTimeSec;
    if (elapsedMs - lastLogAt >= logEveryMs) {
      lastLogAt = elapsedMs;
      console.log(
        `[bench] ${params.progressLabel} ` +
          `elapsed=${(elapsedMs / 1000).toFixed(1)}s ` +
          `height=${lastProgress.walletHeight ?? "?"}/${lastProgress.daemonHeight ?? "?"} ` +
          `rss=${formatBytes(sample.rendererRssBytes)} ` +
          `cpuΔ=${cpuDelta.toFixed(2)}s`,
      );
    }

    if (lastProgress.synced) {
      return {
        durationMs: elapsedMs,
        finalWalletHeight: lastProgress.walletHeight,
        finalDaemonHeight: lastProgress.daemonHeight,
        peakRendererRssBytes,
        cpuTimeDeltaSec: cpuDelta,
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
