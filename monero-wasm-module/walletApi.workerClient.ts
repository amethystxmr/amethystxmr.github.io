import * as Comlink from "comlink";
import type { exposedApi } from "./walletApi.worker";
import { isAsyncifyBuildForced } from "./wasmVariantOverride";
import {
  CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE,
  FeePriority as FeePriorityConst,
  type HttpFetchCallback,
  type HttpFetchEvent,
  type HttpFetchState,
  max64,
  NetworkTypes,
  type FeePriority as FeePriorityType,
  type MoneroWasmWallet,
  type WasmBuildVariant,
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
  HttpFetchCallback,
  HttpFetchEvent,
  HttpFetchState,
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

export type RemoteApi = Comlink.Remote<typeof exposedApi>;

let httpFetchEventChannel: BroadcastChannel | null = null;
let httpFetchCallback: HttpFetchCallback | null = null;

function selectWasmBuildVariant(): WasmBuildVariant {
  if (isAsyncifyBuildForced()) {
    return "asyncify";
  }
  return globalThis.crossOriginIsolated &&
    typeof SharedArrayBuffer === "function"
    ? "threads"
    : "asyncify";
}

function createHttpFetchEventChannelName() {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `amethyst-http-fetch-${randomId}`;
}

const httpFetchEventChannelName = createHttpFetchEventChannelName();

const worker = new Worker(new URL("./walletApi.worker.ts", import.meta.url), {
  name: "monero-wallet-api",
  type: "module",
});
export const api = Comlink.wrap<typeof exposedApi>(worker);

function getStringMessageProperty(value: object, property: string) {
  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "string" ? propertyValue : null;
}

function getNumberMessageProperty(value: object, property: string) {
  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "number" && Number.isFinite(propertyValue)
    ? propertyValue
    : null;
}

function parseHttpFetchState(value: string | null): HttpFetchState | null {
  switch (value) {
    case "start":
    case "progress":
    case "end":
    case "error":
    case "timeout":
    case "abort":
      return value;
    default:
      return null;
  }
}

function parseHttpFetchEvent(value: unknown): HttpFetchEvent | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const url = getStringMessageProperty(value, "url");
  const reqId = getStringMessageProperty(value, "reqId");
  const state = parseHttpFetchState(getStringMessageProperty(value, "state"));
  const progressLoaded = getNumberMessageProperty(value, "progressLoaded");
  const progressTotal = getNumberMessageProperty(value, "progressTotal");

  if (
    !url ||
    !reqId ||
    !state ||
    progressLoaded === null ||
    progressTotal === null
  ) {
    return null;
  }

  return { url, reqId, state, progressLoaded, progressTotal };
}

function ensureHttpFetchEventChannel() {
  if (httpFetchEventChannel) {
    return;
  }

  httpFetchEventChannel = new BroadcastChannel(httpFetchEventChannelName);
  httpFetchEventChannel.onmessage = (message) => {
    const event = parseHttpFetchEvent(message.data);
    if (!event || !httpFetchCallback) {
      return;
    }
    httpFetchCallback(
      event.url,
      event.reqId,
      event.state,
      event.progressLoaded,
      event.progressTotal,
    );
  };
}

export const initModule: (
  onProgress?: Parameters<typeof exposedApi.initModule>[0],
) => ReturnType<typeof exposedApi.initModule> = async (onProgress = null) => {
  await api.initModule(onProgress ? Comlink.proxy(onProgress) : null, {
    variant: selectWasmBuildVariant(),
    httpFetchEventChannelName,
  });
  ensureHttpFetchEventChannel();
};

export async function setWalletNewBlockCallback(
  wallet: MoneroWasmWallet,
  callback: WalletNewBlockCallback,
) {
  const proxyCallback = callback ? Comlink.proxy(callback) : null;
  // Avoid passing wallet into root `api.*`: Comlink emits it as RAW and clone fails on the remote Proxy internal target function.
  await wallet.set_on_new_block_callback(proxyCallback);
}

export const setHttpFetchCallback = async (
  callback: HttpFetchCallback | null,
): Promise<void> => {
  httpFetchCallback = callback;
  ensureHttpFetchEventChannel();
};
