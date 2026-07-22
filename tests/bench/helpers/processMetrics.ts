import { readFileSync } from "node:fs";
import type { Browser, CDPSession, Page } from "@playwright/test";

export type ProcessSample = {
  atMs: number;
  rendererCpuTimeSec: number;
  rendererRssBytes: number;
  /** Main-isolate JS heap only — does not include the wallet web worker. */
  mainJsHeapUsedBytes: number | null;
};

export type ProcessMetricsTracker = {
  sample: () => Promise<ProcessSample>;
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

function sumRendererMetrics(processInfo: CdpProcessInfo[]): {
  cpuTimeSec: number;
  rssBytes: number;
} {
  let cpuTimeSec = 0;
  let rssBytes = 0;
  for (const process of processInfo) {
    if (process.type !== "renderer") {
      continue;
    }
    cpuTimeSec += process.cpuTime;
    rssBytes += readVmRssBytes(process.id);
  }
  return { cpuTimeSec, rssBytes };
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
 * Tracks Chromium renderer process CPU + RSS for the whole page, including
 * dedicated workers / WASM pthread workers that live in the renderer.
 *
 * SystemInfo.getProcessInfo must be called on the browser CDP target.
 * Memory comes from /proc/<pid>/status VmRSS (CDP ProcessInfo has no RSS field).
 */
export async function createProcessMetricsTracker(
  browser: Browser,
  page: Page,
): Promise<ProcessMetricsTracker> {
  const browserSession = await browser.newBrowserCDPSession();
  let pageSession: CDPSession | null = null;
  try {
    pageSession = await page.context().newCDPSession(page);
    await pageSession.send("Performance.enable");
  } catch {
    pageSession = null;
  }

  return {
    async sample(): Promise<ProcessSample> {
      const { processInfo } = await browserSession.send(
        "SystemInfo.getProcessInfo",
      );
      const renderer = sumRendererMetrics(processInfo as CdpProcessInfo[]);
      return {
        atMs: Date.now(),
        rendererCpuTimeSec: renderer.cpuTimeSec,
        rendererRssBytes: renderer.rssBytes,
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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
