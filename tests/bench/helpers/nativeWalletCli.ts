import { execSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { averageCoresUsed } from "./processMetrics";

export type NativeSyncResult = {
  durationMs: number;
  restoreHeight: number;
  finalDaemonHeight: number | null;
  peakRssBytes: number;
  cpuWorkSec: number;
  avgCoresUsed: number;
  addressPrefix: string | null;
  blocksReceived: number | null;
  /** Process /proc/<pid>/io rchar delta (includes socket reads). */
  rxBytes: number | null;
  /** Process /proc/<pid>/io wchar delta (includes socket writes). */
  txBytes: number | null;
};

export type NativeMaxConcurrency = 0 | 1 | 2 | 4;

const CLK_TCK = (() => {
  try {
    return (
      Number(execSync("getconf CLK_TCK", { encoding: "utf8" }).trim()) || 100
    );
  } catch {
    return 100;
  }
})();

/** Headed by default; set BENCH_HEADLESS=1 (or CI) for headless. */
export function isBenchHeaded(): boolean {
  if (process.env.BENCH_HEADLESS === "1") {
    return false;
  }
  if (process.env.CI) {
    return false;
  }
  return true;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function commandExists(command: string): boolean {
  try {
    execSync(`command -v ${shellQuote(command)}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Terminal emulator used to show monero-wallet-cli when headed. */
function resolveBenchTerminal(): string | null {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return null;
  }
  const fromEnv = process.env.BENCH_TERMINAL;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  for (const candidate of [
    "gnome-terminal",
    "x-terminal-emulator",
    "konsole",
    "xterm",
  ]) {
    if (commandExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

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

/**
 * Process I/O counters. rchar/wchar include bytes read/written via syscalls
 * (network sockets included), so deltas approximate inbound/outbound traffic.
 */
function readProcIoChars(pid: number): { rchar: number; wchar: number } | null {
  try {
    const io = readFileSync(`/proc/${pid}/io`, "utf8");
    const rchar = /^rchar:\s+(\d+)$/m.exec(io);
    const wchar = /^wchar:\s+(\d+)$/m.exec(io);
    if (!rchar || !wchar) {
      return null;
    }
    return { rchar: Number(rchar[1]), wchar: Number(wchar[1]) };
  } catch {
    return null;
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

type CliRunHandle = {
  getPid: () => number | null;
  getOutput: () => string;
  waitForExit: () => Promise<number>;
  dispose: () => void;
};

function startHeadlessCli(walletCliPath: string, args: string[]): CliRunHandle {
  const child = spawn(walletCliPath, args, {
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

  return {
    getPid: () => child.pid ?? null,
    getOutput: () => output,
    waitForExit: () =>
      new Promise<number>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code ?? 1));
      }),
    dispose: () => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    },
  };
}

/**
 * Run monero-wallet-cli in a visible terminal (no GUI binary exists).
 * Output is tee'd to a log file so the bench can still parse results.
 */
async function startHeadedCli(params: {
  walletCliPath: string;
  args: string[];
  workDir: string;
  progressLabel: string;
  terminal: string;
}): Promise<CliRunHandle> {
  const outPath = path.join(params.workDir, "cli.out");
  const pidPath = path.join(params.workDir, "cli.pid");
  const exitPath = path.join(params.workDir, "cli.exit");
  const promptsPath = path.join(params.workDir, "cli.prompts");
  const runnerPath = path.join(params.workDir, "run-cli.sh");

  await writeFile(promptsPath, "\nN\nexit\n", "utf8");
  await writeFile(outPath, "", "utf8");

  const quotedArgs = params.args.map(shellQuote).join(" ");
  const script = `#!/usr/bin/env bash
set -uo pipefail
cd ${shellQuote(params.workDir)}
printf '%s\\n' ${shellQuote(params.progressLabel)} 
set +e
${shellQuote(params.walletCliPath)} ${quotedArgs} < ${shellQuote(promptsPath)} > >(tee ${shellQuote(outPath)}) 2>&1 &
echo $! > ${shellQuote(pidPath)}
wait "$(cat ${shellQuote(pidPath)})"
echo $? > ${shellQuote(exitPath)}
set -e
`;
  await writeFile(runnerPath, script, { mode: 0o755 });

  let terminalChild: ChildProcess | null = null;
  const termArgs =
    params.terminal === "gnome-terminal" ||
    params.terminal.endsWith("gnome-terminal")
      ? ["--", "bash", runnerPath]
      : params.terminal === "konsole"
        ? ["-e", "bash", runnerPath]
        : ["-e", "bash", runnerPath];

  terminalChild = spawn(params.terminal, termArgs, {
    stdio: "ignore",
    detached: true,
  });
  terminalChild.unref();

  const startedAt = Date.now();
  while (!existsSync(pidPath)) {
    if (Date.now() - startedAt > 15_000) {
      throw new Error(
        `Timed out waiting for headed monero-wallet-cli pid (${params.progressLabel})`,
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  return {
    getPid: () => {
      try {
        const raw = readFileSync(pidPath, "utf8").trim();
        const pid = Number(raw);
        return Number.isNaN(pid) ? null : pid;
      } catch {
        return null;
      }
    },
    getOutput: () => {
      try {
        return readFileSync(outPath, "utf8");
      } catch {
        return "";
      }
    },
    waitForExit: async () => {
      const waitStarted = Date.now();
      while (!existsSync(exitPath)) {
        if (Date.now() - waitStarted > 24 * 60 * 60 * 1000) {
          throw new Error(
            `Timed out waiting for headed CLI exit file (${params.progressLabel})`,
          );
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      const code = Number(readFileSync(exitPath, "utf8").trim());
      return Number.isNaN(code) ? 1 : code;
    },
    dispose: () => {
      const pid = (() => {
        try {
          return Number(readFileSync(pidPath, "utf8").trim());
        } catch {
          return NaN;
        }
      })();
      if (!Number.isNaN(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already exited
        }
      }
      if (terminalChild && !terminalChild.killed) {
        try {
          terminalChild.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * Restore+sync with monero-wallet-cli.
 * Stdin: empty seed-offset passphrase, N (background mining), exit.
 *
 * `--max-concurrency` is the correct knob (wallet_args → tools::set_max_concurrency).
 * In Monero, n < 1 is treated as boost::thread::hardware_concurrency() (all cores),
 * so `--max-concurrency 0` means "use all cores", not "zero threads".
 *
 * Headed mode (default): opens the CLI in a terminal emulator when DISPLAY is
 * available. There is no GUI for monero-wallet-cli; this is the closest analogue.
 */
export async function runNativeWalletCliSync(params: {
  walletCliPath: string;
  seed: string;
  restoreHeight: number;
  daemonHttpUrl: string;
  maxConcurrency: NativeMaxConcurrency;
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

  const terminal = isBenchHeaded() ? resolveBenchTerminal() : null;
  const handle =
    terminal !== null
      ? await startHeadedCli({
          walletCliPath: params.walletCliPath,
          args,
          workDir,
          progressLabel: params.progressLabel,
          terminal,
        })
      : startHeadlessCli(params.walletCliPath, args);

  if (terminal !== null) {
    console.log(
      `[bench] ${params.progressLabel} native CLI headed via ${terminal}`,
    );
  }

  const startedAt = Date.now();
  let baselineCpu: number | null = null;
  let baselineIo: { rchar: number; wchar: number } | null = null;
  let lastCpuWorkSec = 0;
  let lastRxBytes = 0;
  let lastTxBytes = 0;
  let peakRssBytes = 0;
  let lastLogAt = 0;

  let exitCode: number;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        handle.dispose();
        reject(
          new Error(
            `Native CLI timed out after ${params.timeoutMs}ms (${params.progressLabel})`,
          ),
        );
      }, params.timeoutMs);

      const sample = setInterval(() => {
        const pid = handle.getPid();
        if (pid === null) {
          return;
        }
        if (baselineCpu === null) {
          baselineCpu = readProcCpuSec(pid);
        }
        if (baselineIo === null) {
          baselineIo = readProcIoChars(pid);
        }
        const cpuNow = readProcCpuSec(pid);
        if (baselineCpu !== null && cpuNow !== null) {
          lastCpuWorkSec = Math.max(0, cpuNow - baselineCpu);
        }
        const ioNow = readProcIoChars(pid);
        if (baselineIo !== null && ioNow !== null) {
          lastRxBytes = Math.max(0, ioNow.rchar - baselineIo.rchar);
          lastTxBytes = Math.max(0, ioNow.wchar - baselineIo.wchar);
        }
        peakRssBytes = Math.max(peakRssBytes, readProcRssBytes(pid));
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs - lastLogAt >= logEveryMs) {
          lastLogAt = elapsedMs;
          console.log(
            `[bench] ${params.progressLabel} ` +
              `elapsed=${(elapsedMs / 1000).toFixed(1)}s ` +
              `rss=${(peakRssBytes / (1024 * 1024)).toFixed(1)} MiB ` +
              `cpuWork=${lastCpuWorkSec.toFixed(2)}s ` +
              `avgCores=${averageCoresUsed(lastCpuWorkSec, elapsedMs).toFixed(2)} ` +
              `rx=${(lastRxBytes / (1024 * 1024)).toFixed(1)} MiB ` +
              `tx=${(lastTxBytes / (1024 * 1024)).toFixed(1)} MiB`,
          );
        }
      }, 500);

      handle
        .waitForExit()
        .then((code) => {
          clearTimeout(timer);
          clearInterval(sample);
          resolve(code);
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          clearInterval(sample);
          reject(error);
        });
    });
  } finally {
    // headed terminal exits on its own; ensure CLI is gone on errors
  }

  const durationMs = Date.now() - startedAt;
  const output = handle.getOutput();

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
    rxBytes: baselineIo === null ? null : lastRxBytes,
    txBytes: baselineIo === null ? null : lastTxBytes,
  };
}

export async function ensureBenchArtifactsDir(): Promise<void> {
  await mkdir(path.join(process.cwd(), "tests/bench/results"), {
    recursive: true,
  });
}
