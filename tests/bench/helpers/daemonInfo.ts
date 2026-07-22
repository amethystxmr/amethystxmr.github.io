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
