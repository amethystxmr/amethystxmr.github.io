import { expose } from "comlink";
import {
  createWallet as createSyncWallet,
  decodePolyseed,
  deleteWalletFiles,
  getMoneroVersionFull,
  getRecommendedMaxConcurrency,
  getWalletFilesData,
  initModule,
  isWalletFileExists,
  listWalletNames,
  loadFilesystem,
  max64,
  NetworkTypes,
  readFile,
  renameWallet,
  saveFilesystem,
  saveWalletFilesData,
  setMaxConcurrency,
  unlinkFile,
  writeFile,
  type FeePriority,
  type GlobalHttpConfig,
  type HttpFetchState,
  type MoneroWasmWallet as SyncWallet,
  type MultisigTxSetHandle as SyncMultisigTxSetHandle,
  type NetworkType,
  type PaymentDetails,
  type PendingTxHandle as SyncPendingTxHandle,
  type WalletAddress,
} from "./monero-wasm-wallet.ts";

type StoredHandle =
  | { type: "pendingTx"; value: SyncPendingTxHandle }
  | { type: "multisigTxSet"; value: SyncMultisigTxSetHandle };

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

globalThis.globalHttpConfig = {
  mapUrl: (url: string) => `${httpBaseUrl}${url}`,
  onFetch: (...args) => {
    onFetchCallback?.(...args);
  },
} satisfies GlobalHttpConfig;

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
): WorkerHandleRef {
  const id = nextHandleId++;
  handles.set(id, { type, value: handle } as StoredHandle);
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

const api = {
  NetworkTypes,
  max64,
  async initModule() {
    await initModule();
  },
  loadFilesystem,
  saveFilesystem,
  listWalletNames,
  deleteWalletFiles,
  readFile,
  writeFile,
  unlinkFile,
  isWalletFileExists,
  renameWallet,
  getWalletFilesData,
  saveWalletFilesData,
  getRecommendedMaxConcurrency,
  setMaxConcurrency,
  decodePolyseed,
  getMoneroVersionFull,

  setHttpBaseUrl(baseUrl: string) {
    httpBaseUrl = baseUrl;
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
    onFetchCallback = callback;
  },

  async createWallet(networkType: NetworkType = NetworkTypes.MAINNET) {
    await initModule();
    const wallet = createSyncWallet(networkType);
    const id = nextWalletId++;
    wallets.set(id, wallet);
    return id;
  },

  async deleteWallet(walletId: number) {
    const wallet = getWallet(walletId);
    wallet.delete();
    wallets.delete(walletId);
    newBlockCallbacks.delete(walletId);
  },

  async init(walletId: number) {
    return getWallet(walletId).init();
  },

  async close_wallet(walletId: number) {
    return getWallet(walletId).close_wallet();
  },

  async get_daemon_blockchain_height(walletId: number) {
    return getWallet(walletId).get_daemon_blockchain_height();
  },

  async generate(
    walletId: number,
    fileName: string,
    password: string,
    secret32: Uint8Array,
    recover: boolean,
    twoRandom: boolean,
  ) {
    return getWallet(walletId).generate(
      fileName,
      password,
      secret32,
      recover,
      twoRandom,
    );
  },

  async generate_multisig_restore(
    walletId: number,
    fileName: string,
    password: string,
    multisigDataHex: string,
    createAddressFile: boolean,
  ) {
    return getWallet(walletId).generate_multisig_restore(
      fileName,
      password,
      multisigDataHex,
      createAddressFile,
    );
  },

  async generate_from_keys(
    walletId: number,
    fileName: string,
    password: string,
    address: string,
    secretViewKey: Uint8Array,
    secretSpendKey: Uint8Array,
    createAddressFile: boolean,
  ) {
    return getWallet(walletId).generate_from_keys(
      fileName,
      password,
      address,
      secretViewKey,
      secretSpendKey,
      createAddressFile,
    );
  },

  async generate_view_only_from_keys(
    walletId: number,
    fileName: string,
    password: string,
    address: string,
    secretViewKey: Uint8Array,
    createAddressFile: boolean,
  ) {
    return getWallet(walletId).generate_view_only_from_keys(
      fileName,
      password,
      address,
      secretViewKey,
      createAddressFile,
    );
  },

  async is_synced(walletId: number) {
    return getWallet(walletId).is_synced();
  },

  async store(walletId: number) {
    return getWallet(walletId).store();
  },

  async set_attribute(walletId: number, key: string, value: string) {
    return getWallet(walletId).set_attribute(key, value);
  },

  async get_attribute(walletId: number, key: string) {
    return getWallet(walletId).get_attribute(key);
  },

  async load(walletId: number, fileName: string, password: string) {
    return getWallet(walletId).load(fileName, password);
  },

  async refresh(
    walletId: number,
    isTrustedWallet: boolean,
    startHeight: bigint,
    checkPool: boolean,
    tryIncremental: boolean,
    maxBlocks: bigint,
  ) {
    const result = await getWallet(walletId).refresh(
      isTrustedWallet,
      Number(startHeight),
      checkPool,
      tryIncremental,
      Number(maxBlocks),
    );
    flushNewBlockCallbacks(walletId);
    return result;
  },

  async rewrite(walletId: number, fileName: string, password: string) {
    return getWallet(walletId).rewrite(fileName, password);
  },

  async set_on_new_block_callback(
    walletId: number,
    callback: ((height: bigint, timestamp: bigint) => void) | null,
  ) {
    if (callback) {
      newBlockCallbacks.set(walletId, callback);
    } else {
      newBlockCallbacks.delete(walletId);
    }
    getWallet(walletId).set_on_new_block_callback(null);
  },

  async get_seed(walletId: number, seedLanguage: string, seedPassword: string) {
    return getWallet(walletId).get_seed(seedLanguage, seedPassword);
  },

  async get_multisig_seed(walletId: number, seedPassword: string) {
    return getWallet(walletId).get_multisig_seed(seedPassword);
  },

  async get_address(walletId: number) {
    return getWallet(walletId).get_address();
  },

  async get_network_type(walletId: number) {
    return getWallet(walletId).get_network_type();
  },

  async allow_mismatched_daemon_version(
    walletId: number,
    allowMismatch: boolean,
  ) {
    getWallet(walletId).allow_mismatched_daemon_version(allowMismatch);
  },

  async watch_only(walletId: number) {
    return getWallet(walletId).watch_only();
  },

  async is_deterministic(walletId: number) {
    return getWallet(walletId).is_deterministic();
  },

  async get_wallet_file(walletId: number) {
    return getWallet(walletId).get_wallet_file();
  },

  async get_tx_proof(
    walletId: number,
    txid: string,
    dstaddress: string,
    note: string,
  ) {
    return getWallet(walletId).get_tx_proof(txid, dstaddress, note);
  },

  async get_tx_key(walletId: number, txid: string) {
    return getWallet(walletId).get_tx_key(txid);
  },

  async get_tx_keys_for_address(
    walletId: number,
    txid: string,
    dstaddress: string,
  ) {
    return getWallet(walletId).get_tx_keys_for_address(txid, dstaddress);
  },

  async balance(walletId: number, indexMajor: number, strict: boolean) {
    return getWallet(walletId).balance(indexMajor, strict);
  },

  async unlocked_balance(walletId: number, indexMajor: number, strict: boolean) {
    return getWallet(walletId).unlocked_balance(indexMajor, strict);
  },

  async set_refresh_from_block_height(walletId: number, height: bigint) {
    return getWallet(walletId).set_refresh_from_block_height(height);
  },

  async set_explicit_refresh_from_block_height(
    walletId: number,
    value: boolean,
  ) {
    return getWallet(walletId).set_explicit_refresh_from_block_height(value);
  },

  async get_blockchain_current_height(walletId: number) {
    return getWallet(walletId).get_blockchain_current_height();
  },

  async get_blockchain_height_by_date(
    walletId: number,
    year: number,
    month: number,
    day: number,
  ) {
    return getWallet(walletId).get_blockchain_height_by_date(year, month, day);
  },

  async words_to_bytes(walletId: number, words: string, language: string) {
    return getWallet(walletId).words_to_bytes(words, language);
  },

  async get_payments(walletId: number, minHeight: bigint, maxHeight: bigint) {
    return sortPayments(await getWallet(walletId).get_payments(minHeight, maxHeight));
  },

  async get_payments_mempool(walletId: number) {
    return sortPayments(await getWallet(walletId).get_payments_mempool());
  },

  async get_num_subaddresses(walletId: number, indexMajor: number) {
    return getWallet(walletId).get_num_subaddresses(indexMajor);
  },

  async get_subaddress_as_str(
    walletId: number,
    indexMajor: number,
    indexMinor: number,
  ) {
    return getWallet(walletId).get_subaddress_as_str(indexMajor, indexMinor);
  },

  async get_subaddress_label(
    walletId: number,
    indexMajor: number,
    indexMinor: number,
  ) {
    return getWallet(walletId).get_subaddress_label(indexMajor, indexMinor);
  },

  async get_wallet_addresses(walletId: number, accountId: number) {
    return sortWalletAddresses(await getWallet(walletId).get_wallet_addresses(accountId));
  },

  async get_keys(walletId: number, accountIdx: number) {
    return getWallet(walletId).get_keys(accountIdx);
  },

  async add_subaddress(walletId: number, indexMajor: number, label: string) {
    return getWallet(walletId).add_subaddress(indexMajor, label);
  },

  async transfer_prepare(
    walletId: number,
    destinations: string[],
    amounts: bigint[],
    priority: FeePriority,
    subtractFeeFromIndex: number | null,
  ) {
    const handle = await getWallet(walletId).transfer_prepare(
      destinations,
      amounts,
      priority,
      subtractFeeFromIndex,
    );
    return storeHandle(handle, "pendingTx");
  },

  async transfer_prepare_sweep_all(
    walletId: number,
    destination: string,
    priority: FeePriority,
  ) {
    const handle = await getWallet(walletId).transfer_prepare_sweep_all(
      destination,
      priority,
    );
    return storeHandle(handle, "pendingTx");
  },

  async get_transfers(walletId: number) {
    return getWallet(walletId).get_transfers();
  },

  async get_transfers_info(walletId: number, handle: WorkerHandleRef) {
    return getWallet(walletId).get_transfers_info(getHandle(handle, "pendingTx"));
  },

  async transfer_commit_tx(walletId: number, handle: WorkerHandleRef) {
    return getWallet(walletId).transfer_commit_tx(getHandle(handle, "pendingTx"));
  },

  async save_multisig_tx_pending_tx(walletId: number, handle: WorkerHandleRef) {
    return getWallet(walletId).save_multisig_tx_pending_tx(
      getHandle(handle, "pendingTx"),
    );
  },

  async load_multisig_tx(walletId: number, data: Uint8Array, doAccept: boolean) {
    const handle = await getWallet(walletId).load_multisig_tx(data, doAccept);
    return storeHandle(handle, "multisigTxSet");
  },

  async get_multisig_tx_set_info(walletId: number, handle: WorkerHandleRef) {
    return getWallet(walletId).get_multisig_tx_set_info(
      getHandle(handle, "multisigTxSet"),
    );
  },

  async get_multisig_tx_signers_count(
    walletId: number,
    handle: WorkerHandleRef,
    excludeSelf: boolean,
  ) {
    return getWallet(walletId).get_multisig_tx_signers_count(
      getHandle(handle, "multisigTxSet"),
      excludeSelf,
    );
  },

  async sign_multisig_tx(walletId: number, handle: WorkerHandleRef) {
    return getWallet(walletId).sign_multisig_tx(
      getHandle(handle, "multisigTxSet"),
    );
  },

  async save_multisig_tx(walletId: number, handle: WorkerHandleRef) {
    return getWallet(walletId).save_multisig_tx(
      getHandle(handle, "multisigTxSet"),
    );
  },

  async transfer_commit_tx_multisig(walletId: number, handle: WorkerHandleRef) {
    return getWallet(walletId).transfer_commit_tx_multisig(
      getHandle(handle, "multisigTxSet"),
    );
  },

  async deleteHandle(handle: WorkerHandleRef) {
    deleteHandle(handle);
  },

  async get_multisig_status(walletId: number) {
    return getWallet(walletId).get_multisig_status();
  },

  async has_multisig_partial_key_images(walletId: number) {
    return getWallet(walletId).has_multisig_partial_key_images();
  },

  async has_unknown_key_images(walletId: number) {
    return getWallet(walletId).has_unknown_key_images();
  },

  async enable_multisig(walletId: number, enable: boolean) {
    return getWallet(walletId).enable_multisig(enable);
  },

  async prepare_multisig(walletId: number) {
    return getWallet(walletId).prepare_multisig();
  },

  async make_multisig(
    walletId: number,
    password: string,
    initialKexMsgs: string[],
    threshold: number,
  ) {
    return getWallet(walletId).make_multisig(password, initialKexMsgs, threshold);
  },

  async exchange_multisig_keys(
    walletId: number,
    password: string,
    kexMsgs: string[],
  ) {
    return getWallet(walletId).exchange_multisig_keys(password, kexMsgs);
  },

  async export_multisig(walletId: number) {
    return getWallet(walletId).export_multisig();
  },

  async import_multisig(walletId: number, infos: Uint8Array[]) {
    return getWallet(walletId).import_multisig(infos);
  },

  async export_key_images(walletId: number, filename: string, all: boolean) {
    return getWallet(walletId).export_key_images(filename, all);
  },

  async import_key_images(
    walletId: number,
    filename: string,
    importWhenUntrustedDaemon: boolean,
  ) {
    return getWallet(walletId).import_key_images(
      filename,
      importWhenUntrustedDaemon,
    );
  },

  async verify_password(walletId: number, password: string) {
    return getWallet(walletId).verify_password(password);
  },

  async rescan_blockchain(
    walletId: number,
    hard: boolean,
    keepKeyImages: boolean,
  ) {
    return getWallet(walletId).rescan_blockchain(hard, keepKeyImages);
  },
};

export type MoneroWasmWalletWorkerApi = typeof api;

expose(api);
