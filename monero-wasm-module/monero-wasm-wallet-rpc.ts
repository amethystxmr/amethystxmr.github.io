/**
 * Worker ↔ sync WASM boundary: method tables and value transforms live here so
 * `monero-wasm-wallet.worker.ts` stays a thin executor (maps + enqueue + invoke).
 */
import type {
  MoneroWasmWallet,
  MultisigTxSetHandle as SyncMultisigTxSetHandle,
  PaymentDetails,
  PendingTxHandle as SyncPendingTxHandle,
  WalletAddress,
} from "./monero-wasm-wallet";

export type WorkerHandleRef = {
  __workerHandle: true;
  type: "pendingTx" | "multisigTxSet";
  id: number;
};

export function isWorkerHandleRef(value: unknown): value is WorkerHandleRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "__workerHandle" in value &&
    (value as WorkerHandleRef).__workerHandle === true
  );
}

/** Methods whose first (or only) handle argument is a pending-tx handle. */
const PENDING_TX_ARG_METHODS = new Set([
  "get_transfers_info",
  "transfer_commit_tx",
  "save_multisig_tx_pending_tx",
]);

/** Methods whose first handle argument is a multisig tx-set handle. */
const MULTISIG_TX_SET_ARG_METHODS = new Set([
  "get_multisig_tx_set_info",
  "get_multisig_tx_signers_count",
  "sign_multisig_tx",
  "save_multisig_tx",
  "transfer_commit_tx_multisig",
]);

const RETURNS_PENDING_TX_HANDLE = new Set(["transfer_prepare", "transfer_prepare_sweep_all"]);
const RETURNS_MULTISIG_TX_SET_HANDLE = new Set(["load_multisig_tx"]);

export type WalletHandleStore = {
  storePendingTx(walletId: number, handle: SyncPendingTxHandle): WorkerHandleRef;
  storeMultisigTx(walletId: number, handle: SyncMultisigTxSetHandle): WorkerHandleRef;
  getPendingTx(ref: WorkerHandleRef): SyncPendingTxHandle;
  getMultisigTx(ref: WorkerHandleRef): SyncMultisigTxSetHandle;
};

export function normalizeWalletRpcArgs(
  method: string,
  args: unknown[],
  store: WalletHandleStore,
): unknown[] {
  return args.map((arg) => normalizeOneWalletRpcArg(method, arg, store));
}

function normalizeOneWalletRpcArg(
  method: string,
  arg: unknown,
  store: WalletHandleStore,
): unknown {
  if (!isWorkerHandleRef(arg)) {
    return arg;
  }
  if (PENDING_TX_ARG_METHODS.has(method)) {
    return store.getPendingTx(arg);
  }
  if (MULTISIG_TX_SET_ARG_METHODS.has(method)) {
    return store.getMultisigTx(arg);
  }
  return arg;
}

export function sortWalletAddresses(addresses: WalletAddress[]) {
  return [...addresses].sort((a, b) => a.indexMinor - b.indexMinor);
}

export function sortPayments(payments: PaymentDetails[]) {
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

export function transformWalletRpcResult(
  method: string,
  walletId: number,
  result: unknown,
  store: WalletHandleStore,
): unknown {
  if (RETURNS_PENDING_TX_HANDLE.has(method)) {
    return store.storePendingTx(walletId, result as SyncPendingTxHandle);
  }
  if (RETURNS_MULTISIG_TX_SET_HANDLE.has(method)) {
    return store.storeMultisigTx(walletId, result as SyncMultisigTxSetHandle);
  }
  if (method === "get_wallet_addresses") {
    return sortWalletAddresses(result as WalletAddress[]);
  }
  if (method === "get_payments" || method === "get_payments_mempool") {
    return sortPayments(result as PaymentDetails[]);
  }
  return result;
}

export type NewBlockEventsSink = (
  walletId: number,
  events: { height: bigint; timestamp: bigint }[],
) => void;

export function runWalletRpcPostCall(
  method: string,
  wallet: MoneroWasmWallet,
  walletId: number,
  sink: NewBlockEventsSink | undefined,
): void {
  if (method !== "refresh" || !sink) {
    return;
  }
  const events = wallet.drain_new_block_events();
  if (events.length > 0) {
    sink(walletId, events);
  }
}
