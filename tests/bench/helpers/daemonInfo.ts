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

function rpcUrl(daemonAddress: string): string {
  return `${daemonAddress.replace(/\/$/, "")}/json_rpc`;
}

export async function fetchDaemonInfo(
  daemonAddress: string,
): Promise<DaemonInfo> {
  const response = await fetch(rpcUrl(daemonAddress), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "bench",
      method: "get_info",
    }),
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

export async function fetchBlockTimestamp(
  daemonAddress: string,
  height: number,
): Promise<number> {
  const response = await fetch(rpcUrl(daemonAddress), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "bench",
      method: "get_block_header_by_height",
      params: { height },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Daemon ${daemonAddress} HTTP ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as {
    result?: { block_header?: { timestamp?: number } };
    error?: { message?: string };
  };
  if (body.error) {
    throw new Error(
      `Daemon ${daemonAddress} RPC error: ${body.error.message ?? "unknown"}`,
    );
  }
  const timestamp = body.result?.block_header?.timestamp;
  if (typeof timestamp !== "number") {
    throw new Error(
      `Daemon ${daemonAddress} returned no timestamp for height ${height}`,
    );
  }
  return timestamp;
}

/** Format a unix-seconds age as e.g. "21d 3h (~3.0w)". */
export function formatAgeFromUnixSeconds(
  blockTimestampSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  const ageSec = Math.max(0, nowSec - blockTimestampSec);
  const days = Math.floor(ageSec / 86400);
  const hours = Math.floor((ageSec % 86400) / 3600);
  const weeks = ageSec / (7 * 86400);
  return `${days}d ${hours}h (~${weeks.toFixed(1)}w)`;
}

/** Verify a production mainnet daemon is reachable and fully synced. Does not start monerod. */
export async function assertDaemonReadyForBench(
  daemonAddress: string,
  label: string,
): Promise<DaemonInfo> {
  let info: DaemonInfo;
  try {
    info = await fetchDaemonInfo(daemonAddress);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${label} daemon at ${daemonAddress} is not reachable: ${message}`,
    );
  }

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
  return info;
}
