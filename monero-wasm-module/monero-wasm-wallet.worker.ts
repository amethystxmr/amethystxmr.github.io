import { expose } from "comlink";
import * as syncApi from "./monero-wasm-wallet.ts";
import type {
  GlobalHttpConfig,
  HttpFetchState,
  MoneroWasmWallet as SyncWallet,
  MultisigTxSetHandle as SyncMultisigTxSetHandle,
  NetworkType,
  PaymentDetails,
  PendingTxHandle as SyncPendingTxHandle,
  WalletAddress,
} from "./monero-wasm-wallet.ts";

type StoredHandle =
  | { type: "pendingTx"; value: SyncPendingTxHandle; walletId: number }
  | { type: "multisigTxSet"; value: SyncMultisigTxSetHandle; walletId: number };

export type WorkerHandleRef = {
  __workerHandle: true;
  type: StoredHandle["type"];
  id: number;
};

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

function runExclusive<T>(task: () => T | Promise<T>): Promise<T> {
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

function flushNewBlockCallbacks(walletId: number) {
  const callback = newBlockCallbacks.get(walletId);
  const events = getWallet(walletId).drain_new_block_events();
  if (!callback) {
    return;
  }
  for (const event of events) {
    void callback(event.height, event.timestamp);
  }
}

function sortWalletAddresses(addresses: WalletAddress[]) {
  return [...addresses].sort((a, b) => a.indexMinor - b.indexMinor);
}

function sortPayments(payments: PaymentDetails[]) {
  return [...payments].sort((a, b) => {
    if (a.type === "pending" && b.type !== "pending") return -1;
    if (a.type !== "pending" && b.type === "pending") return 1;
    if (a.type === "pending") return Number(b.timestamp - a.timestamp);
    if (a.block_height !== b.block_height) {
      return Number(b.block_height - a.block_height);
    }
    return Number(b.timestamp - a.timestamp);
  });
}

function invokeMethod(target: object, method: string, args: unknown[]) {
  const candidate = (target as Record<string, unknown>)[method];
  if (typeof candidate !== "function") {
    throw new Error(`Unknown method: ${method}`);
  }
  return (candidate as (...methodArgs: unknown[]) => unknown)(...args);
}

function unwrapHandleArg(method: string, arg: unknown): unknown {
  if (!arg || typeof arg !== "object" || !("__workerHandle" in arg)) {
    return arg;
  }
  const ref = arg as WorkerHandleRef;
  if (
    method === "get_transfers_info" ||
    method === "transfer_commit_tx" ||
    method === "save_multisig_tx_pending_tx"
  ) {
    return getHandle(ref, "pendingTx");
  }
  if (
    method === "get_multisig_tx_set_info" ||
    method === "get_multisig_tx_signers_count" ||
    method === "sign_multisig_tx" ||
    method === "save_multisig_tx" ||
    method === "transfer_commit_tx_multisig"
  ) {
    return getHandle(ref, "multisigTxSet");
  }
  return arg;
}

function wrapHandleResult(method: string, result: unknown, walletId: number) {
  if (method === "transfer_prepare" || method === "transfer_prepare_sweep_all") {
    return storeHandle(result as SyncPendingTxHandle, "pendingTx", walletId);
  }
  if (method === "load_multisig_tx") {
    return storeHandle(result as SyncMultisigTxSetHandle, "multisigTxSet", walletId);
  }
  return result;
}

const api = {
  async initModule() {
    await runExclusive(() => syncApi.initModule());
  },

  async moduleCall(method: string, args: unknown[]) {
    return runExclusive(async () => invokeMethod(syncApi, method, args));
  },

  setHttpBaseUrl(baseUrl: string) {
    return runExclusive(() => {
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
    return runExclusive(() => {
      onFetchCallback = callback;
    });
  },

  async createWallet(networkType: NetworkType = syncApi.NetworkTypes.MAINNET) {
    return runExclusive(async () => {
      await syncApi.initModule();
      const wallet = syncApi.createWallet(networkType);
      const id = nextWalletId++;
      wallets.set(id, wallet);
      return id;
    });
  },

  async deleteWallet(walletId: number) {
    return runExclusive(() => {
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
    return runExclusive(async () => {
      const wallet = getWallet(walletId);
      const normalizedArgs = args.map((arg) => unwrapHandleArg(method, arg));
      const result = await invokeMethod(wallet, method, normalizedArgs);
      if (method === "refresh") {
        flushNewBlockCallbacks(walletId);
      }
      if (method === "get_wallet_addresses") {
        return sortWalletAddresses(result as WalletAddress[]);
      }
      if (method === "get_payments" || method === "get_payments_mempool") {
        return sortPayments(result as PaymentDetails[]);
      }
      return wrapHandleResult(method, result, walletId);
    });
  },

  async walletSetNewBlockCallback(
    walletId: number,
    callback: ((height: bigint, timestamp: bigint) => void) | null,
  ) {
    return runExclusive(() => {
      if (callback) {
        newBlockCallbacks.set(walletId, callback);
      } else {
        newBlockCallbacks.delete(walletId);
      }
      getWallet(walletId).set_on_new_block_callback(null);
    });
  },

  async deleteHandle(handle: WorkerHandleRef) {
    return runExclusive(() => {
      deleteHandle(handle);
    });
  },
};

export type MoneroWasmWalletWorkerApi = typeof api;

expose(api);
