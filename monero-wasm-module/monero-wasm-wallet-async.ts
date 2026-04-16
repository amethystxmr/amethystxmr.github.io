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
} from "./monero-wasm-wallet";
import type {
  MoneroWasmWalletWorkerApi,
  WorkerHandleRef,
} from "./monero-wasm-wallet.worker";

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
  // Keep the internal queue tail always fulfilled: callers await `run` and still
  // see rejections there, but we must not leave `operationChain` rejected or later
  // serial scheduling can inherit a broken chain / unhandled tail rejections.
  operationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function moduleCall<T>(method: string, args: unknown[]): Promise<T> {
  return enqueue(() => api.moduleCall(method, args)) as Promise<T>;
}

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
  return new WorkerHandle(ref, (handleRef) =>
    api.deleteHandle(handleRef),
  ) as T extends "pendingTx" ? PendingTxHandle : MultisigTxSetHandle;
}

export async function initModule() {
  return enqueue(() => api.initModule());
}

export async function loadFilesystem() {
  return moduleCall<void>("loadFilesystem", []);
}

export async function saveFilesystem() {
  return moduleCall<void>("saveFilesystem", []);
}

export async function listWalletNames() {
  return moduleCall<string[]>("listWalletNames", []);
}

export async function deleteWalletFiles(walletName: string) {
  return moduleCall<void>("deleteWalletFiles", [walletName]);
}

export async function readFile(path: string) {
  return moduleCall<Uint8Array>("readFile", [path]);
}

export async function writeFile(path: string, data: Uint8Array) {
  return moduleCall<void>("writeFile", [path, data]);
}

export async function unlinkFile(path: string) {
  return moduleCall<void>("unlinkFile", [path]);
}

export async function isWalletFileExists(walletName: string) {
  return moduleCall<boolean>("isWalletFileExists", [walletName]);
}

export async function renameWallet(oldName: string, newName: string) {
  return moduleCall<void>("renameWallet", [oldName, newName]);
}

export async function getWalletFilesData(walletName: string) {
  return moduleCall<{ name: string; data: Uint8Array }[]>("getWalletFilesData", [
    walletName,
  ]);
}

export async function saveWalletFilesData(
  walletName: string,
  keysFileData: Uint8Array,
  otherFilesData: { name: string; data: Uint8Array }[],
) {
  return moduleCall<void>("saveWalletFilesData", [
    walletName,
    keysFileData,
    otherFilesData,
  ]);
}

export async function decodePolyseed(moneroPolyseed: string) {
  return moduleCall<{
    birthday: bigint;
    privateKey: Uint8Array;
    langStr: string;
  }>("decodePolyseed", [moneroPolyseed]);
}

export async function getMoneroVersionFull() {
  return moduleCall<string>("getMoneroVersionFull", []);
}

export async function setHttpBaseUrl(baseUrl: string): Promise<void> {
  await enqueue(() => api.setHttpBaseUrl(baseUrl));
}

export function setHttpOnFetch(
  callback:
    | ((
        url: string,
        reqId: string,
        state: HttpFetchState,
        progressLoaded: number,
        progressTotal: number,
      ) => void)
    | null,
): void {
  void enqueue(() => api.setHttpOnFetch(callback ? proxy(callback) : null));
}

function toRemoteArg(value: unknown): unknown {
  if (value instanceof WorkerHandle) {
    return value.ref;
  }
  return value;
}

function toRemoteArgs(args: unknown[]) {
  return args.map((arg) => toRemoteArg(arg));
}

function createAsyncMoneroWasmWallet(walletIdPromise: Promise<number>): MoneroWasmWallet {
  const walletId = () => walletIdPromise;

  function walletCall<T>(method: string, args: unknown[]): Promise<T> {
    return enqueue(async () =>
      api.walletCall(await walletId(), method, toRemoteArgs(args)),
    ) as Promise<T>;
  }

  return new Proxy({} as MoneroWasmWallet, {
    get(_target, prop): unknown {
      if (prop === "delete") {
        return async (): Promise<void> => {
          await enqueue(async () => api.deleteWallet(await walletId()));
        };
      }
      if (prop === "set_on_new_block_callback") {
        return async (
          callback: ((height: bigint, timestamp: bigint) => void) | null,
        ): Promise<void> => {
          await enqueue(async () =>
            api.walletSetNewBlockCallback(
              await walletId(),
              callback ? proxy(callback) : null,
            ),
          );
        };
      }
      if (typeof prop !== "string") {
        return undefined;
      }
      const method = prop;
      return (...args: unknown[]) => {
        const remoteArgs = toRemoteArgs(args);
        if (method === "transfer_prepare" || method === "transfer_prepare_sweep_all") {
          return walletCall<WorkerHandleRef & { type: "pendingTx" }>(method, remoteArgs).then(
            (ref) => makeHandle(ref),
          );
        }
        if (method === "load_multisig_tx") {
          return walletCall<WorkerHandleRef & { type: "multisigTxSet" }>(method, remoteArgs).then(
            (ref) => makeHandle(ref),
          );
        }
        return walletCall(method, remoteArgs);
      };
    },
  }) as MoneroWasmWallet;
}

export function createWallet(
  networkType: NetworkType = NetworkTypes.MAINNET,
): MoneroWasmWallet {
  return createAsyncMoneroWasmWallet(enqueue(() => api.createWallet(networkType)));
}
