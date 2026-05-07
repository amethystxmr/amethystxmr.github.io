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

function wrapWallet(remoteWallet: RemoteWallet): MoneroWasmWallet {
  const wrappedWallet = new Proxy(remoteWallet, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof prop !== "string" || typeof value !== "function") {
        return value;
      }

      if (prop === "delete") {
        return async (...args: unknown[]) => {
          try {
            return await value.apply(target, args);
          } finally {
            target[Comlink.releaseProxy]();
          }
        };
      }

      return value;
    },
  }) as unknown as MoneroWasmWallet;
  remoteWallets.set(wrappedWallet, remoteWallet);
  return wrappedWallet;
}

export async function initModule(): Promise<void> {
  await getRemoteApi().initModule();
  const [walletNames, moneroVersionFull] = await Promise.all([
    getRemoteApi().listWalletNames(),
    getRemoteApi().getMoneroVersionFull(),
  ]);
  walletNamesCache = walletNames;
  moneroVersionFullCache = moneroVersionFull;
}

export async function createWallet(
  networkType: NetworkType = NetworkTypes.MAINNET,
): Promise<MoneroWasmWallet> {
  const remoteWallet = (await getRemoteApi().createWallet(
    networkType,
  )) as unknown as RemoteWallet;
  return wrapWallet(remoteWallet);
}

export async function setDaemonAddress(daemonAddress: string): Promise<void> {
  await getRemoteApi().setDaemonAddress(daemonAddress);
}

export async function setHttpFetchCallback(
  callback: HttpFetchCallback | null,
): Promise<void> {
  await getRemoteApi().setHttpFetchCallback(
    callback ? Comlink.proxy(callback) : null,
  );
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

export async function setMaxConcurrency(threads: number): Promise<void> {
  await getRemoteApi().setMaxConcurrency(threads);
}

export async function decodePolyseed(moneroPolyseed: string) {
  return await getRemoteApi().decodePolyseed(moneroPolyseed);
}

export function getMoneroVersionFull() {
  return moneroVersionFullCache;
}

export async function loadFilesystem(): Promise<void> {
  await getRemoteApi().loadFilesystem();
}

export async function saveFilesystem(): Promise<void> {
  await getRemoteApi().saveFilesystem();
}

export async function clearFilesystem(): Promise<void> {
  await getRemoteApi().clearFilesystem();
}

async function refreshWalletNames(): Promise<string[]> {
  walletNamesCache = await getRemoteApi().listWalletNames();
  return walletNamesCache;
}

export function listWalletNames(): string[] {
  return walletNamesCache;
}

export async function deleteWalletFiles(walletName: string): Promise<void> {
  await getRemoteApi().deleteWalletFiles(walletName);
  await refreshWalletNames();
}

export async function readFile(path: string): Promise<Uint8Array> {
  return await getRemoteApi().readFile(path);
}

export async function writeFile(
  path: string,
  data: Uint8Array,
): Promise<void> {
  await getRemoteApi().writeFile(path, data);
}

export async function unlinkFile(path: string): Promise<void> {
  await getRemoteApi().unlinkFile(path);
}

export async function isWalletFileExists(walletName: string): Promise<boolean> {
  return await getRemoteApi().isWalletFileExists(walletName);
}

export async function renameWallet(
  oldName: string,
  newName: string,
): Promise<void> {
  await getRemoteApi().renameWallet(oldName, newName);
  await refreshWalletNames();
}

export async function getWalletFilesData(walletName: string) {
  return await getRemoteApi().getWalletFilesData(walletName);
}

export async function saveWalletFilesData(
  walletName: string,
  keysFileData: Uint8Array,
  otherFilesData: { name: string; data: Uint8Array }[],
): Promise<void> {
  await getRemoteApi().saveWalletFilesData(
    walletName,
    keysFileData,
    otherFilesData,
  );
  await refreshWalletNames();
}

