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

export type WorkerHandleRef = {
  __workerHandle: true;
  type: "pendingTx" | "multisigTxSet";
  id: string;
};

function isWorkerHandleRef(value: unknown): value is WorkerHandleRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "__workerHandle" in value &&
    (value as WorkerHandleRef).__workerHandle === true
  );
}

const PENDING_TX_ARG_METHODS = new Set([
  "get_transfers_info",
  "transfer_commit_tx",
  "save_multisig_tx_pending_tx",
]);
const MULTISIG_TX_SET_ARG_METHODS = new Set([
  "get_multisig_tx_set_info",
  "get_multisig_tx_signers_count",
  "sign_multisig_tx",
  "save_multisig_tx",
  "transfer_commit_tx_multisig",
]);
const RETURNS_PENDING_TX_HANDLE = new Set([
  "transfer_prepare",
  "transfer_prepare_sweep_all",
]);
const RETURNS_MULTISIG_TX_SET_HANDLE = new Set(["load_multisig_tx"]);

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

function enqueue<T>(task: () => T | Promise<T>): Promise<T> {
  const run = operationChain.then(task, task);
  operationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

class Api {
  private wallet: SyncWallet | null = null;
  private pendingTxHandles = new Map<string, SyncPendingTxHandle>();
  private multisigTxSetHandles = new Map<string, SyncMultisigTxSetHandle>();
  private newBlockCallback: ((height: bigint, timestamp: bigint) => void) | null =
    null;

  /** Dynamic wallet object: method names are resolved at call time. */
  public readonly walletApi = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop !== "string") {
          return undefined;
        }
        const method = prop;
        return (...args: unknown[]) => this.walletCall(method, args);
      },
    },
  ) as unknown as Record<string, (...args: unknown[]) => unknown>;

  async initModule(): Promise<void> {
    await enqueue(() => syncApi.initModule());
  }

  async moduleCall(method: string, args: unknown[]): Promise<unknown> {
    return enqueue(async () => invokeMethod(syncApi, method, args));
  }

  async setHttpBaseUrl(baseUrl: string): Promise<void> {
    await enqueue(() => {
      httpBaseUrl = baseUrl;
    });
  }

  async setHttpOnFetch(
    callback:
      | ((
          url: string,
          reqId: string,
          state: HttpFetchState,
          progressLoaded: number,
          progressTotal: number,
        ) => void)
      | null,
  ): Promise<void> {
    await enqueue(() => {
      onFetchCallback = callback;
    });
  }

  async createWallet(
    networkType: NetworkType = syncApi.NetworkTypes.MAINNET,
  ): Promise<void> {
    await enqueue(async () => {
      if (this.wallet) {
        throw new Error("Wallet already exists in worker");
      }
      await syncApi.initModule();
      this.wallet = syncApi.createWallet(networkType);
    });
  }

  async closeWallet(): Promise<void> {
    await enqueue(() => {
      if (!this.wallet) {
        return;
      }
      try {
        this.wallet.close_wallet();
      } catch {
        // ignore
      }
      try {
        this.wallet.delete();
      } catch {
        // ignore
      }
      this.wallet = null;
      this.newBlockCallback = null;
      for (const h of this.pendingTxHandles.values()) {
        try {
          h.delete();
        } catch {
          // ignore
        }
      }
      for (const h of this.multisigTxSetHandles.values()) {
        try {
          h.delete();
        } catch {
          // ignore
        }
      }
      this.pendingTxHandles.clear();
      this.multisigTxSetHandles.clear();
    });
  }

  async set_on_new_block_callback(
    callback: ((height: bigint, timestamp: bigint) => void) | null,
  ): Promise<void> {
    await enqueue(() => {
      this.newBlockCallback = callback;
      // We use drain_new_block_events after refresh to deliver blocks in batches.
      this.wallet?.set_on_new_block_callback(null);
    });
  }

  private normalizeWalletArgs(method: string, args: unknown[]): unknown[] {
    return args.map((arg) => {
      if (!isWorkerHandleRef(arg)) {
        return arg;
      }
      if (PENDING_TX_ARG_METHODS.has(method)) {
        const h = this.pendingTxHandles.get(arg.id);
        if (!h) throw new Error(`Unknown pendingTx handle ${arg.id}`);
        return h;
      }
      if (MULTISIG_TX_SET_ARG_METHODS.has(method)) {
        const h = this.multisigTxSetHandles.get(arg.id);
        if (!h) throw new Error(`Unknown multisigTxSet handle ${arg.id}`);
        return h;
      }
      return arg;
    });
  }

  private wrapWalletResult(method: string, result: unknown): unknown {
    if (RETURNS_PENDING_TX_HANDLE.has(method)) {
      const id = `ptx_${Math.random().toString(16).slice(2)}`;
      this.pendingTxHandles.set(id, result as SyncPendingTxHandle);
      return { __workerHandle: true, type: "pendingTx", id } satisfies WorkerHandleRef;
    }
    if (RETURNS_MULTISIG_TX_SET_HANDLE.has(method)) {
      const id = `msig_${Math.random().toString(16).slice(2)}`;
      this.multisigTxSetHandles.set(id, result as SyncMultisigTxSetHandle);
      return { __workerHandle: true, type: "multisigTxSet", id } satisfies WorkerHandleRef;
    }
    if (method === "get_wallet_addresses") {
      return sortWalletAddresses(result as WalletAddress[]);
    }
    if (method === "get_payments" || method === "get_payments_mempool") {
      return sortPayments(result as PaymentDetails[]);
    }
    return result;
  }

  async walletCall(method: string, args: unknown[]): Promise<unknown> {
    return enqueue(async () => {
      if (!this.wallet) {
        throw new Error("Wallet is not created");
      }
      const normalized = this.normalizeWalletArgs(method, args);
      const result = await invokeMethod(this.wallet, method, normalized);
      if (method === "refresh" && this.newBlockCallback) {
        const events = this.wallet.drain_new_block_events();
        for (const event of events) {
          void this.newBlockCallback(event.height, event.timestamp);
        }
      }
      return this.wrapWalletResult(method, result);
    });
  }
}

export type MoneroWasmWalletWorkerApi = Api;

expose(new Api());
