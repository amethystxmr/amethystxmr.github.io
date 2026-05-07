import * as Comlink from "comlink";
import type { exposedApi } from "./walletApi.worker";
import {
  CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE,
  FeePriority as FeePriorityConst,
  getMaxConcurrency,
  getRecommendedMaxConcurrency,
  max64,
  NetworkTypes,
  type FeePriority as FeePriorityType,
  type HttpFetchCallback,
  type KeyImagesImportResult,
  type MoneroWasmWallet as BaseMoneroWasmWallet,
  type MultisigAccountStatus,
  type NetworkType,
  type PaymentDetails,
  type TransferInfoItem,
  type TransferItem,
  type WalletAddress,
  type WalletKeys,
  type WalletNewBlockCallback,
  type WalletTxHandle,
} from "./walletApi";

const FeePriority = FeePriorityConst;

export {
  CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE,
  FeePriority,
  getMaxConcurrency,
  getRecommendedMaxConcurrency,
  max64,
  NetworkTypes,
};

export type FeePriority = FeePriorityType;

export type {
  KeyImagesImportResult,
  MultisigAccountStatus,
  NetworkType,
  PaymentDetails,
  TransferInfoItem,
  TransferItem,
  WalletAddress,
  WalletKeys,
  WalletTxHandle,
};

type RemoteApi = Comlink.Remote<typeof exposedApi>;

export type MoneroWasmWallet = BaseMoneroWasmWallet;

type RemoteWallet = Comlink.Remote<
  BaseMoneroWasmWallet & {
    set_on_new_block_callback(callback: WalletNewBlockCallback): Promise<void>;
  }
>;

let worker: Worker | null = null;
let remoteApi: RemoteApi | null = null;
let walletNamesCache: string[] = [];
let moneroVersionFullCache = "unknown";
const remoteWallets = new WeakMap<MoneroWasmWallet, RemoteWallet>();

function getRemoteApi(): RemoteApi {
  if (!remoteApi) {
    worker = new Worker(new URL("./walletApi.worker.ts", import.meta.url), {
      name: "monero-wallet-api",
      type: "module",
    });
    remoteApi = Comlink.wrap<typeof exposedApi>(worker);
  }
  return remoteApi;
}

async function initModule(): Promise<void> {
  await getRemoteApi().initModule();
  const [walletNames, moneroVersionFull] = await Promise.all([
    getRemoteApi().listWalletNames(),
    getRemoteApi().getMoneroVersionFull(),
  ]);
  walletNamesCache = walletNames;
  moneroVersionFullCache = moneroVersionFull;
}

async function createWallet(
  networkType: NetworkType = NetworkTypes.MAINNET,
): Promise<MoneroWasmWallet> {
  const remoteWallet = (await getRemoteApi().createWallet(
    networkType,
  )) as unknown as RemoteWallet;
  const wallet = remoteWallet as unknown as MoneroWasmWallet;
  remoteWallets.set(wallet, remoteWallet);
  return wallet;
}

export async function setWalletNewBlockCallback(
  wallet: MoneroWasmWallet,
  callback: WalletNewBlockCallback,
): Promise<void> {
  const remoteWallet = remoteWallets.get(wallet);
  if (!remoteWallet) {
    throw new Error("Unknown worker wallet instance");
  }
  await remoteWallet.set_on_new_block_callback(
    callback ? Comlink.proxy(callback) : null,
  );
}

async function refreshWalletNames(): Promise<string[]> {
  walletNamesCache = await getRemoteApi().listWalletNames();
  return walletNamesCache;
}

type WorkerApiClient = Omit<
  RemoteApi,
  | "initModule"
  | "createWallet"
  | "setHttpFetchCallback"
  | "listWalletNames"
  | "getMoneroVersionFull"
  | "deleteWalletFiles"
  | "renameWallet"
  | "saveWalletFilesData"
> & {
  initModule: typeof initModule;
  createWallet: typeof createWallet;
  setHttpFetchCallback(callback: HttpFetchCallback | null): Promise<void>;
  listWalletNames(): string[];
  getMoneroVersionFull(): string;
  deleteWalletFiles(walletName: string): Promise<void>;
  renameWallet(oldName: string, newName: string): Promise<void>;
  saveWalletFilesData(
    walletName: string,
    keysFileData: Uint8Array,
    otherFilesData: { name: string; data: Uint8Array }[],
  ): Promise<void>;
};

export const walletApi = new Proxy({} as WorkerApiClient, {
  get(_target, prop, receiver) {
    if (prop === "initModule") {
      return initModule;
    }
    if (prop === "createWallet") {
      return createWallet;
    }
    if (prop === "setHttpFetchCallback") {
      return async (callback: HttpFetchCallback | null) => {
        await getRemoteApi().setHttpFetchCallback(
          callback ? Comlink.proxy(callback) : null,
        );
      };
    }
    if (prop === "listWalletNames") {
      return () => walletNamesCache;
    }
    if (prop === "getMoneroVersionFull") {
      return () => moneroVersionFullCache;
    }
    if (prop === "deleteWalletFiles") {
      return async (walletName: string) => {
        await getRemoteApi().deleteWalletFiles(walletName);
        await refreshWalletNames();
      };
    }
    if (prop === "renameWallet") {
      return async (oldName: string, newName: string) => {
        await getRemoteApi().renameWallet(oldName, newName);
        await refreshWalletNames();
      };
    }
    if (prop === "saveWalletFilesData") {
      return async (
        walletName: string,
        keysFileData: Uint8Array,
        otherFilesData: { name: string; data: Uint8Array }[],
      ) => {
        await getRemoteApi().saveWalletFilesData(
          walletName,
          keysFileData,
          otherFilesData,
        );
        await refreshWalletNames();
      };
    }

    const value = Reflect.get(getRemoteApi(), prop, receiver);
    if (typeof value !== "function") {
      return value;
    }
    return (...args: unknown[]) => value(...args);
  },
});
