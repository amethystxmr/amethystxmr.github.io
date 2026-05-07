import * as Comlink from "comlink";
import * as walletApi from "./walletApi";

type WalletHandleKind = "pending-tx" | "multisig-tx-set";

type WalletHandleRef = {
  __remoteHandleId: string;
  __remoteHandleKind: WalletHandleKind;
};

type WalletHandle = {
  delete(): void;
};

type WalletMethod = (...args: unknown[]) => unknown;

const handleReturningMethods = new Map<string, WalletHandleKind>([
  ["transfer_prepare", "pending-tx"],
  ["transfer_prepare_sweep_all", "pending-tx"],
  ["load_multisig_tx", "multisig-tx-set"],
]);

const handleArgumentMethods = new Set([
  "get_transfers_info",
  "transfer_commit_tx",
  "save_multisig_tx_pending_tx",
  "get_multisig_tx_set_info",
  "get_multisig_tx_signers_count",
  "sign_multisig_tx",
  "save_multisig_tx",
  "transfer_commit_tx_multisig",
]);

let nextWalletHandleId = 1;

function isWalletHandleRef(value: unknown): value is WalletHandleRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "__remoteHandleId" in value &&
    typeof (value as WalletHandleRef).__remoteHandleId === "string"
  );
}

function wrapWallet(wallet: walletApi.MoneroWasmWallet) {
  const handles = new Map<string, WalletHandle>();

  function registerHandle(kind: WalletHandleKind, handle: WalletHandle) {
    const id = `${kind}:${nextWalletHandleId++}`;
    handles.set(id, handle);
    return { __remoteHandleId: id, __remoteHandleKind: kind };
  }

  function resolveHandleRef(value: unknown) {
    if (!isWalletHandleRef(value)) {
      return value;
    }
    const handle = handles.get(value.__remoteHandleId);
    if (!handle) {
      throw new Error("Remote wallet handle is no longer available");
    }
    return handle;
  }

  function deleteHandle(id: string) {
    const handle = handles.get(id);
    if (!handle) {
      return;
    }
    handles.delete(id);
    handle.delete();
  }

  function deleteAllHandles() {
    for (const id of [...handles.keys()]) {
      deleteHandle(id);
    }
  }

  return new Proxy(wallet as unknown as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      if (prop === "delete_remote_handle") {
        return async (id: string) => {
          deleteHandle(id);
        };
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") {
        return value;
      }

      if (prop === "delete") {
        return async (...args: unknown[]) => {
          deleteAllHandles();
          return await (value as WalletMethod).apply(target, args);
        };
      }

      const handleKind = handleReturningMethods.get(prop);
      if (handleKind) {
        return async (...args: unknown[]) => {
          const handle = (await (value as WalletMethod).apply(
            target,
            args,
          )) as WalletHandle;
          return registerHandle(handleKind, handle);
        };
      }

      if (handleArgumentMethods.has(prop)) {
        return async (...args: unknown[]) => {
          return await (value as WalletMethod).apply(
            target,
            args.map(resolveHandleRef),
          );
        };
      }

      return value;
    },
  });
}

async function initModule() {
  await walletApi.initModule();
}

async function createWallet(networkType?: walletApi.NetworkType) {
  const wallet = await walletApi.createWallet(networkType);
  return Comlink.proxy(wrapWallet(wallet));
}

async function setHttpFetchCallback(
  callback: walletApi.HttpFetchCallback | null,
) {
  walletApi.setHttpFetchCallback(callback);
}

export const exposedApi = {
  initModule,
  createWallet,
  setDaemonAddress: walletApi.setDaemonAddress,
  setHttpFetchCallback,
  setMaxConcurrency: walletApi.setMaxConcurrency,
  decodePolyseed: walletApi.decodePolyseed,
  getMoneroVersionFull: walletApi.getMoneroVersionFull,
  loadFilesystem: walletApi.loadFilesystem,
  saveFilesystem: walletApi.saveFilesystem,
  clearFilesystem: walletApi.clearFilesystem,
  listWalletNames: walletApi.listWalletNames,
  deleteWalletFiles: walletApi.deleteWalletFiles,
  readFile: walletApi.readFile,
  writeFile: walletApi.writeFile,
  unlinkFile: walletApi.unlinkFile,
  isWalletFileExists: walletApi.isWalletFileExists,
  renameWallet: walletApi.renameWallet,
  getWalletFilesData: walletApi.getWalletFilesData,
  saveWalletFilesData: walletApi.saveWalletFilesData,
};

Comlink.expose(exposedApi);
