import { readFileSync } from "node:fs";
import type { Browser, CDPSession, Page } from "@playwright/test";

export type ProcessSample = {
  atMs: number;
  /** Cumulative CPU-seconds on the tracked page renderer (all threads in that process). */
  cpuWorkSec: number;
  rendererRssBytes: number;
  /** Main-isolate JS heap only — does not include the wallet web worker. */
  mainJsHeapUsedBytes: number | null;
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

function readVmRssBytes(pid: number): number {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
    if (!match) {
      return 0;
    }
    return Number(match[1]) * 1024;
  } catch {
    return 0;
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

async function readMainJsHeapUsedBytes(
  pageSession: CDPSession | null,
): Promise<number | null> {
  if (!pageSession) {
    return null;
  }
  try {
    const { metrics } = await pageSession.send("Performance.getMetrics");
    const heap = metrics.find(
      (metric: { name: string; value: number }) =>
        metric.name === "JSHeapUsedSize",
    );
    return heap ? heap.value : null;
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
      let rendererRssBytes = 0;
      for (const pid of trackedPids) {
        cpuWorkSec += byPid.get(pid) ?? 0;
        rendererRssBytes += readVmRssBytes(pid);
      }
      return {
        atMs: Date.now(),
        cpuWorkSec,
        rendererRssBytes,
        mainJsHeapUsedBytes: await readMainJsHeapUsedBytes(pageSession),
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
