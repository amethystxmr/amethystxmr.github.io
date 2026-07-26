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

export const MONERO_FAIL_NODES_URL = "https://monero.fail/nodes.json";

type MoneroFailNodesResponse = {
  monero?: {
    web_compatible?: string[];
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

/** Drop exact duplicates, drop :443 when bare https://host exists, skip presets. */
export function filterMoneroFailWebCompatibleNodes(
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

export async function fetchMoneroFailWebCompatibleNodes(
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetch(MONERO_FAIL_NODES_URL, { signal });
  if (!response.ok) {
    throw new Error(
      `Failed to load nodes from monero.fail (${response.status})`,
    );
  }
  const data = (await response.json()) as MoneroFailNodesResponse;
  const webCompatible = data.monero?.web_compatible ?? [];
  return filterMoneroFailWebCompatibleNodes(webCompatible);
}
