// @ts-expect-error Generated wasm JS module has no TypeScript declarations.
import MoneroWasmWalletModuleFactory from "./monero-wasm-wallet.mjs";

export const NetworkTypes = {
  MAINNET: 0,
  TESTNET: 1,
  STAGENET: 2,
  FAKECHAIN: 3,
} as const;

export type NetworkType = (typeof NetworkTypes)[keyof typeof NetworkTypes];

type IDBFS = unknown & { readonly __nominal: unique symbol };

export declare class MoneroWasmWallet {
  constructor(networkType: NetworkType);
  init(): Promise<boolean>;
  close_wallet(): Promise<void>;
  delete(): void;
  get_daemon_blockchain_height(): Promise<bigint>;
  generate(
    fileName: string,
    password: string,
    secret32: Uint8Array,
    recover: boolean,
    two_random: boolean,
  ): Promise<Uint8Array>;
  generate_multisig_restore(
    fileName: string,
    password: string,
    multisigDataHex: string,
    createAddressFile: boolean,
  ): Promise<boolean>;
  generate_from_keys(
    fileName: string,
    password: string,
    address: string,
    secretViewKey: Uint8Array,
    secretSpendKey: Uint8Array,
    createAddressFile: boolean,
  ): Promise<boolean>;
  generate_view_only_from_keys(
    fileName: string,
    password: string,
    address: string,
    secretViewKey: Uint8Array,
    createAddressFile: boolean,
  ): Promise<boolean>;
  is_synced(): Promise<boolean>;
  store(): Promise<void>;
  set_attribute(key: string, value: string): Promise<boolean>;
  get_attribute(key: string): Promise<string>;
  load(fileName: string, password: string): Promise<void>;
  refresh(
    isTrustedWallet: boolean,
    startHeight: bigint,
    checkPool: boolean,
    tryIncremental: boolean,
    maxBlocks: bigint,
  ): Promise<{ blocksFetched: bigint; receivedMoney: boolean }>;
  rewrite(fileName: string, password: string): Promise<void>;
  set_on_new_block_callback: (
    callback: ((height: bigint, timestamp: bigint) => void) | null,
  ) => void;
  get_seed(seedLanguage: string, seedPassword: string): Promise<string>;
  get_multisig_seed(seedPassword: string): Promise<string>;
  get_address(): Promise<string>;
  get_network_type(): NetworkType;
  allow_mismatched_daemon_version(allowMismatch: boolean): void;
  watch_only(): Promise<boolean>;
  is_deterministic(): Promise<boolean>;
  get_wallet_file(): Promise<string>;
  get_tx_proof(txid: string, dstaddress: string, note: string): Promise<string>;
  get_tx_key(txid: string): Promise<string>;
  get_tx_keys_for_address(txid: string, dstaddress: string): Promise<string[]>;
  balance(index_major: number, strict: boolean): Promise<bigint>;
  unlocked_balance(
    index_major: number,
    strict: boolean,
  ): Promise<{
    balance: bigint;
    blocks_to_unlock: bigint;
    time_to_unlock: bigint;
  }>;
  set_refresh_from_block_height(height: bigint): Promise<boolean>;
  set_explicit_refresh_from_block_height(value: boolean): Promise<boolean>;
  /**
   * Current height in the wallet. When it is same as get_daemon_blockchain_height() then it is synced
   */
  get_blockchain_current_height(): Promise<bigint>;
  get_blockchain_height_by_date(
    year: number,
    month: number,
    day: number,
  ): Promise<bigint>;
  words_to_bytes(words: string, language: string): Uint8Array | null;
  get_payments(
    minHeight: bigint,
    maxHeight: bigint,
  ): Promise<EmbindVector<PaymentDetails>>;
  get_payments_mempool(): Promise<EmbindVector<PaymentDetails>>;
  get_num_subaddresses(index_major: number): Promise<number>;
  get_subaddress_as_str(
    index_major: number,
    index_minor: number,
  ): Promise<string>;
  get_subaddress_label(
    index_major: number,
    index_minor: number,
  ): Promise<string>;
  get_wallet_addresses(accountId: number): Promise<EmbindVector<WalletAddress>>;
  get_keys(accountIdx: number): Promise<WalletKeys>;
  add_subaddress(index_major: number, label: string): Promise<void>;
  transfer_prepare(
    destinations: string[],
    amounts: bigint[],
    priority: FeePriority,
    subtractFeeFromIndex: number | null,
  ): Promise<PendingTxHandle>;
  transfer_prepare_sweep_all(
    destination: string,
    priority: FeePriority,
  ): Promise<PendingTxHandle>;
  get_transfers(): Promise<TransferItem[]>;
  get_transfers_info(handle: PendingTxHandle): TransferInfoItem[];
  transfer_commit_tx(handle: PendingTxHandle): Promise<void>;
  save_multisig_tx_pending_tx(handle: PendingTxHandle): Promise<Uint8Array>;
  load_multisig_tx(
    data: Uint8Array,
    do_accept: boolean,
  ): Promise<MultisigTxSetHandle>;
  get_multisig_tx_set_info(handle: MultisigTxSetHandle): TransferInfoItem[];
  get_multisig_tx_signers_count(
    handle: MultisigTxSetHandle,
    excludeSelf: boolean,
  ): number;
  sign_multisig_tx(handle: MultisigTxSetHandle): Promise<string[]>;
  save_multisig_tx(handle: MultisigTxSetHandle): Promise<Uint8Array>;
  transfer_commit_tx_multisig(handle: MultisigTxSetHandle): Promise<void>;

  get_multisig_status(): Promise<MultisigAccountStatus>;
  has_multisig_partial_key_images(): Promise<boolean>;
  has_unknown_key_images(): Promise<boolean>;
  enable_multisig(enable: boolean): Promise<boolean>;
  prepare_multisig(): Promise<string>;
  /** Note: this function saves wallet, .keys and .address.txt files! */
  make_multisig(
    password: string,
    initial_kex_msgs: string[],
    threshold: number,
  ): Promise<string>;
  /**
   * Note: this also saves files.
   */
  exchange_multisig_keys(password: string, kex_msgs: string[]): Promise<string>;
  export_multisig(): Promise<Uint8Array>;
  import_multisig(infos: Uint8Array[]): Promise<number>;
  export_key_images(filename: string, all: boolean): Promise<boolean>;
  import_key_images(
    filename: string,
    import_when_untrusted_daemon: boolean,
  ): Promise<KeyImagesImportResult>;
  verify_password(password: string): Promise<boolean>;
  rescan_blockchain(hard: boolean, keep_key_images: boolean): Promise<boolean>;
}

export const FeePriority = {
  Default: 0,
  Unimportant: 1,
  Normal: 2,
  Elevated: 3,
  Priority: 4,
} as const;

export type FeePriority = (typeof FeePriority)[keyof typeof FeePriority];


export const CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE = 10n;

export interface PaymentDetails {
  payment_id: string;
  type: // Mined
    | "block"
    // Incoming
    | "in"
    // Outgoing
    | "out"
    // Failed
    | "failed"
    // Outgoing in the mempool
    | "pending"
    // Incoming in the mempool
    | "mempool";
  is_unlocked: boolean;
  block_height: bigint;
  unlock_time: bigint;
  timestamp: bigint;
  amount: bigint;
  tx_hash: string;
  fee: bigint;
  /** <addr>:<amount>;.... */
  destinationsStr: string;
  index_major: number;
  index_minor: number;
  note: string;
}

export interface WalletAddress {
  address: string;
  label: string;
  indexMinor: number;
}

export interface WalletKeys {
  address: string;
  viewKey: {
    private: Uint8Array;
    public: Uint8Array;
  };
  spendKey: {
    private: Uint8Array | null;
    public: Uint8Array;
  };
}

interface multisig_account_status {
  // is the multisig account active/initialized?
  multisig_is_active: boolean;
  // has the multisig account completed the main key exchange rounds?
  kex_is_done: boolean;
  // is the multisig account ready to use?
  is_ready: boolean;
  // number of setup rounds already completed by this wallet
  multisig_rounds_passed: number;
  // multisig is: M-of-N
  threshold: number; // M
  total: number; // N
}

export type MultisigAccountStatus = multisig_account_status;

export interface KeyImagesImportResult {
  height: bigint;
  spent: bigint;
  unspent: bigint;
}

interface ClassHandle {
  delete(): void;
}
export interface EmbindVector<T> extends ClassHandle {
  size(): number;
  get(index: number): T;
}

export interface PendingTxHandle extends ClassHandle {
  readonly __nominal: unique symbol;
}

export interface MultisigTxSetHandle extends ClassHandle {
  readonly __nominal: unique symbol;
}

export interface TransferInfoItem {
  fee: bigint;
  changeAmount: bigint;
  destinations: TransferDestinationInfo[];
}

export interface TransferItem {
  block_height: bigint;
  txid: string;
  global_output_index: bigint;
  local_output_index: bigint;
  spent: boolean;
  froze: boolean;
  spent_height: bigint;
  amount: bigint;
  rct: boolean;
  key_image_known: boolean;
  key_image_request: boolean;
  subaddr_index_major: number;
  subaddr_index_minor: number;
  key_image_partial: boolean;
}

export interface TransferDestinationInfo {
  dstAddress: string;
  dspAmount: bigint;
}

interface Module {
  FS: {
    mkdir(path: string): void;
    mount(type: IDBFS, opts: Record<string, never>, mountpoint: string): void;
    syncfs(populate: boolean, callback: (err: unknown) => void): void;
    chdir(path: string): void;
    readdir(path: string): string[];
    stat(path: string): { mode: number };
    isDir(mode: number): boolean;
    rmdir(path: string): void;
    unlink(path: string): void;
    rename(oldPath: string, newPath: string): void;
    readFile(path: string): Uint8Array;
    writeFile(path: string, data: Uint8Array): void;
  };
  IDBFS: IDBFS;
  MoneroWasmWallet: typeof MoneroWasmWallet;
  set_max_concurrency(threads: number): void;
  get_monero_version_full(): string;
  decodePolyseed(moneroPolyseed: string): {
    birthday: bigint;
    privateKey: Uint8Array;
    langStr: string;
  };
}

let module: Module;
type HttpFetchState =
  | "start"
  | "progress"
  | "end"
  | "error"
  | "timeout"
  | "abort";

declare global {
  interface Window {
    moneroWalletModule: Module;
    clearFilesystem: typeof clearFilesystem;
    globalHttpConfig: {
      mapUrl: (url: string) => string;
      onFetch: (
        url: string,
        reqId: string,
        state: HttpFetchState,
        progressLoaded: number,
        progressTotal: number,
      ) => void;
    };
  }
}

export async function initModule() {
  if (module) {
    return module;
  }
  module = (await MoneroWasmWalletModuleFactory()) as Module;
  await initFilesystem();
  setMaxConcurrency(getRecommendedMaxConcurrency());
  window.moneroWalletModule = module;

  window.globalHttpConfig = {
    mapUrl: () => {
      throw new Error("mapUrl not set");
    },
    // mapUrl: (url) => "https://xmr-node.cakewallet.com:18081" + url,
    onFetch: (...args) => {
      console.log("onFetch", ...args);
    },
  };

  return module;
}

export function getMaxConcurrency() {
  // Note: it always should be the same as in sPTHREAD_POOL_SIZE
  return navigator.hardwareConcurrency || 2;
}

export function getRecommendedMaxConcurrency() {
  const cpuCount =
    typeof navigator !== "undefined" &&
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 2;
  return Math.max(1, cpuCount - 1);
}

export function setMaxConcurrency(threads: number) {
  if (!module) {
    throw new Error("Module not initialized");
  }
  const sanitized = Number.isFinite(threads) ? Math.trunc(threads) : 1;
  const clamped = Math.min(getMaxConcurrency(), Math.max(1, sanitized));
  module.set_max_concurrency(clamped);
}

export function decodePolyseed(moneroPolyseed: string) {
  if (!module) {
    throw new Error("Module not initialized");
  }
  return module.decodePolyseed(moneroPolyseed);
}

export function getMoneroVersionFull() {
  if (!module) {
    throw new Error("Module not initialized");
  }
  return module.get_monero_version_full();
}

export async function loadFilesystem() {
  await new Promise<void>((resolve, reject) =>
    module.FS.syncfs(true, (err) => (err ? reject(err) : resolve())),
  );
}

async function initFilesystem() {
  module.FS.mkdir("/data");
  module.FS.mount(module.IDBFS, {}, "/data");
  await loadFilesystem();
  module.FS.chdir("/data");
}

export async function saveFilesystem() {
  if (!module) {
    throw new Error("Module not initialized");
  }

  await new Promise<void>((resolve, reject) =>
    module.FS.syncfs(false, (err) => (err ? reject(err) : resolve())),
  );
}

export async function clearFilesystem() {
  function rmrf(path: string) {
    for (const name of module.FS.readdir(path)) {
      if (name === "." || name === "..") continue;
      const full = `${path}/${name}`;
      const stat = module.FS.stat(full);
      if (module.FS.isDir(stat.mode)) {
        rmrf(full);
        module.FS.rmdir(full);
      } else {
        module.FS.unlink(full);
      }
    }
  }
  rmrf("/data");

  await saveFilesystem();
}

if (typeof window !== "undefined") {
  window.clearFilesystem = clearFilesystem;
}

export function listWalletNames() {
  return module.FS.readdir(".")
    .filter((name) => name.endsWith(".keys"))
    .map((name) => name.slice(0, -5));
}

export function deleteWalletFiles(walletName: string) {
  const names = new Set(module.FS.readdir("."));
  for (const name of names) {
    if (
      name === walletName ||
      name === `${walletName}.keys` ||
      name.startsWith(walletName + ".")
    ) {
      module.FS.unlink(name);
    }
  }
}

export function createWallet(networkType: NetworkType = NetworkTypes.MAINNET) {
  const wallet = new module.MoneroWasmWallet(networkType);
  const actualNetworkType = wallet.get_network_type();
  if (actualNetworkType !== networkType) {
    wallet.delete();
    // This is to verify that enums are used correctly
    throw new Error("Internal error: Wallet network type mismatch");
  }
  return wallet;
}

export function readFile(path: string): Uint8Array {
  if (!module) {
    throw new Error("Module not initialized");
  }
  return module.FS.readFile(path);
}

export function writeFile(path: string, data: Uint8Array): void {
  if (!module) {
    throw new Error("Module not initialized");
  }
  module.FS.writeFile(path, data);
}

export function unlinkFile(path: string): void {
  if (!module) {
    throw new Error("Module not initialized");
  }
  module.FS.unlink(path);
}

export function isWalletFileExists(walletName: string) {
  const names = new Set(module.FS.readdir("."));
  return names.has(walletName) || names.has(`${walletName}.keys`);
}

export function renameWallet(oldName: string, newName: string) {
  const names = new Set(module.FS.readdir("."));
  for (const existingCheck of [newName, `${newName}.keys`]) {
    if (names.has(existingCheck)) {
      throw new Error("Wallet with the new name already exists");
    }
  }

  for (const candidate of [oldName, `${oldName}.keys`]) {
    if (names.has(candidate)) {
      const newCandidate = candidate.replace(oldName, newName);
      module.FS.rename(candidate, newCandidate);
    }
  }
}

export function getWalletFilesData(walletName: string) {
  const keysName = `${walletName}.keys`;
  const keysFileData = module.FS.readFile(keysName);
  const outFiles = [{ name: keysName, data: keysFileData }];

  for (const name of module.FS.readdir(".")) {
    if (
      name === walletName ||
      (name.startsWith(walletName + ".") && name !== keysName)
    ) {
      const data = module.FS.readFile(name);
      outFiles.push({ name, data });
    }
  }
  return outFiles;
}

export function saveWalletFilesData(
  walletName: string,
  keysFileData: Uint8Array,
  otherFilesData: { name: string; data: Uint8Array }[],
) {
  const keysName = `${walletName}.keys`;
  if (module.FS.readdir(".").includes(keysName)) {
    throw new Error(`File ${keysName} already exists`);
  }
  for (const { name } of otherFilesData) {
    if (module.FS.readdir(".").includes(name)) {
      throw new Error(`File ${name} already exists`);
    }
  }

  module.FS.writeFile(keysName, keysFileData);
  for (const { name, data } of otherFilesData) {
    module.FS.writeFile(name, data);
  }
}

export const max64 = (1n << 64n) - 1n;

export interface PaymentDetailsTransformed extends PaymentDetails {
  destinations: { address: string; amount: bigint }[];
}
export function transformPayments(
  payments: EmbindVector<PaymentDetails>,
): PaymentDetailsTransformed[] {
  const result: PaymentDetailsTransformed[] = [];
  for (let i = 0; i < payments.size(); i++) {
    const p = payments.get(i);
    const destinations: PaymentDetailsTransformed["destinations"] = [];
    if (p.destinationsStr) {
      for (const part of p.destinationsStr.split(";")) {
        const [address, amountStr] = part.split(":");
        destinations.push({ address, amount: BigInt(amountStr) });
      }
    }
    result.push({ ...p, destinations });
  }
  payments.delete();

  result.sort((a, b) => {
    // Pending first
    if (a.type === "pending" && b.type !== "pending") return -1;
    if (a.type !== "pending" && b.type === "pending") return 1;

    // If both pending → timestamp DESC
    if (a.type === "pending") {
      return Number(b.timestamp - a.timestamp);
    }

    // Confirmed → block_height DESC
    if (a.block_height !== b.block_height) {
      return Number(b.block_height - a.block_height);
    }

    // Same block → timestamp DESC
    return Number(b.timestamp - a.timestamp);
  });

  return result;
}

export function transformWalletAddresses(
  addresses: EmbindVector<WalletAddress>,
): WalletAddress[] {
  const result: WalletAddress[] = [];
  for (let i = 0; i < addresses.size(); i++) {
    result.push(addresses.get(i));
  }
  addresses.delete();
  result.sort((a, b) => a.indexMinor - b.indexMinor);
  return result;
}
