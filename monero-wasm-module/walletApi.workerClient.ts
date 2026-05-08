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
  type KeyImagesImportResult,
  type MoneroWasmWallet,
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
  MoneroWasmWallet,
};

export type RemoteApi = Comlink.Remote<typeof exposedApi>;

const worker = new Worker(new URL("./walletApi.worker.ts", import.meta.url), {
  name: "monero-wallet-api",
  type: "module",
});
export const api = Comlink.wrap<typeof exposedApi>(worker);

export async function setWalletNewBlockCallback(
  wallet: MoneroWasmWallet,
  callback: WalletNewBlockCallback,
) {
  const proxyCallback = callback ? Comlink.proxy(callback) : null;
  // Avoid passing wallet into root `api.*`: Comlink emits it as RAW and clone fails on the remote Proxy internal target function.
  await wallet.set_on_new_block_callback(proxyCallback);
}

export const setHttpFetchCallback: typeof exposedApi.setHttpFetchCallback =
  async (callback) => {
    await api.setHttpFetchCallback(callback ? Comlink.proxy(callback) : null);
  };
