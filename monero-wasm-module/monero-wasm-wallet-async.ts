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

const worker = new Worker(
  new URL("./monero-wasm-wallet.worker.ts", import.meta.url),
  { type: "module" },
);
const api = wrap<MoneroWasmWalletWorkerApi>(worker);

let operationChain = Promise.resolve();

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

export function createWallet(
  networkType: NetworkType = NetworkTypes.MAINNET,
) {
  return new MoneroWasmWallet(enqueue(() => api.createWallet(networkType)));
}

export class MoneroWasmWallet {
  constructor(private readonly walletIdPromise: Promise<number>) {}

  private async id() {
    return this.walletIdPromise;
  }

  private call<T>(method: string, ...args: unknown[]) {
    return enqueue(async () =>
      api.walletCall(await this.id(), method, this.toRemoteArgs(args)),
    ) as Promise<T>;
  }

  private toRemoteArg(value: unknown): unknown {
    if (value instanceof WorkerHandle) {
      return value.ref;
    }
    return value;
  }

  private toRemoteArgs(args: unknown[]) {
    return args.map((arg) => this.toRemoteArg(arg));
  }

  async init() {
    return this.call<boolean>("init");
  }

  async close_wallet() {
    return this.call<void>("close_wallet");
  }

  async delete() {
    return enqueue(async () => api.deleteWallet(await this.id()));
  }

  async get_daemon_blockchain_height() {
    return this.call<bigint>("get_daemon_blockchain_height");
  }

  async generate(
    fileName: string,
    password: string,
    secret32: Uint8Array,
    recover: boolean,
    twoRandom: boolean,
  ) {
    return this.call<Uint8Array>(
      "generate",
      fileName,
      password,
      secret32,
      recover,
      twoRandom,
    );
  }

  async generate_multisig_restore(
    fileName: string,
    password: string,
    multisigDataHex: string,
    createAddressFile: boolean,
  ) {
    return this.call<boolean>(
      "generate_multisig_restore",
      fileName,
      password,
      multisigDataHex,
      createAddressFile,
    );
  }

  async generate_from_keys(
    fileName: string,
    password: string,
    address: string,
    secretViewKey: Uint8Array,
    secretSpendKey: Uint8Array,
    createAddressFile: boolean,
  ) {
    return this.call<boolean>(
      "generate_from_keys",
      fileName,
      password,
      address,
      secretViewKey,
      secretSpendKey,
      createAddressFile,
    );
  }

  async generate_view_only_from_keys(
    fileName: string,
    password: string,
    address: string,
    secretViewKey: Uint8Array,
    createAddressFile: boolean,
  ) {
    return this.call<boolean>(
      "generate_view_only_from_keys",
      fileName,
      password,
      address,
      secretViewKey,
      createAddressFile,
    );
  }

  async is_synced() {
    return this.call<boolean>("is_synced");
  }

  async store() {
    return this.call<void>("store");
  }

  async set_attribute(key: string, value: string) {
    return this.call<boolean>("set_attribute", key, value);
  }

  async get_attribute(key: string) {
    return this.call<string>("get_attribute", key);
  }

  async load(fileName: string, password: string) {
    return this.call<void>("load", fileName, password);
  }

  async refresh(
    isTrustedWallet: boolean,
    startHeight: bigint,
    checkPool: boolean,
    tryIncremental: boolean,
    maxBlocks: bigint,
  ) {
    return this.call<{ blocksFetched: bigint; receivedMoney: boolean }>(
      "refresh",
      isTrustedWallet,
      startHeight,
      checkPool,
      tryIncremental,
      maxBlocks,
    );
  }

  async rewrite(fileName: string, password: string) {
    return this.call<void>("rewrite", fileName, password);
  }

  async set_on_new_block_callback(
    callback: ((height: bigint, timestamp: bigint) => void) | null,
  ): Promise<void> {
    return enqueue(async () =>
      api.walletSetNewBlockCallback(
        await this.id(),
        callback ? proxy(callback) : null,
      ),
    );
  }

  async get_seed(seedLanguage: string, seedPassword: string) {
    return this.call<string>("get_seed", seedLanguage, seedPassword);
  }

  async get_multisig_seed(seedPassword: string) {
    return this.call<string>("get_multisig_seed", seedPassword);
  }

  async get_address() {
    return this.call<string>("get_address");
  }

  get_network_type() {
    return this.call<NetworkType>("get_network_type");
  }

  async allow_mismatched_daemon_version(allowMismatch: boolean) {
    return this.call<void>("allow_mismatched_daemon_version", allowMismatch);
  }

  async watch_only() {
    return this.call<boolean>("watch_only");
  }

  async is_deterministic() {
    return this.call<boolean>("is_deterministic");
  }

  async get_wallet_file() {
    return this.call<string>("get_wallet_file");
  }

  async get_tx_proof(txid: string, dstaddress: string, note: string) {
    return this.call<string>("get_tx_proof", txid, dstaddress, note);
  }

  async get_tx_key(txid: string) {
    return this.call<string>("get_tx_key", txid);
  }

  async get_tx_keys_for_address(txid: string, dstaddress: string) {
    return this.call<string[]>("get_tx_keys_for_address", txid, dstaddress);
  }

  async balance(indexMajor: number, strict: boolean) {
    return this.call<bigint>("balance", indexMajor, strict);
  }

  async unlocked_balance(indexMajor: number, strict: boolean) {
    return this.call<{
      balance: bigint;
      blocks_to_unlock: bigint;
      time_to_unlock: bigint;
    }>("unlocked_balance", indexMajor, strict);
  }

  async set_refresh_from_block_height(height: bigint) {
    return this.call<boolean>("set_refresh_from_block_height", height);
  }

  async set_explicit_refresh_from_block_height(value: boolean) {
    return this.call<boolean>("set_explicit_refresh_from_block_height", value);
  }

  async get_blockchain_current_height() {
    return this.call<bigint>("get_blockchain_current_height");
  }

  async get_blockchain_height_by_date(year: number, month: number, day: number) {
    return this.call<bigint>("get_blockchain_height_by_date", year, month, day);
  }

  async words_to_bytes(words: string, language: string) {
    return this.call<Uint8Array | null>("words_to_bytes", words, language);
  }

  async get_payments(minHeight: bigint, maxHeight: bigint) {
    return this.call<PaymentDetailsTransformed[]>("get_payments", minHeight, maxHeight);
  }

  async get_payments_mempool() {
    return this.call<PaymentDetailsTransformed[]>("get_payments_mempool");
  }

  async get_num_subaddresses(indexMajor: number) {
    return this.call<number>("get_num_subaddresses", indexMajor);
  }

  async get_subaddress_as_str(indexMajor: number, indexMinor: number) {
    return this.call<string>("get_subaddress_as_str", indexMajor, indexMinor);
  }

  async get_subaddress_label(indexMajor: number, indexMinor: number) {
    return this.call<string>("get_subaddress_label", indexMajor, indexMinor);
  }

  async get_wallet_addresses(accountId: number) {
    return this.call<WalletAddress[]>("get_wallet_addresses", accountId);
  }

  async get_keys(accountIdx: number) {
    return this.call<WalletKeys>("get_keys", accountIdx);
  }

  async add_subaddress(indexMajor: number, label: string) {
    return this.call<void>("add_subaddress", indexMajor, label);
  }

  async transfer_prepare(
    destinations: string[],
    amounts: bigint[],
    priority: FeePriorityValue,
    subtractFeeFromIndex: number | null,
  ) {
    const ref = await this.call<WorkerHandleRef & { type: "pendingTx" }>(
      "transfer_prepare",
      destinations,
      amounts,
      priority,
      subtractFeeFromIndex,
    );
    return makeHandle(ref);
  }

  async transfer_prepare_sweep_all(
    destination: string,
    priority: FeePriorityValue,
  ) {
    const ref = await this.call<WorkerHandleRef & { type: "pendingTx" }>(
      "transfer_prepare_sweep_all",
      destination,
      priority,
    );
    return makeHandle(ref);
  }

  async get_transfers() {
    return this.call<TransferItem[]>("get_transfers");
  }

  async get_transfers_info(handle: PendingTxHandle) {
    return this.call<TransferInfoItem[]>("get_transfers_info", handle);
  }

  async transfer_commit_tx(handle: PendingTxHandle) {
    return this.call<void>("transfer_commit_tx", handle);
  }

  async save_multisig_tx_pending_tx(handle: PendingTxHandle) {
    return this.call<Uint8Array>("save_multisig_tx_pending_tx", handle);
  }

  async load_multisig_tx(data: Uint8Array, doAccept: boolean) {
    const ref = await this.call<WorkerHandleRef & { type: "multisigTxSet" }>(
      "load_multisig_tx",
      data,
      doAccept,
    );
    return makeHandle(ref);
  }

  async get_multisig_tx_set_info(handle: MultisigTxSetHandle) {
    return this.call<TransferInfoItem[]>("get_multisig_tx_set_info", handle);
  }

  async get_multisig_tx_signers_count(
    handle: MultisigTxSetHandle,
    excludeSelf: boolean,
  ) {
    return this.call<number>("get_multisig_tx_signers_count", handle, excludeSelf);
  }

  async sign_multisig_tx(handle: MultisigTxSetHandle) {
    return this.call<string[]>("sign_multisig_tx", handle);
  }

  async save_multisig_tx(handle: MultisigTxSetHandle) {
    return this.call<Uint8Array>("save_multisig_tx", handle);
  }

  async transfer_commit_tx_multisig(handle: MultisigTxSetHandle) {
    return this.call<void>("transfer_commit_tx_multisig", handle);
  }

  async get_multisig_status() {
    return this.call<MultisigAccountStatus>("get_multisig_status");
  }

  async has_multisig_partial_key_images() {
    return this.call<boolean>("has_multisig_partial_key_images");
  }

  async has_unknown_key_images() {
    return this.call<boolean>("has_unknown_key_images");
  }

  async enable_multisig(enable: boolean) {
    return this.call<boolean>("enable_multisig", enable);
  }

  async prepare_multisig() {
    return this.call<string>("prepare_multisig");
  }

  async make_multisig(
    password: string,
    initialKexMsgs: string[],
    threshold: number,
  ) {
    return this.call<string>("make_multisig", password, initialKexMsgs, threshold);
  }

  async exchange_multisig_keys(password: string, kexMsgs: string[]) {
    return this.call<string>("exchange_multisig_keys", password, kexMsgs);
  }

  async export_multisig() {
    return this.call<Uint8Array>("export_multisig");
  }

  async import_multisig(infos: Uint8Array[]) {
    return this.call<number>("import_multisig", infos);
  }

  async export_key_images(filename: string, all: boolean) {
    return this.call<boolean>("export_key_images", filename, all);
  }

  async import_key_images(
    filename: string,
    importWhenUntrustedDaemon: boolean,
  ) {
    return this.call<KeyImagesImportResult>(
      "import_key_images",
      filename,
      importWhenUntrustedDaemon,
    );
  }

  async verify_password(password: string) {
    return this.call<boolean>("verify_password", password);
  }

  async rescan_blockchain(hard: boolean, keepKeyImages: boolean) {
    return this.call<boolean>("rescan_blockchain", hard, keepKeyImages);
  }
}
