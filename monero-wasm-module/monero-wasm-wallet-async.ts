import { proxy, wrap, type Remote } from "comlink";
import WorkerUrl from "./monero-wasm-wallet.worker?worker";
import {
  CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE,
  FeePriority as FeePriorityValues,
  max64,
  NetworkTypes,
  type FeePriority as FeePriorityValue,
  type GlobalHttpConfig,
  type HttpFetchState,
  type KeyImagesImportResult,
  type MultisigAccountStatus,
  type NetworkType,
  type PaymentDetailsTransformed,
  type TransferInfoItem,
  type TransferItem,
  type WalletAddress,
  type WalletKeys,
} from "./monero-wasm-wallet.ts";
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

const worker = new WorkerUrl();
const api = wrap<MoneroWasmWalletWorkerApi>(worker);

type Api = Remote<MoneroWasmWalletWorkerApi>;

function getApi(): Api {
  return api;
}

type HandleType = WorkerHandleRef["type"];

class WorkerHandle {
  constructor(
    readonly ref: WorkerHandleRef,
    private readonly deleteRemote: (ref: WorkerHandleRef) => Promise<void>,
  ) {}

  delete(): void {
    void this.deleteRemote(this.ref);
  }
}

export interface PendingTxHandle extends WorkerHandle {
  readonly ref: WorkerHandleRef & { type: "pendingTx" };
}

export interface MultisigTxSetHandle extends WorkerHandle {
  readonly ref: WorkerHandleRef & { type: "multisigTxSet" };
}

function makeHandle<T extends HandleType>(
  ref: WorkerHandleRef & { type: T },
): T extends "pendingTx" ? PendingTxHandle : MultisigTxSetHandle {
  return new WorkerHandle(ref, (handleRef) =>
    getApi().deleteHandle(handleRef),
  ) as T extends "pendingTx" ? PendingTxHandle : MultisigTxSetHandle;
}

export async function initModule() {
  return getApi().initModule();
}

export async function loadFilesystem() {
  return getApi().loadFilesystem();
}

export async function saveFilesystem() {
  return getApi().saveFilesystem();
}

export async function listWalletNames() {
  return getApi().listWalletNames();
}

export async function deleteWalletFiles(walletName: string) {
  return getApi().deleteWalletFiles(walletName);
}

export async function readFile(path: string) {
  return getApi().readFile(path);
}

export async function writeFile(path: string, data: Uint8Array) {
  return getApi().writeFile(path, data);
}

export async function unlinkFile(path: string) {
  return getApi().unlinkFile(path);
}

export async function isWalletFileExists(walletName: string) {
  return getApi().isWalletFileExists(walletName);
}

export async function renameWallet(oldName: string, newName: string) {
  return getApi().renameWallet(oldName, newName);
}

export async function getWalletFilesData(walletName: string) {
  return getApi().getWalletFilesData(walletName);
}

export async function saveWalletFilesData(
  walletName: string,
  keysFileData: Uint8Array,
  otherFilesData: { name: string; data: Uint8Array }[],
) {
  return getApi().saveWalletFilesData(walletName, keysFileData, otherFilesData);
}

export function getMaxConcurrency() {
  return 1;
}

export function getRecommendedMaxConcurrency() {
  return 1;
}

export async function setMaxConcurrency(threads: number) {
  return getApi().setMaxConcurrency(threads);
}

export async function decodePolyseed(moneroPolyseed: string) {
  return getApi().decodePolyseed(moneroPolyseed);
}

export async function getMoneroVersionFull() {
  return getApi().getMoneroVersionFull();
}

export async function setHttpBaseUrl(baseUrl: string) {
  return getApi().setHttpBaseUrl(baseUrl);
}

export async function setHttpOnFetch(
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
  return getApi().setHttpOnFetch(callback ? proxy(callback) : null);
}

export function createWallet(
  networkType: NetworkType = NetworkTypes.MAINNET,
) {
  return new MoneroWasmWallet(getApi().createWallet(networkType));
}

export class MoneroWasmWallet {
  constructor(private readonly walletIdPromise: Promise<number>) {}

  private async id() {
    return this.walletIdPromise;
  }

  private async call(method: string, ...args: unknown[]) {
    const walletId = await this.id();
    return (getApi() as unknown as Record<string, (...args: unknown[]) => unknown>)[
      method
    ](walletId, ...args);
  }

  async init() {
    return this.call("init") as Promise<boolean>;
  }

  async close_wallet() {
    return this.call("close_wallet") as Promise<void>;
  }

  async delete() {
    return getApi().deleteWallet(await this.id());
  }

  async get_daemon_blockchain_height() {
    return this.call("get_daemon_blockchain_height") as Promise<bigint>;
  }

  async generate(
    fileName: string,
    password: string,
    secret32: Uint8Array,
    recover: boolean,
    twoRandom: boolean,
  ) {
    return this.call(
      "generate",
      fileName,
      password,
      secret32,
      recover,
      twoRandom,
    ) as Promise<Uint8Array>;
  }

  async generate_multisig_restore(
    fileName: string,
    password: string,
    multisigDataHex: string,
    createAddressFile: boolean,
  ) {
    return this.call(
      "generate_multisig_restore",
      fileName,
      password,
      multisigDataHex,
      createAddressFile,
    ) as Promise<boolean>;
  }

  async generate_from_keys(
    fileName: string,
    password: string,
    address: string,
    secretViewKey: Uint8Array,
    secretSpendKey: Uint8Array,
    createAddressFile: boolean,
  ) {
    return this.call(
      "generate_from_keys",
      fileName,
      password,
      address,
      secretViewKey,
      secretSpendKey,
      createAddressFile,
    ) as Promise<boolean>;
  }

  async generate_view_only_from_keys(
    fileName: string,
    password: string,
    address: string,
    secretViewKey: Uint8Array,
    createAddressFile: boolean,
  ) {
    return this.call(
      "generate_view_only_from_keys",
      fileName,
      password,
      address,
      secretViewKey,
      createAddressFile,
    ) as Promise<boolean>;
  }

  async is_synced() {
    return this.call("is_synced") as Promise<boolean>;
  }

  async store() {
    return this.call("store") as Promise<void>;
  }

  async set_attribute(key: string, value: string) {
    return this.call("set_attribute", key, value) as Promise<boolean>;
  }

  async get_attribute(key: string) {
    return this.call("get_attribute", key) as Promise<string>;
  }

  async load(fileName: string, password: string) {
    return this.call("load", fileName, password) as Promise<void>;
  }

  async refresh(
    isTrustedWallet: boolean,
    startHeight: bigint,
    checkPool: boolean,
    tryIncremental: boolean,
    maxBlocks: bigint,
  ) {
    return this.call(
      "refresh",
      isTrustedWallet,
      startHeight,
      checkPool,
      tryIncremental,
      maxBlocks,
    ) as Promise<{ blocksFetched: bigint; receivedMoney: boolean }>;
  }

  async rewrite(fileName: string, password: string) {
    return this.call("rewrite", fileName, password) as Promise<void>;
  }

  async set_on_new_block_callback(
    callback: ((height: bigint, timestamp: bigint) => void) | null,
  ) {
    return this.call(
      "set_on_new_block_callback",
      callback ? proxy(callback) : null,
    ) as Promise<void>;
  }

  async get_seed(seedLanguage: string, seedPassword: string) {
    return this.call("get_seed", seedLanguage, seedPassword) as Promise<string>;
  }

  async get_multisig_seed(seedPassword: string) {
    return this.call("get_multisig_seed", seedPassword) as Promise<string>;
  }

  async get_address() {
    return this.call("get_address") as Promise<string>;
  }

  async get_network_type() {
    return this.call("get_network_type") as Promise<NetworkType>;
  }

  async allow_mismatched_daemon_version(allowMismatch: boolean) {
    return this.call(
      "allow_mismatched_daemon_version",
      allowMismatch,
    ) as Promise<void>;
  }

  async watch_only() {
    return this.call("watch_only") as Promise<boolean>;
  }

  async is_deterministic() {
    return this.call("is_deterministic") as Promise<boolean>;
  }

  async get_wallet_file() {
    return this.call("get_wallet_file") as Promise<string>;
  }

  async get_tx_proof(txid: string, dstaddress: string, note: string) {
    return this.call("get_tx_proof", txid, dstaddress, note) as Promise<string>;
  }

  async get_tx_key(txid: string) {
    return this.call("get_tx_key", txid) as Promise<string>;
  }

  async get_tx_keys_for_address(txid: string, dstaddress: string) {
    return this.call(
      "get_tx_keys_for_address",
      txid,
      dstaddress,
    ) as Promise<string[]>;
  }

  async balance(indexMajor: number, strict: boolean) {
    return this.call("balance", indexMajor, strict) as Promise<bigint>;
  }

  async unlocked_balance(indexMajor: number, strict: boolean) {
    return this.call("unlocked_balance", indexMajor, strict) as Promise<{
      balance: bigint;
      blocks_to_unlock: bigint;
      time_to_unlock: bigint;
    }>;
  }

  async set_refresh_from_block_height(height: bigint) {
    return this.call("set_refresh_from_block_height", height) as Promise<boolean>;
  }

  async set_explicit_refresh_from_block_height(value: boolean) {
    return this.call(
      "set_explicit_refresh_from_block_height",
      value,
    ) as Promise<boolean>;
  }

  async get_blockchain_current_height() {
    return this.call("get_blockchain_current_height") as Promise<bigint>;
  }

  async get_blockchain_height_by_date(year: number, month: number, day: number) {
    return this.call(
      "get_blockchain_height_by_date",
      year,
      month,
      day,
    ) as Promise<bigint>;
  }

  async words_to_bytes(words: string, language: string) {
    return this.call("words_to_bytes", words, language) as Promise<Uint8Array | null>;
  }

  async get_payments(minHeight: bigint, maxHeight: bigint) {
    return this.call(
      "get_payments",
      minHeight,
      maxHeight,
    ) as Promise<PaymentDetailsTransformed[]>;
  }

  async get_payments_mempool() {
    return this.call("get_payments_mempool") as Promise<
      PaymentDetailsTransformed[]
    >;
  }

  async get_num_subaddresses(indexMajor: number) {
    return this.call("get_num_subaddresses", indexMajor) as Promise<number>;
  }

  async get_subaddress_as_str(indexMajor: number, indexMinor: number) {
    return this.call(
      "get_subaddress_as_str",
      indexMajor,
      indexMinor,
    ) as Promise<string>;
  }

  async get_subaddress_label(indexMajor: number, indexMinor: number) {
    return this.call(
      "get_subaddress_label",
      indexMajor,
      indexMinor,
    ) as Promise<string>;
  }

  async get_wallet_addresses(accountId: number) {
    return this.call("get_wallet_addresses", accountId) as Promise<WalletAddress[]>;
  }

  async get_keys(accountIdx: number) {
    return this.call("get_keys", accountIdx) as Promise<WalletKeys>;
  }

  async add_subaddress(indexMajor: number, label: string) {
    return this.call("add_subaddress", indexMajor, label) as Promise<void>;
  }

  async transfer_prepare(
    destinations: string[],
    amounts: bigint[],
    priority: FeePriorityValue,
    subtractFeeFromIndex: number | null,
  ) {
    const ref = (await this.call(
      "transfer_prepare",
      destinations,
      amounts,
      priority,
      subtractFeeFromIndex,
    )) as WorkerHandleRef & { type: "pendingTx" };
    return makeHandle(ref);
  }

  async transfer_prepare_sweep_all(
    destination: string,
    priority: FeePriorityValue,
  ) {
    const ref = (await this.call(
      "transfer_prepare_sweep_all",
      destination,
      priority,
    )) as WorkerHandleRef & { type: "pendingTx" };
    return makeHandle(ref);
  }

  async get_transfers() {
    return this.call("get_transfers") as Promise<TransferItem[]>;
  }

  async get_transfers_info(handle: PendingTxHandle) {
    return this.call(
      "get_transfers_info",
      handle.ref,
    ) as Promise<TransferInfoItem[]>;
  }

  async transfer_commit_tx(handle: PendingTxHandle) {
    return this.call("transfer_commit_tx", handle.ref) as Promise<void>;
  }

  async save_multisig_tx_pending_tx(handle: PendingTxHandle) {
    return this.call(
      "save_multisig_tx_pending_tx",
      handle.ref,
    ) as Promise<Uint8Array>;
  }

  async load_multisig_tx(data: Uint8Array, doAccept: boolean) {
    const ref = (await this.call(
      "load_multisig_tx",
      data,
      doAccept,
    )) as WorkerHandleRef & { type: "multisigTxSet" };
    return makeHandle(ref);
  }

  async get_multisig_tx_set_info(handle: MultisigTxSetHandle) {
    return this.call(
      "get_multisig_tx_set_info",
      handle.ref,
    ) as Promise<TransferInfoItem[]>;
  }

  async get_multisig_tx_signers_count(
    handle: MultisigTxSetHandle,
    excludeSelf: boolean,
  ) {
    return this.call(
      "get_multisig_tx_signers_count",
      handle.ref,
      excludeSelf,
    ) as Promise<number>;
  }

  async sign_multisig_tx(handle: MultisigTxSetHandle) {
    return this.call("sign_multisig_tx", handle.ref) as Promise<string[]>;
  }

  async save_multisig_tx(handle: MultisigTxSetHandle) {
    return this.call("save_multisig_tx", handle.ref) as Promise<Uint8Array>;
  }

  async transfer_commit_tx_multisig(handle: MultisigTxSetHandle) {
    return this.call(
      "transfer_commit_tx_multisig",
      handle.ref,
    ) as Promise<void>;
  }

  async get_multisig_status() {
    return this.call("get_multisig_status") as Promise<MultisigAccountStatus>;
  }

  async has_multisig_partial_key_images() {
    return this.call("has_multisig_partial_key_images") as Promise<boolean>;
  }

  async has_unknown_key_images() {
    return this.call("has_unknown_key_images") as Promise<boolean>;
  }

  async enable_multisig(enable: boolean) {
    return this.call("enable_multisig", enable) as Promise<boolean>;
  }

  async prepare_multisig() {
    return this.call("prepare_multisig") as Promise<string>;
  }

  async make_multisig(
    password: string,
    initialKexMsgs: string[],
    threshold: number,
  ) {
    return this.call(
      "make_multisig",
      password,
      initialKexMsgs,
      threshold,
    ) as Promise<string>;
  }

  async exchange_multisig_keys(password: string, kexMsgs: string[]) {
    return this.call(
      "exchange_multisig_keys",
      password,
      kexMsgs,
    ) as Promise<string>;
  }

  async export_multisig() {
    return this.call("export_multisig") as Promise<Uint8Array>;
  }

  async import_multisig(infos: Uint8Array[]) {
    return this.call("import_multisig", infos) as Promise<number>;
  }

  async export_key_images(filename: string, all: boolean) {
    return this.call("export_key_images", filename, all) as Promise<boolean>;
  }

  async import_key_images(
    filename: string,
    importWhenUntrustedDaemon: boolean,
  ) {
    return this.call(
      "import_key_images",
      filename,
      importWhenUntrustedDaemon,
    ) as Promise<KeyImagesImportResult>;
  }

  async verify_password(password: string) {
    return this.call("verify_password", password) as Promise<boolean>;
  }

  async rescan_blockchain(hard: boolean, keepKeyImages: boolean) {
    return this.call(
      "rescan_blockchain",
      hard,
      keepKeyImages,
    ) as Promise<boolean>;
  }
}
