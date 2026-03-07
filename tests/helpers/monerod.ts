import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import {
  MONEROD_P2P_PORT,
  MONEROD_RPC_HOST,
  MONEROD_RPC_PORT,
} from "../constants";
import { callMoneroJsonRpc } from "./moneroRpc";

const ARTIFACTS_DIR = path.resolve("tests/.artifacts");
const MONEROD_STATE_PATH = path.join(ARTIFACTS_DIR, "monerod-state.json");
const MONEROD_TMP_DIR_PREFIX = "amethystxmr-monerod-";
const MONEROD_STDOUT_PATH = path.resolve("tests/.artifacts/monerod.stdout.log");
const MONEROD_STDERR_PATH = path.resolve("tests/.artifacts/monerod.stderr.log");

function canExecute(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveMonerodPath(): string {
  const fromEnv = process.env.MONEROD_PATH;
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    if (canExecute(resolved)) {
      return resolved;
    }
    throw new Error(`MONEROD_PATH is set but not executable: ${resolved}`);
  }

  const candidates = [
    "monero/build/debug/bin/monerod",
    "monero-wasm-src/monero/build/debug/bin/monerod",
    "bin/monerod",
    "monerod",
  ];

  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (canExecute(absolute)) {
      return absolute;
    }
  }

  const which = spawnSync("which", ["monerod"], { encoding: "utf8" });
  if (which.status === 0) {
    const found = which.stdout.trim();
    if (found && canExecute(found)) {
      return found;
    }
  }

  throw new Error(
    "Could not find monerod binary. Set MONEROD_PATH to the executable location.",
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMonerodReady(timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = readMonerodState();
    if (state?.pid) {
      try {
        process.kill(state.pid, 0);
      } catch {
        const stderrTail = readFileTail(MONEROD_STDERR_PATH, 80);
        throw new Error(
          `monerod exited before becoming ready. Recent stderr:\n${stderrTail}`,
        );
      }
    }
    try {
      await callMoneroJsonRpc("get_info", {});
      return;
    } catch {
      await wait(500);
    }
  }
  const stderrTail = readFileTail(MONEROD_STDERR_PATH, 80);
  throw new Error(
    `monerod did not become ready within ${timeoutMs}ms. Recent stderr:\n${stderrTail}`,
  );
}

function readMonerodState(): { pid: number; dataDir?: string } | null {
  if (!fs.existsSync(MONEROD_STATE_PATH)) {
    return null;
  }
  try {
    return JSON.parse(
      fs.readFileSync(MONEROD_STATE_PATH, "utf8"),
    ) as { pid: number; dataDir?: string };
  } catch {
    return null;
  }
}

function readFileTail(filePath: string, maxLines: number): string {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    return lines.slice(-maxLines).join("\n").trim();
  } catch {
    return "(stderr not available)";
  }
}

export async function startMonerod(): Promise<void> {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  // Always start from a clean chain state for every test run.
  stopMonerod();

  const monerodPath = resolveMonerodPath();
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), MONEROD_TMP_DIR_PREFIX),
  );

  const stdoutFd = fs.openSync(MONEROD_STDOUT_PATH, "a");
  const stderrFd = fs.openSync(MONEROD_STDERR_PATH, "a");

  const child = spawn(
    monerodPath,
    [
      "--regtest",
      "--offline",
      "--fixed-difficulty",
      "1",
      "--rpc-access-control-origins=*",
      "--rpc-bind-ip",
      MONEROD_RPC_HOST,
      "--rpc-bind-port",
      String(MONEROD_RPC_PORT),
      "--p2p-bind-ip",
      MONEROD_RPC_HOST,
      "--p2p-bind-port",
      String(MONEROD_P2P_PORT),
      "--data-dir",
      dataDir,
      "--non-interactive",
    ],
    {
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    },
  );

  child.unref();

  fs.writeFileSync(
    MONEROD_STATE_PATH,
    JSON.stringify({
      pid: child.pid,
      monerodPath,
      dataDir,
      rpcHost: MONEROD_RPC_HOST,
      rpcPort: MONEROD_RPC_PORT,
      p2pPort: MONEROD_P2P_PORT,
    }),
  );

  await waitForMonerodReady(60_000);
}

export function stopMonerod(): void {
  if (!fs.existsSync(MONEROD_STATE_PATH)) {
    return;
  }

  const { pid, dataDir } = JSON.parse(
    fs.readFileSync(MONEROD_STATE_PATH, "utf8"),
  ) as { pid: number; dataDir?: string };

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // process already dead.
  }

  if (typeof dataDir === "string" && dataDir.length > 0) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  fs.rmSync(MONEROD_STATE_PATH, { force: true });
}
