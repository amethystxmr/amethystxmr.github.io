import * as Comlink from "comlink";
import type { exposedApi } from "./walletApi.worker";
import {
  ensureHttpFetchEventChannel,
  httpFetchEventChannelName,
  setHttpFetchWasmMemory,
} from "./httpFetchBridge";
import {
  CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE,
  FeePriority as FeePriorityConst,
  max64,
  NetworkTypes,
  type FeePriority as FeePriorityType,
  type InitModuleOptions,
  type MoneroWasmWallet,
  type WalletNewBlockCallback,
} from "./walletApi";

const FeePriority = FeePriorityConst;

export {
  CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE,
  FeePriority,
  max64,
  NetworkTypes,
};

export type FeePriority = FeePriorityType;

export type {
  DecodedPolyseed,
  EncodablePolyseed,
  GeneratePolyseedStorageOptions,
  KeyImagesImportResult,
  MaybePromise,
  ModuleLoadProgress,
  ModuleLoadProgressCallback,
  MultisigAccountStatus,
  NetworkType,
  PaymentDetails,
  PolyseedStorage,
  TransferInfoItem,
  TransferItem,
  WalletAddress,
  WalletKeys,
  WalletTxHandle,
  MoneroWasmWallet,
  WasmBuildVariant,
} from "./walletApi";

export type WorkerClientInitModuleOptions = Omit<
  InitModuleOptions,
  "httpFetchEventChannelName"
>;

export type RemoteApi = Comlink.Remote<typeof exposedApi>;

const worker = new Worker(new URL("./walletApi.worker.ts", import.meta.url), {
  name: "monero-wallet-api",
  type: "module",
});
export const api = Comlink.wrap<typeof exposedApi>(worker);

export async function getWasmMemoryByteLength(): Promise<number> {
  return await api.getWasmMemoryByteLength();
}

window.amethystRuntime = {
  ...window.amethystRuntime,
  getWasmMemoryByteLength,
};

export const initModule: (
  options: WorkerClientInitModuleOptions,
  onProgress?: Parameters<typeof exposedApi.initModule>[0],
) => ReturnType<typeof exposedApi.initModule> = async (
  options,
  onProgress = null,
) => {
  ensureHttpFetchEventChannel();
  await api.initModule(onProgress ? Comlink.proxy(onProgress) : null, {
    ...options,
    httpFetchEventChannelName,
  });
  if (options.variant === "threads") {
    setHttpFetchWasmMemory(await api.getWasmMemory());
  }
};

export async function setWalletNewBlockCallback(
  wallet: MoneroWasmWallet,
  callback: WalletNewBlockCallback,
) {
  const proxyCallback = callback ? Comlink.proxy(callback) : null;
  // Avoid passing wallet into root `api.*`: Comlink emits it as RAW and clone fails on the remote Proxy internal target function.
  await wallet.set_on_new_block_callback(proxyCallback);
}
