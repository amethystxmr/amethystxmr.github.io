import { execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { averageCoresUsed } from "./processMetrics";
import { access } from "node:fs/promises";

export type NativeSyncResult = {
  durationMs: number;
  restoreHeight: number;
  finalDaemonHeight: number | null;
  peakRssBytes: number;
  cpuWorkSec: number;
  avgCoresUsed: number;
  addressPrefix: string | null;
  blocksReceived: number | null;
};

const CLK_TCK = (() => {
  try {
    return (
      Number(execSync("getconf CLK_TCK", { encoding: "utf8" }).trim()) || 100
    );
  } catch {
    return 100;
  }
})();

function readProcCpuSec(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    const rest = stat.slice(closeParen + 2).split(" ");
    const utime = Number(rest[11]);
    const stime = Number(rest[12]);
    if (Number.isNaN(utime) || Number.isNaN(stime)) {
      return null;
    }
    return (utime + stime) / CLK_TCK;
  } catch {
    return null;
  }
}

function readProcRssBytes(pid: number): number {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
    return match ? Number(match[1]) * 1024 : 0;
  } catch {
    return 0;
  }
}

/** Convert http(s)://host:port to CLI --daemon-address host:port (+ SSL flags). */
export function cliDaemonArgs(daemonHttpUrl: string): string[] {
  const url = new URL(daemonHttpUrl);
  const hostPort = `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  const args = ["--daemon-address", hostPort];
  if (url.protocol === "https:") {
    args.push("--daemon-ssl", "enabled", "--daemon-ssl-allow-any-cert");
  }
  return args;
}

export function resolveWalletCliPath(): string {
  const fromEnv = process.env.BENCH_WALLET_CLI_PATH;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return path.join(process.cwd(), "bin", "monero-wallet-cli");
}

export async function assertWalletCliExists(cliPath: string): Promise<void> {
  try {
    await access(cliPath);
  } catch {
    throw new Error(
      `monero-wallet-cli not found at ${cliPath}. Download it into ./bin (see README Sync performance bench).`,
    );
  }
}

/**
 * Restore+sync with monero-wallet-cli.
 * Stdin: empty seed-offset passphrase, N (background mining), exit.
 */
export async function runNativeWalletCliSync(params: {
  walletCliPath: string;
  seed: string;
  restoreHeight: number;
  daemonHttpUrl: string;
  maxConcurrency: 0 | 4;
  timeoutMs: number;
  progressLabel: string;
  logEveryMs?: number;
}): Promise<NativeSyncResult> {
  const logEveryMs = params.logEveryMs ?? 10_000;
  const workDir = await mkdtemp(path.join(tmpdir(), "amethyst-bench-cli-"));
  const walletPath = path.join(workDir, "wallet");
  const passFile = path.join(workDir, "pass");
  await writeFile(passFile, "bench", "utf8");

  const args = [
    ...cliDaemonArgs(params.daemonHttpUrl),
    "--trusted-daemon",
    "--allow-mismatched-daemon-version",
    "--restore-deterministic-wallet",
    "--electrum-seed",
    params.seed,
    "--mnemonic-language",
    "English",
    "--restore-height",
    String(params.restoreHeight),
    "--generate-new-wallet",
    walletPath,
    "--password-file",
    passFile,
    "--max-concurrency",
    String(params.maxConcurrency),
    "--log-level",
    "1",
  ];

  const child = spawn(params.walletCliPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });

  child.stdin?.write("\nN\nexit\n");
  child.stdin?.end();

  const startedAt = Date.now();
  let baselineCpu: number | null = null;
  let lastCpuWorkSec = 0;
  let peakRssBytes = 0;
  let lastLogAt = 0;

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `Native CLI timed out after ${params.timeoutMs}ms (${params.progressLabel})`,
        ),
      );
    }, params.timeoutMs);

    const sample = setInterval(() => {
      if (!child.pid) {
        return;
      }
      if (baselineCpu === null) {
        baselineCpu = readProcCpuSec(child.pid);
      }
      const cpuNow = readProcCpuSec(child.pid);
      if (baselineCpu !== null && cpuNow !== null) {
        lastCpuWorkSec = Math.max(0, cpuNow - baselineCpu);
      }
      peakRssBytes = Math.max(peakRssBytes, readProcRssBytes(child.pid));
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs - lastLogAt >= logEveryMs) {
        lastLogAt = elapsedMs;
        console.log(
          `[bench] ${params.progressLabel} ` +
            `elapsed=${(elapsedMs / 1000).toFixed(1)}s ` +
            `rss=${(peakRssBytes / (1024 * 1024)).toFixed(1)} MiB ` +
            `cpuWork=${lastCpuWorkSec.toFixed(2)}s ` +
            `avgCores=${averageCoresUsed(lastCpuWorkSec, elapsedMs).toFixed(2)}`,
        );
      }
    }, 500);

    child.on("error", (error) => {
      clearTimeout(timer);
      clearInterval(sample);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearInterval(sample);
      resolve(code ?? 1);
    });
  });

  const durationMs = Date.now() - startedAt;

  try {
    await rm(workDir, { recursive: true, force: true });
  } catch {
    // best effort
  }

  if (!output.includes("Refresh done")) {
    throw new Error(
      `Native CLI did not finish refresh (exit ${exitCode}) for ${params.progressLabel}.\n` +
        output.slice(-2000),
    );
  }
  if (!output.includes("dogs zero")) {
    throw new Error(
      `Native CLI did not restore the expected seed for ${params.progressLabel}.\n` +
        output.slice(-2000),
    );
  }

  const addressMatch = /Generated new wallet:\s*([1-9A-HJ-NP-Za-km-z]+)/.exec(
    output,
  );
  const blocksMatch = /blocks received:\s*(\d+)/.exec(output);
  const heightMatches = [...output.matchAll(/Height\s+(\d+)\s*\/\s*(\d+)/g)];
  const lastHeight = heightMatches.at(-1);

  return {
    durationMs,
    restoreHeight: params.restoreHeight,
    finalDaemonHeight: lastHeight ? Number(lastHeight[2]) : null,
    peakRssBytes,
    cpuWorkSec: lastCpuWorkSec,
    avgCoresUsed: averageCoresUsed(lastCpuWorkSec, durationMs),
    addressPrefix: addressMatch ? addressMatch[1].slice(0, 6) : null,
    blocksReceived: blocksMatch ? Number(blocksMatch[1]) : null,
  };
}

export async function ensureBenchArtifactsDir(): Promise<void> {
  await mkdir(path.join(process.cwd(), "tests/bench/results"), {
    recursive: true,
  });
}
