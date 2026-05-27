// @ts-expect-error Generated wasm JS module has no TypeScript declarations.
import MoneroWasmWalletModuleFactory from "./wasm_wallet.mjs";

export const NetworkTypes = {
  MAINNET: 0,
  TESTNET: 1,
  STAGENET: 2,
  FAKECHAIN: 3,
} as const;

export type NetworkType = (typeof NetworkTypes)[keyof typeof NetworkTypes];

/** Embind + Asyncify may return a plain value (sync path) or a Promise (after a yield). */
export type MaybePromise<T> = T | Promise<T>;

type IDBFS = unknown & { readonly __nominal: unique symbol };

/**
 * Invoked from WASM when a new block is seen (`uint64_t` height/timestamp).
 * With `-sWASM_BIGINT`, Embind passes these as `bigint`.
 */
export type WalletNewBlockCallback =
  | ((height: bigint, timestamp: bigint) => void)
  | null;
export type WalletTxHandle = number;

export declare class MoneroWasmWallet {
  constructor(networkType: NetworkType);
  init(): MaybePromise<boolean>;
  delete(): void;
  get_daemon_blockchain_height(): MaybePromise<bigint>;
  generate(
    fileName: string,
    password: string,
    secret32: Uint8Array,
    recover: boolean,
    two_random: boolean,
  ): MaybePromise<Uint8Array>;
  generate_multisig_restore(
    fileName: string,
    password: string,
    multisigDataHex: string,
    createAddressFile: boolean,
  ): MaybePromise<void>;
  generate_from_keys(
    fileName: string,
    password: string,
    address: string,
    secretViewKey: Uint8Array,
    secretSpendKey: Uint8Array,
    createAddressFile: boolean,
  ): MaybePromise<void>;
  generate_view_only_from_keys(
    fileName: string,
    password: string,
    address: string,
    secretViewKey: Uint8Array,
    createAddressFile: boolean,
  ): MaybePromise<void>;
  is_synced(): MaybePromise<boolean>;
  store(): MaybePromise<void>;
  /** Install callback for wallet sync progress (height/timestamp); pass `null` to clear. */
  set_on_new_block_callback(callback: WalletNewBlockCallback): MaybePromise<void>;
  set_attribute(key: string, value: string): MaybePromise<void>;
  get_attribute(key: string): MaybePromise<string>;
  load(fileName: string, password: string): MaybePromise<void>;
  refresh(
    isTrustedWallet: boolean,
    startHeight: number,
    checkPool: boolean,
    tryIncremental: boolean,
    maxBlocks: number | null,
  ): MaybePromise<{ blocksFetched: number; receivedMoney: boolean }>;
  rewrite(fileName: string, password: string): MaybePromise<void>;
  get_seed(seedLanguage: string, seedPassword: string): MaybePromise<string>;
  get_multisig_seed(seedPassword: string): MaybePromise<string>;
  get_address(): MaybePromise<string>;
  get_network_type(): MaybePromise<NetworkType>;
  allow_mismatched_daemon_version(allowMismatch: boolean): MaybePromise<void>;
  watch_only(): MaybePromise<boolean>;
  is_deterministic(): MaybePromise<boolean>;
  get_wallet_file(): MaybePromise<string>;
  get_tx_proof(txid: string, dstaddress: string, note: string): MaybePromise<string>;
  get_tx_key(txid: string): MaybePromise<string>;
  get_tx_keys_for_address(txid: string, dstaddress: string): MaybePromise<string[]>;
  balance(index_major: number, strict: boolean): MaybePromise<bigint>;
  unlocked_balance(
    index_major: number,
    strict: boolean,
  ): MaybePromise<{
    balance: bigint;
    blocks_to_unlock: bigint;
    time_to_unlock: bigint;
  }>;
  set_refresh_from_block_height(height: bigint): MaybePromise<void>;
  set_explicit_refresh_from_block_height(value: boolean): MaybePromise<void>;
  /**
   * Current height in the wallet. When it is same as get_daemon_blockchain_height() then it is synced
   */
  get_blockchain_current_height(): MaybePromise<bigint>;
  get_blockchain_height_by_date(
    year: number,
    month: number,
    day: number,
  ): MaybePromise<bigint>;
  words_to_bytes(words: string, language: string): MaybePromise<Uint8Array | null>;
  get_payments(minHeight: bigint, maxHeight: bigint): MaybePromise<PaymentDetails[]>;
  get_payments_mempool(): MaybePromise<PaymentDetails[]>;
  get_num_subaddresses(index_major: number): MaybePromise<number>;
  get_subaddress_as_str(
    index_major: number,
    index_minor: number,
  ): MaybePromise<string>;
  get_subaddress_label(
    index_major: number,
    index_minor: number,
  ): MaybePromise<string>;
  get_wallet_addresses(accountId: number): MaybePromise<WalletAddress[]>;
  get_keys(accountIdx: number): MaybePromise<WalletKeys>;
  add_subaddress(index_major: number, label: string): MaybePromise<void>;
  transfer_prepare(
    destinations: string[],
    amounts: bigint[],
    priority: FeePriority,
    subtractFeeFromIndex: number | null,
  ): MaybePromise<WalletTxHandle>;
  transfer_prepare_sweep_all(
    destination: string,
    priority: FeePriority,
  ): MaybePromise<WalletTxHandle>;
  get_transfers(): MaybePromise<TransferItem[]>;
  get_transfers_info(handle: WalletTxHandle): MaybePromise<TransferInfoItem[]>;
  transfer_commit_tx(handle: WalletTxHandle): MaybePromise<void>;
  save_multisig_tx_pending_tx(handle: WalletTxHandle): MaybePromise<Uint8Array>;
  load_multisig_tx(
    data: Uint8Array,
    do_accept: boolean,
  ): MaybePromise<WalletTxHandle>;
  get_multisig_tx_set_info(handle: WalletTxHandle): MaybePromise<TransferInfoItem[]>;
  get_multisig_tx_signers_count(
    handle: WalletTxHandle,
    excludeSelf: boolean,
  ): MaybePromise<number>;
  sign_multisig_tx(handle: WalletTxHandle): MaybePromise<string[]>;
  save_multisig_tx(handle: WalletTxHandle): MaybePromise<Uint8Array>;
  transfer_commit_tx_multisig(handle: WalletTxHandle): MaybePromise<void>;
  destroy_tx_handle(handle: WalletTxHandle): MaybePromise<void>;

  get_multisig_status(): MaybePromise<MultisigAccountStatus>;
  has_multisig_partial_key_images(): MaybePromise<boolean>;
  has_unknown_key_images(): MaybePromise<boolean>;
  enable_multisig(enable: boolean): MaybePromise<void>;
  prepare_multisig(): MaybePromise<string>;
  /** Note: this function saves wallet, .keys and .address.txt files! */
  make_multisig(
    password: string,
    initial_kex_msgs: string[],
    threshold: number,
  ): MaybePromise<string>;
  /**
   * Note: this also saves files.
   */
  exchange_multisig_keys(password: string, kex_msgs: string[]): MaybePromise<string>;
  export_multisig(): MaybePromise<Uint8Array>;
  import_multisig(infos: Uint8Array[]): MaybePromise<number>;
  export_key_images(filename: string, all: boolean): MaybePromise<void>;
  import_key_images(
    filename: string,
    import_when_untrusted_daemon: boolean,
  ): MaybePromise<KeyImagesImportResult>;
  verify_password(password: string): MaybePromise<boolean>;
  rescan_blockchain(hard: boolean, keep_key_images: boolean): MaybePromise<void>;
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

/** Matches Embind `PaymentDestination` (`wallet2`-style address + atomic amount). */
export interface PaymentDestination {
  address: string;
  amount: bigint;
}

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
  destinations: PaymentDestination[];
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
  /** Emscripten helper when C++ exceptions surface as raw integers in JS. */
  getExceptionMessage?(exn: number): [string, string];
  decrementExceptionRefcount?(exn: number): void;
  /** Optional Monero logging categories (`mlog_set_categories` from wasm). */
  mlog_set_categories?(categories: string): void;
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
  get_monero_version_full(): string;
  /**
   * `birthday` is `polyseed_get_birthday` (wallet birthday height index), a small
   * integer from WASM — not a Unix timestamp. Typed as `number` (Embind `val(u32)`).
   */
  decodePolyseed(moneroPolyseed: string): {
    birthday: number;
    privateKey: Uint8Array;
    langStr: string;
  };
}

/**
 * Module bootstrap progress. Keep this API semantic only; user-facing text
 * belongs in the UI layer, keyed by `phase`.
 */
export type ModuleLoadProgress =
  | { phase: "preparingModule" }
  | {
      phase: "downloadingWasm";
      bytesLoaded: number;
      bytesTotal: number | null;
    }
  | {
      phase: "linkingNativeModule";
      resolvedDependencies: number;
      totalDependencies: number;
    }
  | { phase: "initializingWalletStorage" }
  | { phase: "moduleReady" };

export type ModuleLoadProgressCallback =
  | ((progress: ModuleLoadProgress) => void)
  | null;

type ModuleFactoryOptions = {
  monitorRunDependencies?: (left: number) => void;
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    receiveInstance: (
      instance: WebAssembly.Instance,
      module: WebAssembly.Module,
    ) => void,
  ) => WebAssembly.Exports | Record<string, never>;
};

type WasmProgressReporter = (
  bytesLoaded: number,
  bytesTotal: number | null,
) => void;

let module: Module;

/**
 * Emscripten/embind often rejects with a **numeric** value: the WASM C++ exception
 * pointer (`throw exceptionLast`). It is **not** a wallet/daemon error code; the
 * number changes each run with heap layout. When `getExceptionMessage` is exported
 * (see CMakeLists `EXPORTED_RUNTIME_METHODS`), decode to a real message and release
 * the exception with `decrementExceptionRefcount` per Emscripten docs.
 */
export function wasmThrownValueToError(thrown: unknown): Error {
  if (thrown instanceof Error) {
    return thrown;
  }

  if (typeof thrown !== "number") {
    return new Error(String(thrown));
  }

  const ptr = thrown;

  if (!module.getExceptionMessage || !module.decrementExceptionRefcount) {
    return new Error(
      "WASM raised a C++ exception (shown as a numeric pointer in the console - not an application error code). " +
        "Rebuild monero-wasm with `getExceptionMessage` + `decrementExceptionRefcount` in EXPORTED_RUNTIME_METHODS to decode the message.",
    );
  }

  try {
    const [type, rawMessage] = module.getExceptionMessage(ptr);
    const message =
      rawMessage && rawMessage.length > 0
        ? rawMessage
        : type && type.length > 0
          ? type
          : "C++ exception (empty what())";
    return new Error(message);
  } catch {
    return new Error(
      `Could not decode WASM exception at pointer ${ptr} (heap addresses differ each run).`,
    );
  } finally {
    try {
      module.decrementExceptionRefcount(ptr);
    } catch {
      // Best-effort cleanup; ignore if pointer was already released.
    }
  }
}

type HttpFetchState =
  | "start"
  | "progress"
  | "end"
  | "error"
  | "timeout"
  | "abort";

export type { HttpFetchState };

/** Daemon RPC progress from the wallet worker. When `progressTotal` is 0, the UI treats the request as indeterminate until a `progress` event with `lengthComputable`. */
export type HttpFetchCallback = (
  url: string,
  reqId: string,
  state: HttpFetchState,
  progressLoaded: number,
  progressTotal: number,
) => void;

type GlobalHttpConfig = {
  mapUrl: (url: string) => string;
  onFetch: HttpFetchCallback;
};

type WalletRuntimeGlobal = typeof globalThis & {
  moneroWalletModule?: Module;
  clearFilesystem?: typeof clearFilesystem;
  globalHttpConfig?: GlobalHttpConfig;
};

function getWalletRuntimeGlobal(): WalletRuntimeGlobal {
  const runtimeGlobal = globalThis as WalletRuntimeGlobal;
  return runtimeGlobal;
}

function ensureGlobalHttpConfig(): GlobalHttpConfig {
  const runtimeGlobal = getWalletRuntimeGlobal();
  runtimeGlobal.globalHttpConfig ??= {
    mapUrl: () => {
      throw new Error("mapUrl not set");
    },
    onFetch: (...args) => {
      console.log("onFetch", ...args);
    },
  };
  return runtimeGlobal.globalHttpConfig;
}

function getWalletWasmUrl() {
  return new URL("wasm_wallet.wasm", import.meta.url).href;
}

function fetchWasmBinaryWithProgress(
  url: string,
  onProgress: WasmProgressReporter,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let bytesTotal: number | null = null;
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";

    xhr.onprogress = (event) => {
      bytesTotal = event.lengthComputable ? event.total : null;
      onProgress(event.loaded, bytesTotal);
    };

    xhr.onload = () => {
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
        const response = xhr.response;
        if (response instanceof ArrayBuffer) {
          onProgress(response.byteLength, bytesTotal);
          resolve(response);
          return;
        }
        reject(new Error(`Invalid WASM response from ${url}`));
        return;
      }

      reject(new Error(`${xhr.status} : ${xhr.responseURL || url}`));
    };

    xhr.onerror = () => {
      reject(new Error(`Failed to load WASM from ${url}`));
    };

    xhr.onabort = () => {
      reject(new Error(`WASM load aborted from ${url}`));
    };

    xhr.ontimeout = () => {
      reject(new Error(`WASM load timed out from ${url}`));
    };

    onProgress(0, null);
    xhr.send();
  });
}

function instantiateWalletWasmWithProgress(
  imports: WebAssembly.Imports,
  receiveInstance: (instance: WebAssembly.Instance, mod: WebAssembly.Module) => void,
  reportProgress: WasmProgressReporter,
  onError: (error: unknown) => void,
): void {
  void (async () => {
    const binary = await fetchWasmBinaryWithProgress(
      getWalletWasmUrl(),
      reportProgress,
    );
    const result = await WebAssembly.instantiate(binary, imports);
    receiveInstance(result.instance, result.module);
  })().catch(onError);
}

export async function initModule(onProgress: ModuleLoadProgressCallback = null) {
  if (module) {
    onProgress?.({ phase: "moduleReady" });
    return;
  }

  onProgress?.({ phase: "preparingModule" });

  let totalRunDependencies = 0;
  let failModuleLoad!: (error: unknown) => void;
  const moduleLoadFailed = new Promise<never>((_, reject) => {
    failModuleLoad = reject;
  });
  const reportWasmProgress: WasmProgressReporter = (bytesLoaded, bytesTotal) => {
    onProgress?.({ phase: "downloadingWasm", bytesLoaded, bytesTotal });
  };

  const moduleLoad = MoneroWasmWalletModuleFactory({
    instantiateWasm(imports, receiveInstance) {
      instantiateWalletWasmWithProgress(
        imports,
        receiveInstance,
        reportWasmProgress,
        failModuleLoad,
      );
      // Emscripten requires `{}` to mark async instantiation.
      return {};
    },
    monitorRunDependencies(left) {
      totalRunDependencies = Math.max(totalRunDependencies, left);
      if (totalRunDependencies <= 0) {
        return;
      }
      const resolved = totalRunDependencies - left;
      onProgress?.({
        phase: "linkingNativeModule",
        resolvedDependencies: resolved,
        totalDependencies: totalRunDependencies,
      });
    },
  } satisfies ModuleFactoryOptions) as Promise<Module>;

  module = await Promise.race([moduleLoad, moduleLoadFailed]);

  onProgress?.({ phase: "initializingWalletStorage" });
  await initFilesystem();
  getWalletRuntimeGlobal().moneroWalletModule = module;
  ensureGlobalHttpConfig();
  onProgress?.({ phase: "moduleReady" });
}

export function setDaemonAddress(daemonAddress: string) {
  ensureGlobalHttpConfig().mapUrl = (url) => daemonAddress + url;
}

export function setHttpFetchCallback(callback: HttpFetchCallback | null) {
  ensureGlobalHttpConfig().onFetch =
    callback ??
    ((...args) => {
      console.log("onFetch", ...args);
    });
}

export function setWalletNewBlockCallback(
  wallet: MoneroWasmWallet,
  callback: WalletNewBlockCallback,
): MaybePromise<void> {
  return wallet.set_on_new_block_callback(callback);
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

/**
 * Mount in-memory FS only. Populate from IndexedDB via `loadFilesystem()` — call
 * from the UI under `withFsLock()` (see web-src/components/utils.ts) so all tabs
 * serialize IDBFS sync and share a consistent view.
 */
async function initFilesystem() {
  module.FS.mkdir("/data");
  module.FS.mount(module.IDBFS, {}, "/data");
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

getWalletRuntimeGlobal().clearFilesystem = clearFilesystem;

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

export async function createWallet(
  networkType: NetworkType = NetworkTypes.MAINNET,
) {
  const wallet = new module.MoneroWasmWallet(networkType);
  try {
    const actualNetworkType = await wallet.get_network_type();
    if (actualNetworkType !== networkType) {
      // This is to verify that enums are used correctly
      throw new Error("Internal error: Wallet network type mismatch");
    }
    return wallet;
  } catch (e) {
    wallet.delete();
    throw e;
  }
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
