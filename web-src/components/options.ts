import {
  NetworkTypes,
  type NetworkType as NetworkTypeValue,
} from "../../monero-wasm-module/walletApi.workerClient";
import { getDefaultDaemonAddress } from "./daemonNodes";

type OptionSchema = {
  loadLastWallet: boolean;
  lastWalletName: string | null;
  daemonAddress: string;
  networkType: NetworkTypeValue;
  allowMismatchedDaemonVersion: boolean;
};

function getDefaultOptions(): OptionSchema {
  return {
    loadLastWallet: true,
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
