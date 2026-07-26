import {
  NetworkTypes,
  type NetworkType,
} from "../../monero-wasm-module/walletApi.workerClient";

const DAEMON_LOCAL_ADDRESS = "http://localhost:18081";
const DAEMON_REMOTE_ADDRESS_DEFAULT = "https://xmr-node.cakewallet.com:18081";

const MAINNET_DAEMON_PRESET_OPTIONS = [
  DAEMON_LOCAL_ADDRESS,
  DAEMON_REMOTE_ADDRESS_DEFAULT,
  "https://node.sethforprivacy.com",
] as const;
const EMPTY_DAEMON_PRESET_OPTIONS: readonly string[] = [];

export function getDaemonPresetOptions(
  networkType: NetworkType,
): readonly string[] {
  switch (networkType) {
    case NetworkTypes.MAINNET:
      return MAINNET_DAEMON_PRESET_OPTIONS;
    case NetworkTypes.STAGENET:
    case NetworkTypes.TESTNET:
    case NetworkTypes.FAKECHAIN:
      return EMPTY_DAEMON_PRESET_OPTIONS;
    default: {
      networkType satisfies never;
      return EMPTY_DAEMON_PRESET_OPTIONS;
    }
  }
}

export function getDefaultDaemonAddress(): string {
  return location.hostname === "localhost"
    ? DAEMON_LOCAL_ADDRESS
    : DAEMON_REMOTE_ADDRESS_DEFAULT;
}

export function networkTypeToDaemonNettype(networkType: NetworkType): string {
  switch (networkType) {
    case NetworkTypes.MAINNET:
      return "mainnet";
    case NetworkTypes.TESTNET:
      return "testnet";
    case NetworkTypes.STAGENET:
      return "stagenet";
    case NetworkTypes.FAKECHAIN:
      return "fakechain";
    default: {
      networkType satisfies never;
      return "mainnet";
    }
  }
}

/** Shared result shape for every daemon node source helper. */
export type DaemonNodesFetchResult = {
  urls: string[];
};

export type DaemonNodeSource = {
  name: string;
  fetchNodes: (signal?: AbortSignal) => Promise<DaemonNodesFetchResult>;
};

export type RemoteDaemonNodesProgress = {
  nodes: string[];
  pendingCount: number;
  failedSources: string[];
};

export const MONERO_FAIL_NODES_URL = "https://monero.fail/nodes.json";
export const DITATOMPEL_NODES_API_URL =
  "https://xmr.ditatompel.com/api/v1/nodes";

type MoneroFailNodesResponse = {
  monero?: {
    web_compatible?: string[];
  };
};

type DitatompelNodeItem = {
  hostname: string;
  port: number;
  protocol: string;
};

type DitatompelNodesResponse = {
  status?: string;
  data?: {
    total_pages?: number;
    items?: DitatompelNodeItem[] | null;
  };
};

type DitatompelNettype = "mainnet" | "testnet" | "stagenet";

/** True for https://host or https://host/... with no explicit port. */
function getHttpsHostnameWithoutPort(url: string): string | null {
  // URL() collapses https://host:443 to port "", so inspect the raw string.
  const match = /^https:\/\/([^/:]+)(?:\/|$)/.exec(url);
  return match?.[1] ?? null;
}

function hasExplicitHttpsPort443(url: string): boolean {
  return /^https:\/\/[^/]+:443(?:\/|$)/.test(url);
}

function ditatompelNodeToUrl(item: DitatompelNodeItem): string | null {
  if (item.protocol !== "https" || !item.hostname) {
    return null;
  }
  if (item.port === 443) {
    return `https://${item.hostname}`;
  }
  return `https://${item.hostname}:${item.port}`;
}

/** Drop exact duplicates, drop :443 when bare https://host exists, skip presets. */
export function filterRemoteDaemonNodeUrls(
  urls: readonly string[],
  existingPresets: readonly string[],
): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    unique.push(url);
  }

  const bareHttpsHosts = new Set<string>();
  for (const url of [...unique, ...existingPresets]) {
    const hostname = getHttpsHostnameWithoutPort(url);
    if (hostname) {
      bareHttpsHosts.add(hostname);
    }
  }

  const presetSet = new Set<string>(existingPresets);
  const filtered: string[] = [];
  for (const url of unique) {
    if (presetSet.has(url)) {
      continue;
    }
    try {
      const hostname = new URL(url).hostname;
      if (hasExplicitHttpsPort443(url) && bareHttpsHosts.has(hostname)) {
        continue;
      }
    } catch {
      continue;
    }
    filtered.push(url);
  }
  return filtered;
}

export async function fetchMoneroFailDaemonNodes(
  signal?: AbortSignal,
): Promise<DaemonNodesFetchResult> {
  const response = await fetch(MONERO_FAIL_NODES_URL, { signal });
  if (!response.ok) {
    throw new Error(
      `Failed to load nodes from monero.fail (${response.status})`,
    );
  }
  const data = (await response.json()) as MoneroFailNodesResponse;
  return { urls: data.monero?.web_compatible ?? [] };
}

export async function fetchDitatompelDaemonNodes(
  nettype: DitatompelNettype,
  signal?: AbortSignal,
): Promise<DaemonNodesFetchResult> {
  const urls: string[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const params = new URLSearchParams({
      protocol: "https",
      nettype,
      cors: "1",
      status: "1",
      limit: "100",
      page: String(page),
    });
    const response = await fetch(`${DITATOMPEL_NODES_API_URL}?${params}`, {
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to load nodes from xmr.ditatompel.com (${response.status})`,
      );
    }
    const data = (await response.json()) as DitatompelNodesResponse;
    if (data.status && data.status !== "ok") {
      throw new Error(
        `Failed to load nodes from xmr.ditatompel.com (${data.status})`,
      );
    }
    totalPages = Math.max(1, data.data?.total_pages ?? 1);
    for (const item of data.data?.items ?? []) {
      const url = ditatompelNodeToUrl(item);
      if (url) {
        urls.push(url);
      }
    }
    page += 1;
  } while (page <= totalPages);

  return { urls };
}

export function getDaemonNodeSources(
  networkType: NetworkType,
): readonly DaemonNodeSource[] {
  switch (networkType) {
    case NetworkTypes.MAINNET:
      return [
        { name: "monero.fail", fetchNodes: fetchMoneroFailDaemonNodes },
        {
          name: "xmr.ditatompel.com",
          fetchNodes: (signal) => fetchDitatompelDaemonNodes("mainnet", signal),
        },
      ];
    case NetworkTypes.STAGENET:
      return [
        {
          name: "xmr.ditatompel.com",
          fetchNodes: (signal) =>
            fetchDitatompelDaemonNodes("stagenet", signal),
        },
      ];
    case NetworkTypes.TESTNET:
      return [
        {
          name: "xmr.ditatompel.com",
          fetchNodes: (signal) => fetchDitatompelDaemonNodes("testnet", signal),
        },
      ];
    case NetworkTypes.FAKECHAIN:
      return [];
    default: {
      networkType satisfies never;
      return [];
    }
  }
}

export function createIdleRemoteDaemonNodesProgress(): RemoteDaemonNodesProgress {
  return {
    nodes: [],
    pendingCount: 0,
    failedSources: [],
  };
}

export function createInitialRemoteDaemonNodesProgress(
  networkType: NetworkType,
): RemoteDaemonNodesProgress {
  return {
    nodes: [],
    pendingCount: getDaemonNodeSources(networkType).length,
    failedSources: [],
  };
}

export type DaemonAddressCheckResult =
  | { status: "ok" }
  | { status: "wrong_network" }
  | { status: "fail"; reason: string };

const DAEMON_CHECK_TIMEOUT_MS = 10_000;

function classifyDaemonCheckFailure(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    if (
      message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("load failed")
    ) {
      return "network/CORS";
    }
    return error.message || "network error";
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("certificate") ||
      message.includes("ssl") ||
      message.includes("tls") ||
      message.includes("cert")
    ) {
      return "HTTPS certificate";
    }
    return error.message || "unknown error";
  }
  return "unknown error";
}

export async function checkDaemonAddress(
  daemonAddress: string,
  expectedNettype: string,
  signal?: AbortSignal,
): Promise<DaemonAddressCheckResult> {
  const base = daemonAddress.replace(/\/$/, "");
  if (!base) {
    return { status: "fail", reason: "empty address" };
  }

  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => {
    timeoutController.abort();
  }, DAEMON_CHECK_TIMEOUT_MS);
  const onExternalAbort = () => {
    timeoutController.abort();
  };
  signal?.addEventListener("abort", onExternalAbort);

  try {
    const response = await fetch(`${base}/json_rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "0",
        method: "get_info",
      }),
      signal: timeoutController.signal,
    });
    if (!response.ok) {
      return { status: "fail", reason: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as {
      result?: { nettype?: string };
      error?: { message?: string };
    };
    if (payload.error) {
      return {
        status: "fail",
        reason: payload.error.message ?? "RPC error",
      };
    }
    const nettype = payload.result?.nettype;
    if (typeof nettype !== "string" || !nettype) {
      return { status: "fail", reason: "missing nettype" };
    }
    if (nettype !== expectedNettype) {
      return { status: "wrong_network" };
    }
    return { status: "ok" };
  } catch (error) {
    if (signal?.aborted) {
      return { status: "fail", reason: "cancelled" };
    }
    return { status: "fail", reason: classifyDaemonCheckFailure(error) };
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** Fetch every source in parallel and report progress as each settles. */
export async function loadRemoteDaemonNodes(
  networkType: NetworkType,
  onProgress: (progress: RemoteDaemonNodesProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const sources = getDaemonNodeSources(networkType);
  const presets = getDaemonPresetOptions(networkType);
  const collected: string[][] = sources.map(() => []);
  const failedSources: string[] = [];
  let pendingCount = sources.length;

  const publish = () => {
    if (signal?.aborted) {
      return;
    }
    onProgress({
      nodes: filterRemoteDaemonNodeUrls(collected.flat(), presets),
      pendingCount,
      failedSources: [...failedSources],
    });
  };

  publish();

  if (sources.length === 0) {
    return;
  }

  await Promise.all(
    sources.map(async (source, index) => {
      try {
        const result = await source.fetchNodes(signal);
        if (signal?.aborted) {
          return;
        }
        const nodesBefore = new Set(
          filterRemoteDaemonNodeUrls(collected.flat(), presets),
        );
        collected[index] = result.urls;
        const nodesAfter = filterRemoteDaemonNodeUrls(
          collected.flat(),
          presets,
        );
        const addedCount = nodesAfter.filter(
          (url) => !nodesBefore.has(url),
        ).length;
        console.log(
          `Fetched ${result.urls.length} nodes from ${source.name}, added ${addedCount} nodes to the list`,
        );
      } catch (e) {
        if (signal?.aborted) {
          return;
        }
        console.log(`Failed to fetch from ${source.name}`);
        console.error(e);
        failedSources.push(source.name);
      } finally {
        if (!signal?.aborted) {
          pendingCount -= 1;
          publish();
        }
      }
    }),
  );
}
