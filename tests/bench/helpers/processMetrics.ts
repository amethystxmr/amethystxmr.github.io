import { readFileSync } from "node:fs";
import type { Browser, CDPSession, Page } from "@playwright/test";

export type ProcessSample = {
  atMs: number;
  /** Cumulative CPU-seconds on the tracked page renderer (all threads in that process). */
  cpuWorkSec: number;
  rendererRssBytes: number;
  rendererRssAnonBytes: number | null;
  rendererRssFileBytes: number | null;
  rendererRssShmemBytes: number | null;
  rendererVmHwmBytes: number | null;
  rendererThreads: number | null;
  /** Current WebAssembly.Memory buffer size, read from the wallet worker through the page. */
  wasmMemoryBytes: number | null;
  /** Main-isolate JS heap only — does not include the wallet web worker. */
  mainJsHeapUsedBytes: number | null;
  mainJsHeapTotalBytes: number | null;
  documents: number | null;
  nodes: number | null;
  layoutObjects: number | null;
  runtimeHeapUsedBytes: number | null;
  runtimeHeapTotalBytes: number | null;
  runtimeHeapEmbedderHeapUsedBytes: number | null;
  runtimeHeapBackingStorageBytes: number | null;
};

export type ProcessMetricsTracker = {
  sample: () => Promise<ProcessSample>;
  trackedPids: readonly number[];
  dispose: () => Promise<void>;
};

type CdpProcessInfo = {
  type: string;
  id: number;
  cpuTime: number;
};

type PagePerformanceMetrics = {
  mainJsHeapUsedBytes: number | null;
  mainJsHeapTotalBytes: number | null;
  documents: number | null;
  nodes: number | null;
  layoutObjects: number | null;
};

type RuntimeHeapUsage = {
  runtimeHeapUsedBytes: number | null;
  runtimeHeapTotalBytes: number | null;
  runtimeHeapEmbedderHeapUsedBytes: number | null;
  runtimeHeapBackingStorageBytes: number | null;
};

type ProcStatusMetrics = {
  rendererRssBytes: number;
  rendererRssAnonBytes: number | null;
  rendererRssFileBytes: number | null;
  rendererRssShmemBytes: number | null;
  rendererVmHwmBytes: number | null;
  rendererThreads: number | null;
};

function parseStatusBytes(status: string, name: string): number | null {
  const match = new RegExp(`^${name}:\\s+(\\d+)\\s+kB$`, "m").exec(status);
  return match ? Number(match[1]) * 1024 : null;
}

function parseStatusNumber(status: string, name: string): number | null {
  const match = new RegExp(`^${name}:\\s+(\\d+)$`, "m").exec(status);
  return match ? Number(match[1]) : null;
}

function readProcStatusMetrics(pid: number): ProcStatusMetrics {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    return {
      rendererRssBytes: parseStatusBytes(status, "VmRSS") ?? 0,
      rendererRssAnonBytes: parseStatusBytes(status, "RssAnon"),
      rendererRssFileBytes: parseStatusBytes(status, "RssFile"),
      rendererRssShmemBytes: parseStatusBytes(status, "RssShmem"),
      rendererVmHwmBytes: parseStatusBytes(status, "VmHWM"),
      rendererThreads: parseStatusNumber(status, "Threads"),
    };
  } catch {
    return {
      rendererRssBytes: 0,
      rendererRssAnonBytes: null,
      rendererRssFileBytes: null,
      rendererRssShmemBytes: null,
      rendererVmHwmBytes: null,
      rendererThreads: null,
    };
  }
}

async function listRendererCpuByPid(
  browserSession: CDPSession,
): Promise<Map<number, number>> {
  const { processInfo } = await browserSession.send(
    "SystemInfo.getProcessInfo",
  );
  const byPid = new Map<number, number>();
  for (const process of processInfo as CdpProcessInfo[]) {
    if (process.type === "renderer") {
      byPid.set(process.id, process.cpuTime);
    }
  }
  return byPid;
}

/**
 * Pick the renderer PID that belongs to this bench page.
 * Prefer a newly appeared renderer; otherwise the one whose CPU grew most
 * since the pre-context snapshot (spare renderers being reused).
 */
export function pickPageRendererPid(
  beforeCpuByPid: Map<number, number>,
  afterCpuByPid: Map<number, number>,
): number {
  const candidates: Array<{ pid: number; score: number }> = [];
  for (const [pid, cpu] of afterCpuByPid) {
    const prev = beforeCpuByPid.get(pid);
    if (prev === undefined) {
      candidates.push({ pid, score: cpu + 1_000_000 });
    } else {
      const delta = cpu - prev;
      if (delta > 0.01) {
        candidates.push({ pid, score: delta });
      }
    }
  }
  if (candidates.length === 0) {
    const pids = [...afterCpuByPid.keys()];
    if (pids.length === 0) {
      throw new Error("No Chromium renderer processes found for metrics");
    }
    return pids[pids.length - 1];
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].pid;
}

async function readPagePerformanceMetrics(
  pageSession: CDPSession | null,
): Promise<PagePerformanceMetrics> {
  const emptyMetrics = {
    mainJsHeapUsedBytes: null,
    mainJsHeapTotalBytes: null,
    documents: null,
    nodes: null,
    layoutObjects: null,
  };
  if (!pageSession) {
    return emptyMetrics;
  }
  try {
    const { metrics } = await pageSession.send("Performance.getMetrics");
    const byName = new Map<string, number>();
    for (const metric of metrics as Array<{ name: string; value: number }>) {
      byName.set(metric.name, metric.value);
    }
    return {
      mainJsHeapUsedBytes: byName.get("JSHeapUsedSize") ?? null,
      mainJsHeapTotalBytes: byName.get("JSHeapTotalSize") ?? null,
      documents: byName.get("Documents") ?? null,
      nodes: byName.get("Nodes") ?? null,
      layoutObjects: byName.get("LayoutObjects") ?? null,
    };
  } catch {
    return emptyMetrics;
  }
}

async function readRuntimeHeapUsage(
  pageSession: CDPSession | null,
): Promise<RuntimeHeapUsage> {
  const emptyUsage = {
    runtimeHeapUsedBytes: null,
    runtimeHeapTotalBytes: null,
    runtimeHeapEmbedderHeapUsedBytes: null,
    runtimeHeapBackingStorageBytes: null,
  };
  if (!pageSession) {
    return emptyUsage;
  }
  try {
    const usage = (await pageSession.send("Runtime.getHeapUsage")) as {
      usedSize?: number;
      totalSize?: number;
      embedderHeapUsedSize?: number;
      backingStorageSize?: number;
    };
    return {
      runtimeHeapUsedBytes: usage.usedSize ?? null,
      runtimeHeapTotalBytes: usage.totalSize ?? null,
      runtimeHeapEmbedderHeapUsedBytes: usage.embedderHeapUsedSize ?? null,
      runtimeHeapBackingStorageBytes: usage.backingStorageSize ?? null,
    };
  } catch {
    return emptyUsage;
  }
}

async function readWasmMemoryBytes(page: Page): Promise<number | null> {
  try {
    return await page.evaluate(async () => {
      const bytes = await window.amethystRuntime?.getWasmMemoryByteLength?.();
      return typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0
        ? bytes
        : null;
    });
  } catch {
    return null;
  }
}

/**
 * Tracks CPU/RSS for the page's Chromium renderer process only.
 *
 * `cpuWorkSec` is cumulative CPU-seconds across all threads in that process
 * (main + dedicated worker + WASM pthreads). For the same restore height this
 * should be roughly comparable between Asyncify and Threads (same scan work);
 * Threads will usually show higher avgCores = cpuWork / wallTime.
 *
 * SystemInfo.getProcessInfo must be called on the browser CDP target.
 * Memory comes from /proc/<pid>/status VmRSS (CDP ProcessInfo has no RSS field).
 */
export async function createProcessMetricsTracker(
  browser: Browser,
  page: Page,
  trackedPid: number,
): Promise<ProcessMetricsTracker> {
  const browserSession = await browser.newBrowserCDPSession();
  let pageSession: CDPSession | null = null;
  try {
    pageSession = await page.context().newCDPSession(page);
    await pageSession.send("Performance.enable");
  } catch {
    pageSession = null;
  }

  const trackedPids = [trackedPid];

  return {
    trackedPids,
    async sample(): Promise<ProcessSample> {
      const byPid = await listRendererCpuByPid(browserSession);
      let cpuWorkSec = 0;
      const procStatus = readProcStatusMetrics(trackedPid);
      for (const pid of trackedPids) {
        cpuWorkSec += byPid.get(pid) ?? 0;
      }
      const performanceMetrics = await readPagePerformanceMetrics(pageSession);
      const runtimeHeapUsage = await readRuntimeHeapUsage(pageSession);
      return {
        atMs: Date.now(),
        cpuWorkSec,
        ...procStatus,
        wasmMemoryBytes: await readWasmMemoryBytes(page),
        ...performanceMetrics,
        ...runtimeHeapUsage,
      };
    },
    async dispose(): Promise<void> {
      await browserSession.detach().catch(() => undefined);
      if (pageSession) {
        await pageSession.detach().catch(() => undefined);
      }
    },
  };
}

/** Snapshot renderer cpuTime by pid (for selecting the page renderer). */
export async function snapshotRendererCpuByPid(
  browser: Browser,
): Promise<{ session: CDPSession; cpuByPid: Map<number, number> }> {
  const session = await browser.newBrowserCDPSession();
  const cpuByPid = await listRendererCpuByPid(session);
  return { session, cpuByPid };
}

export async function readRendererCpuByPid(
  browserSession: CDPSession,
): Promise<Map<number, number>> {
  return listRendererCpuByPid(browserSession);
}

/** Average number of cores busy: cpuWorkSec / wallSec. */
export function averageCoresUsed(
  cpuWorkSec: number,
  durationMs: number,
): number {
  if (durationMs <= 0) {
    return 0;
  }
  return cpuWorkSec / (durationMs / 1000);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
