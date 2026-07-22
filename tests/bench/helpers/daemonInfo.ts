export type DaemonInfo = {
  address: string;
  height: number;
  targetHeight: number;
  synchronized: boolean;
  mainnet: boolean;
  status: string;
  busySyncing: boolean;
};

type GetInfoResult = {
  height?: number;
  target_height?: number;
  synchronized?: boolean;
  mainnet?: boolean;
  status?: string;
  busy_syncing?: boolean;
};

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_READY_ATTEMPTS = 5;
const DEFAULT_READY_RETRY_DELAY_MS = 2_000;

function rpcUrl(daemonAddress: string): string {
  return `${daemonAddress.replace(/\/$/, "")}/json_rpc`;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause =
    error.cause instanceof Error
      ? error.cause.message
      : error.cause
        ? String(error.cause)
        : null;
  return cause ? `${error.message} (${cause})` : error.message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchDaemonInfo(
  daemonAddress: string,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<DaemonInfo> {
  const response = await fetch(rpcUrl(daemonAddress), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "bench",
      method: "get_info",
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(
      `Daemon ${daemonAddress} HTTP ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as {
    result?: GetInfoResult;
    error?: { message?: string };
  };
  if (body.error) {
    throw new Error(
      `Daemon ${daemonAddress} RPC error: ${body.error.message ?? "unknown"}`,
    );
  }
  const result = body.result;
  if (!result) {
    throw new Error(`Daemon ${daemonAddress} returned no get_info result`);
  }
  return {
    address: daemonAddress,
    height: result.height ?? 0,
    targetHeight: result.target_height ?? 0,
    synchronized: result.synchronized === true,
    mainnet: result.mainnet === true,
    status: result.status ?? "",
    busySyncing: result.busy_syncing === true,
  };
}

/** Verify a production mainnet daemon is reachable and fully synced. Does not start monerod. */
export async function assertDaemonReadyForBench(
  daemonAddress: string,
  label: string,
  options?: {
    attempts?: number;
    retryDelayMs?: number;
    fetchTimeoutMs?: number;
  },
): Promise<DaemonInfo> {
  const attempts = options?.attempts ?? DEFAULT_READY_ATTEMPTS;
  const retryDelayMs = options?.retryDelayMs ?? DEFAULT_READY_RETRY_DELAY_MS;
  const fetchTimeoutMs = options?.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const info = await fetchDaemonInfo(daemonAddress, fetchTimeoutMs);

      if (!info.mainnet) {
        throw new Error(
          `${label} daemon at ${daemonAddress} is not mainnet (got mainnet=${info.mainnet})`,
        );
      }
      if (info.status !== "OK") {
        throw new Error(
          `${label} daemon at ${daemonAddress} status is ${info.status}, expected OK`,
        );
      }
      const nearTip =
        info.targetHeight === 0 ||
        info.height >= info.targetHeight ||
        info.targetHeight - info.height <= 2;
      if (!info.synchronized && !nearTip) {
        throw new Error(
          `${label} daemon at ${daemonAddress} is not synchronized ` +
            `(height=${info.height}, target_height=${info.targetHeight}, busy_syncing=${info.busySyncing})`,
        );
      }
      if (attempt > 1) {
        console.log(
          `[bench] ${label} daemon ready after ${attempt}/${attempts} attempts`,
        );
      }
      return info;
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      if (attempt < attempts) {
        console.log(
          `[bench] ${label} daemon check failed (${attempt}/${attempts}): ${message}; retrying in ${retryDelayMs}ms`,
        );
        await sleep(retryDelayMs * attempt);
        continue;
      }
    }
  }

  throw new Error(
    `${label} daemon at ${daemonAddress} is not reachable after ${attempts} attempts: ${errorMessage(lastError)}`,
  );
}
