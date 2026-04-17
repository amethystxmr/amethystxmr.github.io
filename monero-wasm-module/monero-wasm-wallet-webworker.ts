import { proxy, wrap } from "comlink";
import {
  CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE,
  FeePriority as FeePriorityValues,
  max64,
  NetworkTypes,
  type FeePriority as FeePriorityValue,
  type GlobalHttpConfig,
  type HttpFetchState,
  type KeyImagesImportResult,
  type MoneroWasmWallet as MoneroWasmWalletSync,
  type MultisigAccountStatus,
  type MultisigTxSetHandle as SyncMultisigTxSetHandle,
  type NetworkType,
  type PaymentDetailsTransformed,
  type PendingTxHandle as SyncPendingTxHandle,
  type TransferInfoItem,
  type TransferItem,
  type WalletAddress,
  type WalletKeys,
} from "./monero-wasm-wallet.ts";
import type { MoneroWasmWalletWorkerApi, WorkerHandleRef } from "./monero-wasm-wallet.worker";

export {
  CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE,
  max64,
  NetworkTypes,
};
export type {
  GlobalHttpConfig,
  HttpFetchState,
  KeyImagesImportResult,
  MultisigAccountStatus,
  NetworkType,
  PaymentDetailsTransformed,
  TransferInfoItem,
  TransferItem,
  WalletAddress,
  WalletKeys,
};
export const FeePriority = FeePriorityValues;
export type FeePriority = FeePriorityValue;

const worker = new Worker(
  new URL("./monero-wasm-wallet.worker.ts", import.meta.url),
  { type: "module" },
);
const api = wrap<MoneroWasmWalletWorkerApi>(worker);

let operationChain = Promise.resolve();

/** Serialize every Comlink RPC to the wallet worker (matches `enqueue` in
 * `monero-wasm-wallet.worker.ts`, which serializes sync WASM on the worker). */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = operationChain.then(task, task);
  operationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function moduleCall<T>(method: string, args: unknown[]): Promise<T> {
  return enqueue(() => api.moduleCall(method, args)) as Promise<T>;
}

type SyncExport = typeof import("./monero-wasm-wallet.ts");

type PromisifyFn<F> = F extends (...args: infer A) => infer R
  ? (...args: A) => Promise<Awaited<R>>
  : never;

type KeysOfSyncFunctions = {
  [K in keyof SyncExport]: SyncExport[K] extends (...args: never[]) => unknown
    ? K
    : never;
}[keyof SyncExport];

/** Every sync module function except the three handled below is forwarded via
 * `moduleCall` — new exports on `monero-wasm-wallet.ts` pick up automatically. */
type AutoForwardedWasm = {
  [K in KeysOfSyncFunctions as K extends
    | "createWallet"
    | "setHttpBaseUrl"
    | "setHttpOnFetch"
    ? never
    : K]: PromisifyFn<SyncExport[K]>;
};

export type WasmModule = AutoForwardedWasm & {
  createWallet: (networkType?: NetworkType) => MoneroWasmWallet;
  setHttpBaseUrl: (baseUrl: string) => Promise<void>;
  setHttpOnFetch: (
    callback:
      | ((
          url: string,
          reqId: string,
          state: HttpFetchState,
          progressLoaded: number,
          progressTotal: number,
        ) => void)
      | null,
  ) => void;
};

type HandleType = WorkerHandleRef["type"];

class WorkerHandle {
  constructor(
    readonly ref: WorkerHandleRef,
    private readonly deleteRemote: (ref: WorkerHandleRef) => Promise<void>,
  ) {}

  delete(): void {
    void enqueue(() => this.deleteRemote(this.ref));
  }
}

export interface PendingTxHandle extends WorkerHandle {
  readonly ref: WorkerHandleRef & { type: "pendingTx" };
}

export interface MultisigTxSetHandle extends WorkerHandle {
  readonly ref: WorkerHandleRef & { type: "multisigTxSet" };
}

type ToAsyncHandles<T> = T extends SyncPendingTxHandle
  ? PendingTxHandle
  : T extends SyncMultisigTxSetHandle
    ? MultisigTxSetHandle
    : T;

type MapWalletArgs<A extends readonly unknown[]> = {
  [I in keyof A]: ToAsyncHandles<A[I]>;
};

type PromisifyWalletMethod<F> = F extends (...args: infer A) => infer R
  ? A extends readonly unknown[]
    ? (...args: MapWalletArgs<A>) => Promise<ToAsyncHandles<Awaited<R>>>
    : never
  : never;

/** Async wallet: sync `MoneroWasmWallet` API, promisified; Comlink handles replace sync class handles. */
export type MoneroWasmWallet = {
  [K in keyof MoneroWasmWalletSync as MoneroWasmWalletSync[K] extends (
    ...args: never[]
  ) => unknown
    ? K extends "constructor"
      ? never
      : K
    : never]: MoneroWasmWalletSync[K] extends (...args: never[]) => unknown
    ? PromisifyWalletMethod<MoneroWasmWalletSync[K]>
    : never;
};

function makeHandle<T extends HandleType>(
  ref: WorkerHandleRef & { type: T },
): T extends "pendingTx" ? PendingTxHandle : MultisigTxSetHandle {
  return new WorkerHandle(ref, async (handleRef) => {
    void handleRef;
  }) as T extends "pendingTx" ? PendingTxHandle : MultisigTxSetHandle;
}

function createWalletImpl(
  networkType: NetworkType = NetworkTypes.MAINNET,
): MoneroWasmWallet {
  void enqueue(() => api.createWallet(networkType));
  const walletApi = (api as unknown as { walletApi: MoneroWasmWallet }).walletApi;
  return new Proxy(walletApi, {
    get(target, prop, receiver) {
      if (prop === "delete") {
        return async () => {
          await enqueue(() => api.closeWallet());
        };
      }
      if (prop === "set_on_new_block_callback") {
        return async (cb: ((height: bigint, timestamp: bigint) => void) | null) => {
          await enqueue(() => api.set_on_new_block_callback(cb ? proxy(cb) : null));
        };
      }
      const value = Reflect.get(target as object, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) =>
        value(...args).then((out: unknown) => {
          const maybeRef = out as Partial<WorkerHandleRef>;
          if (
            maybeRef &&
            maybeRef.__workerHandle === true &&
            typeof maybeRef.type === "string" &&
            typeof maybeRef.id === "string"
          ) {
            return makeHandle(out as WorkerHandleRef & { type: HandleType });
          }
          return out;
        });
    },
  }) as MoneroWasmWallet;
}

function createWasmModuleProxy(): WasmModule {
  return new Proxy({} as WasmModule, {
    get(_target, prop) {
      if (prop === "createWallet") {
        return createWalletImpl;
      }
      if (prop === "setHttpBaseUrl") {
        return (baseUrl: string) => enqueue(() => api.setHttpBaseUrl(baseUrl));
      }
      if (prop === "setHttpOnFetch") {
        return (
          callback:
            | ((
                url: string,
                reqId: string,
                state: HttpFetchState,
                progressLoaded: number,
                progressTotal: number,
              ) => void)
            | null,
        ) => {
          void enqueue(() => api.setHttpOnFetch(callback ? proxy(callback) : null));
        };
      }
      if (typeof prop !== "string") {
        return undefined;
      }
      return (...args: unknown[]) => moduleCall(prop, args);
    },
  });
}

/** Promisified sync module API: new functions added to `monero-wasm-wallet.ts`
 * are callable here without listing them in this file. */
export const wasm: WasmModule = createWasmModuleProxy();

/** Convenience re-export — same as `wasm.createWallet`. */
export const createWallet = wasm.createWallet;
