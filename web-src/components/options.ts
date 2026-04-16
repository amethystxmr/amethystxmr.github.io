import {
  getRecommendedMaxConcurrency,
  NetworkTypes,
  type NetworkType as NetworkTypeValue,
} from "../../monero-wasm-module/monero-wasm-wallet-async";

type OptionSchema = {
  loadLastWallet: boolean;
  cpuThreads: number;
  lastWalletName: string | null;
  daemonAddress: string;
  networkType: NetworkTypeValue;
  allowMismatchedDaemonVersion: boolean;
};

const DAEMON_LOCAL_ADDRESS = "http://localhost:18081";
const DAEMON_REMOTE_ADDRESS_DEFAULT = "https://xmr-node.cakewallet.com:18081";
export const DAEMON_PRESET_OPTIONS = [
  DAEMON_LOCAL_ADDRESS,
  DAEMON_REMOTE_ADDRESS_DEFAULT,
  "https://node.sethforprivacy.com",
] as const;

function getDefaultDaemonAddress(): string {
  return location.hostname === "localhost"
    ? DAEMON_LOCAL_ADDRESS
    : DAEMON_REMOTE_ADDRESS_DEFAULT;
}

function getDefaultOptions(): OptionSchema {
  return {
    loadLastWallet: true,
    cpuThreads: getRecommendedMaxConcurrency(),
    lastWalletName: null,
    daemonAddress: getDefaultDaemonAddress(),
    networkType: NetworkTypes.MAINNET,
    allowMismatchedDaemonVersion: false,
  };
}

class GlobalOptions<T extends Record<string, unknown>> {
  private cache: Partial<T> = {};

  constructor(
    private defaults: T,
    private storageKey: string = "options",
    private storage: Storage = localStorage,
  ) {
    this.initializeFromStorage();
  }

  private initializeFromStorage() {
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (raw) {
        this.cache = { ...this.defaults, ...JSON.parse(raw) };
      } else {
        this.cache = { ...this.defaults };
      }
    } catch {
      this.cache = { ...this.defaults };
    }
  }

  private persist() {
    this.storage.setItem(this.storageKey, JSON.stringify(this.cache));
  }

  public getValue<K extends keyof T>(key: K): T[K] {
    return this.cache[key] as T[K];
  }

  public setValue<K extends keyof T>(key: K, value: T[K]) {
    this.cache[key] = value;
    this.persist();
  }
}

export const options = new GlobalOptions<OptionSchema>(getDefaultOptions());
