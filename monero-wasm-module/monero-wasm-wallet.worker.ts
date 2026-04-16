import { expose } from "comlink";
import * as syncApi from "./monero-wasm-wallet";
import type {
  GlobalHttpConfig,
  HttpFetchState,
  MoneroWasmWallet as SyncWallet,
  MultisigTxSetHandle as SyncMultisigTxSetHandle,
  NetworkType,
  PendingTxHandle as SyncPendingTxHandle,
} from "./monero-wasm-wallet";
import {
  type WalletHandleStore,
  type WorkerHandleRef,
  normalizeWalletRpcArgs,
  runWalletRpcPostCall,
  transformWalletRpcResult,
} from "./monero-wasm-wallet-rpc";

export type { WorkerHandleRef } from "./monero-wasm-wallet-rpc";

type StoredHandle =
  | { type: "pendingTx"; value: SyncPendingTxHandle; walletId: number }
  | { type: "multisigTxSet"; value: SyncMultisigTxSetHandle; walletId: number };

let nextWalletId = 1;
let nextHandleId = 1;
const wallets = new Map<number, SyncWallet>();
const handles = new Map<number, StoredHandle>();
const newBlockCallbacks = new Map<
  number,
  (height: bigint, timestamp: bigint) => void
>();

let httpBaseUrl = "";
let onFetchCallback:
  | ((
      url: string,
      reqId: string,
      state: HttpFetchState,
      progressLoaded: number,
      progressTotal: number,
    ) => void)
  | null = null;

function mapHttpUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  const base = httpBaseUrl.replace(/\/+$/, "");
  if (!base) {
    return url;
  }
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${base}${path}`;
}

globalThis.globalHttpConfig = {
  mapUrl: mapHttpUrl,
  onFetch: (...args) => {
    onFetchCallback?.(...args);
  },
} satisfies GlobalHttpConfig;

let operationChain = Promise.resolve();

/** Same serial-queue idea as `enqueue` in `monero-wasm-wallet-async.ts`.
 * Comlink `expose` does not hold the message port until an async handler finishes,
 * so concurrent inbound messages could overlap; our main thread awaits each RPC,
 * but this queue still serializes sync WASM + worker globals as a safety net. */
function enqueue<T>(task: () => T | Promise<T>): Promise<T> {
  const run = operationChain.then(task, task);
  // Keep the internal queue tail always fulfilled: callers await `run` and still
  // see rejections there, but we must not leave `operationChain` rejected or later
  // serial scheduling can inherit a broken chain / unhandled tail rejections.
  operationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function getWallet(walletId: number) {
  const wallet = wallets.get(walletId);
  if (!wallet) {
    throw new Error(`Unknown wallet id ${walletId}`);
  }
  return wallet;
}

function storeHandle(
  handle: SyncPendingTxHandle | SyncMultisigTxSetHandle,
  type: StoredHandle["type"],
  walletId: number,
): WorkerHandleRef {
  const id = nextHandleId++;
  handles.set(id, { type, value: handle, walletId } as StoredHandle);
  return { __workerHandle: true, type, id };
}

function getHandle(ref: WorkerHandleRef, expectedType: "pendingTx"): SyncPendingTxHandle;
function getHandle(
  ref: WorkerHandleRef,
  expectedType: "multisigTxSet",
): SyncMultisigTxSetHandle;
function getHandle(
  ref: WorkerHandleRef,
  expectedType: StoredHandle["type"],
): SyncPendingTxHandle | SyncMultisigTxSetHandle {
  const stored = handles.get(ref.id);
  if (!stored || stored.type !== expectedType) {
    throw new Error(`Unknown ${expectedType} handle ${ref.id}`);
  }
  return stored.value;
}

function deleteHandle(ref: WorkerHandleRef) {
  const stored = handles.get(ref.id);
  if (!stored) {
    return;
  }
  stored.value.delete();
  handles.delete(ref.id);
}

const handleStore: WalletHandleStore = {
  storePendingTx(walletId, handle) {
    return storeHandle(handle, "pendingTx", walletId);
  },
  storeMultisigTx(walletId, handle) {
    return storeHandle(handle, "multisigTxSet", walletId);
  },
  getPendingTx(ref) {
    return getHandle(ref, "pendingTx");
  },
  getMultisigTx(ref) {
    return getHandle(ref, "multisigTxSet");
  },
};

function invokeMethod(target: object, method: string, args: unknown[]) {
  const candidate = (target as Record<string, unknown>)[method];
  if (typeof candidate !== "function") {
    throw new Error(`Unknown method: ${method}`);
  }
  return (candidate as (...methodArgs: unknown[]) => unknown)(...args);
}

const api = {
  async initModule() {
    await enqueue(() => syncApi.initModule());
  },

  async moduleCall(method: string, args: unknown[]) {
    return enqueue(async () => invokeMethod(syncApi, method, args));
  },

  setHttpBaseUrl(baseUrl: string) {
    return enqueue(() => {
      httpBaseUrl = baseUrl;
    });
  },

  setHttpOnFetch(
    callback:
      | ((
          url: string,
          reqId: string,
          state: HttpFetchState,
          progressLoaded: number,
          progressTotal: number,
        ) => void)
      | null,
  ) {
    return enqueue(() => {
      onFetchCallback = callback;
    });
  },

  async createWallet(networkType: NetworkType = syncApi.NetworkTypes.MAINNET) {
    return enqueue(async () => {
      await syncApi.initModule();
      const wallet = syncApi.createWallet(networkType);
      const id = nextWalletId++;
      wallets.set(id, wallet);
      return id;
    });
  },

  async deleteWallet(walletId: number) {
    return enqueue(() => {
      const wallet = getWallet(walletId);
      wallet.delete();
      wallets.delete(walletId);
      newBlockCallbacks.delete(walletId);
      for (const [handleId, stored] of handles) {
        if (stored.walletId === walletId) {
          stored.value.delete();
          handles.delete(handleId);
        }
      }
    });
  },

  async walletCall(walletId: number, method: string, args: unknown[]) {
    return enqueue(async () => {
      const wallet = getWallet(walletId);
      const normalized = normalizeWalletRpcArgs(method, args, handleStore);
      const result = await invokeMethod(wallet, method, normalized);
      runWalletRpcPostCall(method, wallet, walletId, (wid, events) => {
        const callback = newBlockCallbacks.get(wid);
        if (!callback) {
          return;
        }
        for (const event of events) {
          void callback(event.height, event.timestamp);
        }
      });
      return transformWalletRpcResult(method, walletId, result, handleStore);
    });
  },

  async walletSetNewBlockCallback(
    walletId: number,
    callback: ((height: bigint, timestamp: bigint) => void) | null,
  ) {
    return enqueue(() => {
      if (callback) {
        newBlockCallbacks.set(walletId, callback);
      } else {
        newBlockCallbacks.delete(walletId);
      }
      getWallet(walletId).set_on_new_block_callback(null);
    });
  },

  async deleteHandle(handle: WorkerHandleRef) {
    return enqueue(() => {
      deleteHandle(handle);
    });
  },
};

export type MoneroWasmWalletWorkerApi = typeof api;

expose(api);
