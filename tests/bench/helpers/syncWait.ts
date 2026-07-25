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
  peakRssMinusWasmBytes: number | null;
  peakSmapsPssBytes: number | null;
  peakSmapsPrivateDirtyBytes: number | null;
  peakSmapsAnonymousBytes: number | null;
  peakSmapsSwapBytes: number | null;
  peakMainJsHeapUsedBytes: number | null;
  peakMainJsHeapTotalBytes: number | null;
  peakDocuments: number | null;
  peakNodes: number | null;
  peakLayoutObjects: number | null;
  peakRuntimeHeapUsedBytes: number | null;
  peakRuntimeHeapTotalBytes: number | null;
  peakRuntimeHeapEmbedderHeapUsedBytes: number | null;
  peakRuntimeHeapBackingStorageBytes: number | null;
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

function maxNullable(
  current: number | null,
  next: number | null,
): number | null {
  if (next === null) {
    return current;
  }
  return current === null ? next : Math.max(current, next);
}

function formatMaybeBytes(bytes: number | null): string {
  return bytes === null ? "?" : formatBytes(bytes);
}

function formatMaybeNumber(value: number | null): string {
  return value === null ? "?" : String(value);
}

function rssMinusWasm(sample: ProcessSample): number | null {
  if (sample.wasmMemoryBytes === null) {
    return null;
  }
  return Math.max(0, sample.rendererRssBytes - sample.wasmMemoryBytes);
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
  let peakRssMinusWasmBytes = rssMinusWasm(params.baseline);
  let peakSmapsPssBytes = params.baseline.smapsPssBytes;
  let peakSmapsPrivateDirtyBytes = params.baseline.smapsPrivateDirtyBytes;
  let peakSmapsAnonymousBytes = params.baseline.smapsAnonymousBytes;
  let peakSmapsSwapBytes = params.baseline.smapsSwapBytes;
  let peakMainJsHeapUsedBytes = params.baseline.mainJsHeapUsedBytes;
  let peakMainJsHeapTotalBytes = params.baseline.mainJsHeapTotalBytes;
  let peakDocuments = params.baseline.documents;
  let peakNodes = params.baseline.nodes;
  let peakLayoutObjects = params.baseline.layoutObjects;
  let peakRuntimeHeapUsedBytes = params.baseline.runtimeHeapUsedBytes;
  let peakRuntimeHeapTotalBytes = params.baseline.runtimeHeapTotalBytes;
  let peakRuntimeHeapEmbedderHeapUsedSizeBytes =
    params.baseline.runtimeHeapEmbedderHeapUsedBytes;
  let peakRuntimeHeapBackingStorageBytes =
    params.baseline.runtimeHeapBackingStorageBytes;
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
    peakRssMinusWasmBytes = maxNullable(
      peakRssMinusWasmBytes,
      rssMinusWasm(sample),
    );
    peakSmapsPssBytes = maxNullable(peakSmapsPssBytes, sample.smapsPssBytes);
    peakSmapsPrivateDirtyBytes = maxNullable(
      peakSmapsPrivateDirtyBytes,
      sample.smapsPrivateDirtyBytes,
    );
    peakSmapsAnonymousBytes = maxNullable(
      peakSmapsAnonymousBytes,
      sample.smapsAnonymousBytes,
    );
    peakSmapsSwapBytes = maxNullable(peakSmapsSwapBytes, sample.smapsSwapBytes);
    if (sample.wasmMemoryBytes !== null) {
      peakWasmMemoryBytes =
        peakWasmMemoryBytes === null
          ? sample.wasmMemoryBytes
          : Math.max(peakWasmMemoryBytes, sample.wasmMemoryBytes);
    }
    peakMainJsHeapUsedBytes = maxNullable(
      peakMainJsHeapUsedBytes,
      sample.mainJsHeapUsedBytes,
    );
    peakMainJsHeapTotalBytes = maxNullable(
      peakMainJsHeapTotalBytes,
      sample.mainJsHeapTotalBytes,
    );
    peakDocuments = maxNullable(peakDocuments, sample.documents);
    peakNodes = maxNullable(peakNodes, sample.nodes);
    peakLayoutObjects = maxNullable(peakLayoutObjects, sample.layoutObjects);
    peakRuntimeHeapUsedBytes = maxNullable(
      peakRuntimeHeapUsedBytes,
      sample.runtimeHeapUsedBytes,
    );
    peakRuntimeHeapTotalBytes = maxNullable(
      peakRuntimeHeapTotalBytes,
      sample.runtimeHeapTotalBytes,
    );
    peakRuntimeHeapEmbedderHeapUsedSizeBytes = maxNullable(
      peakRuntimeHeapEmbedderHeapUsedSizeBytes,
      sample.runtimeHeapEmbedderHeapUsedBytes,
    );
    peakRuntimeHeapBackingStorageBytes = maxNullable(
      peakRuntimeHeapBackingStorageBytes,
      sample.runtimeHeapBackingStorageBytes,
    );

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
          `rssMinusWasm=${formatMaybeBytes(rssMinusWasm(sample))} ` +
          `jsHeap=${formatMaybeBytes(sample.mainJsHeapUsedBytes)}/${formatMaybeBytes(sample.mainJsHeapTotalBytes)} ` +
          `dom=${formatMaybeNumber(sample.nodes)}/${formatMaybeNumber(sample.documents)}/${formatMaybeNumber(sample.layoutObjects)} ` +
          `runtimeHeap=${formatMaybeBytes(sample.runtimeHeapUsedBytes)}/${formatMaybeBytes(sample.runtimeHeapTotalBytes)} ` +
          (sample.runtimeHeapBackingStorageBytes !== null
            ? `runtimeBacking=${formatBytes(sample.runtimeHeapBackingStorageBytes)} `
            : "") +
          (sample.runtimeHeapEmbedderHeapUsedBytes !== null
            ? `runtimeEmbedder=${formatBytes(sample.runtimeHeapEmbedderHeapUsedBytes)} `
            : "") +
          `rssAnon=${formatMaybeBytes(sample.rendererRssAnonBytes)} ` +
          `rssFile=${formatMaybeBytes(sample.rendererRssFileBytes)} ` +
          `rssShmem=${formatMaybeBytes(sample.rendererRssShmemBytes)} ` +
          `vmHwm=${formatMaybeBytes(sample.rendererVmHwmBytes)} ` +
          `threads=${formatMaybeNumber(sample.rendererThreads)} ` +
          `pss=${formatMaybeBytes(sample.smapsPssBytes)} ` +
          `privateDirty=${formatMaybeBytes(sample.smapsPrivateDirtyBytes)} ` +
          `smapsAnon=${formatMaybeBytes(sample.smapsAnonymousBytes)} ` +
          `smapsSwap=${formatMaybeBytes(sample.smapsSwapBytes)} ` +
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
        peakRssMinusWasmBytes,
        peakSmapsPssBytes,
        peakSmapsPrivateDirtyBytes,
        peakSmapsAnonymousBytes,
        peakSmapsSwapBytes,
        peakMainJsHeapUsedBytes,
        peakMainJsHeapTotalBytes,
        peakDocuments,
        peakNodes,
        peakLayoutObjects,
        peakRuntimeHeapUsedBytes,
        peakRuntimeHeapTotalBytes,
        peakRuntimeHeapEmbedderHeapUsedBytes:
          peakRuntimeHeapEmbedderHeapUsedSizeBytes,
        peakRuntimeHeapBackingStorageBytes,
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
