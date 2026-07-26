const DAEMON_LOCAL_ADDRESS = "http://localhost:18081";
const DAEMON_REMOTE_ADDRESS_DEFAULT = "https://xmr-node.cakewallet.com:18081";

export const DAEMON_PRESET_OPTIONS = [
  DAEMON_LOCAL_ADDRESS,
  DAEMON_REMOTE_ADDRESS_DEFAULT,
  "https://node.sethforprivacy.com",
] as const;

export function getDefaultDaemonAddress(): string {
  return location.hostname === "localhost"
    ? DAEMON_LOCAL_ADDRESS
    : DAEMON_REMOTE_ADDRESS_DEFAULT;
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
  existingPresets: readonly string[] = DAEMON_PRESET_OPTIONS,
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
  signal?: AbortSignal,
): Promise<DaemonNodesFetchResult> {
  const urls: string[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const params = new URLSearchParams({
      protocol: "https",
      nettype: "mainnet",
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

export const DAEMON_NODE_SOURCES: readonly DaemonNodeSource[] = [
  { name: "monero.fail", fetchNodes: fetchMoneroFailDaemonNodes },
  { name: "xmr.ditatompel.com", fetchNodes: fetchDitatompelDaemonNodes },
];

export function createInitialRemoteDaemonNodesProgress(): RemoteDaemonNodesProgress {
  return {
    nodes: [],
    pendingCount: DAEMON_NODE_SOURCES.length,
    failedSources: [],
  };
}

/** Fetch every source in parallel and report progress as each settles. */
export async function loadRemoteDaemonNodes(
  onProgress: (progress: RemoteDaemonNodesProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const collected: string[][] = DAEMON_NODE_SOURCES.map(() => []);
  const failedSources: string[] = [];
  let pendingCount = DAEMON_NODE_SOURCES.length;

  const publish = () => {
    if (signal?.aborted) {
      return;
    }
    onProgress({
      nodes: filterRemoteDaemonNodeUrls(collected.flat()),
      pendingCount,
      failedSources: [...failedSources],
    });
  };

  publish();

  await Promise.all(
    DAEMON_NODE_SOURCES.map(async (source, index) => {
      try {
        const result = await source.fetchNodes(signal);
        if (signal?.aborted) {
          return;
        }
        collected[index] = result.urls;
      } catch (e) {
        if (signal?.aborted) {
          return;
        }
        console.error(`Failed to load nodes from ${source.name}:`, e);
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
