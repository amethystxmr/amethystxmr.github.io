import type { EmscriptenFs } from "./emscriptenFs";
import { validateWalletName } from "./walletName";

const DATA_ROOT = ".";
const WALLET_KEYS_SUFFIX = ".keys";
const ROOT_SPECIAL_NAMES = new Set([".", ".."]);

export const KNOWN_WALLET_COMPANION_SUFFIXES = [
  ".address.txt",
  ".mms",
  ".background",
  ".background.keys",
  ".background.address.txt",
] as const;

export type FsEntry = {
  name: string;
  type: "file" | "directory" | "other";
  size?: number;
};

export type WalletFileData = {
  name: string;
  data: Uint8Array;
};

export function getWalletFilePath(walletName: string): string {
  validateWalletName(walletName);
  return walletName;
}

export function getWalletKeysPath(walletName: string): string {
  validateWalletName(walletName);
  return `${walletName}${WALLET_KEYS_SUFFIX}`;
}

function listRootNames(fs: EmscriptenFs): string[] {
  return fs
    .readdir(DATA_ROOT)
    .filter((name) => !ROOT_SPECIAL_NAMES.has(name))
    .sort((a, b) => a.localeCompare(b));
}

function getRootEntryType(fs: EmscriptenFs, name: string): FsEntry["type"] {
  const stat = fs.stat(name);
  if (fs.isFile(stat.mode)) {
    return "file";
  }
  if (fs.isDir(stat.mode)) {
    return "directory";
  }
  return "other";
}

function isRootFile(fs: EmscriptenFs, name: string): boolean {
  try {
    return getRootEntryType(fs, name) === "file";
  } catch {
    return false;
  }
}

function pathExists(fs: EmscriptenFs, name: string): boolean {
  try {
    fs.stat(name);
    return true;
  } catch {
    return false;
  }
}

function tryStoredWalletNameFromKeysFile(fileName: string): string | null {
  if (!fileName.endsWith(WALLET_KEYS_SUFFIX)) {
    return null;
  }

  const walletName = fileName.slice(0, -WALLET_KEYS_SUFFIX.length);
  try {
    validateWalletName(walletName);
    return walletName;
  } catch {
    return null;
  }
}

function listWalletAnchorNames(fs: EmscriptenFs): Set<string> {
  const walletNames = new Set<string>();
  for (const name of listRootNames(fs)) {
    if (!isRootFile(fs, name)) {
      continue;
    }
    const walletName = tryStoredWalletNameFromKeysFile(name);
    if (walletName) {
      walletNames.add(walletName);
    }
  }
  return walletNames;
}

function isRelatedWalletPathName(walletName: string, name: string): boolean {
  return name === walletName || name.startsWith(`${walletName}.`);
}

function isAnotherWalletAnchor(
  walletName: string,
  name: string,
  walletAnchorNames: Set<string>,
): boolean {
  const otherWalletName = tryStoredWalletNameFromKeysFile(name);
  return (
    otherWalletName !== null &&
    otherWalletName !== walletName &&
    walletAnchorNames.has(otherWalletName)
  );
}

function isOwnedWalletFileName(
  walletName: string,
  name: string,
  walletAnchorNames: Set<string>,
): boolean {
  return (
    isRelatedWalletPathName(walletName, name) &&
    !isAnotherWalletAnchor(walletName, name, walletAnchorNames)
  );
}

function listOwnedWalletFileNames(
  fs: EmscriptenFs,
  walletName: string,
): string[] {
  validateWalletName(walletName);
  const walletAnchorNames = listWalletAnchorNames(fs);
  const ownedNames: string[] = [];

  for (const name of listRootNames(fs)) {
    if (
      isRootFile(fs, name) &&
      isOwnedWalletFileName(walletName, name, walletAnchorNames)
    ) {
      ownedNames.push(name);
    }
  }

  return sortWalletFileNames(walletName, ownedNames);
}

function sortWalletFileNames(walletName: string, names: string[]): string[] {
  const keysName = `${walletName}${WALLET_KEYS_SUFFIX}`;
  return [...names].sort((a, b) => {
    const aRank = a === walletName ? 0 : a === keysName ? 1 : 2;
    const bRank = b === walletName ? 0 : b === keysName ? 1 : 2;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return a.localeCompare(b);
  });
}

function validateStorageFileName(
  walletName: string,
  storageName: string,
): string {
  const trimmed = storageName.trim();
  if (trimmed.length === 0) {
    throw new Error("Wallet archive contains an empty file name");
  }
  if (trimmed !== storageName) {
    throw new Error(`Wallet file "${storageName}" has unsafe whitespace`);
  }
  if (
    ROOT_SPECIAL_NAMES.has(storageName) ||
    storageName.includes("/") ||
    storageName.includes("\\") ||
    /[\x00-\x1f\x7f]/.test(storageName)
  ) {
    throw new Error(`Wallet file "${storageName}" is not a safe root file`);
  }
  if (!isRelatedWalletPathName(walletName, storageName)) {
    throw new Error(
      `Wallet file "${storageName}" does not belong to wallet "${walletName}"`,
    );
  }

  return storageName;
}

export function listFilesystemEntries(fs: EmscriptenFs): FsEntry[] {
  return listRootNames(fs).map((name) => {
    const stat = fs.stat(name);
    return {
      name,
      type: fs.isFile(stat.mode)
        ? "file"
        : fs.isDir(stat.mode)
          ? "directory"
          : "other",
      size: stat.size,
    };
  });
}

export function listWalletNames(fs: EmscriptenFs): string[] {
  return [...listWalletAnchorNames(fs)].sort((a, b) => a.localeCompare(b));
}

export function walletStoragePathExists(
  fs: EmscriptenFs,
  walletName: string,
): boolean {
  validateWalletName(walletName);
  const walletAnchorNames = listWalletAnchorNames(fs);

  for (const name of listRootNames(fs)) {
    if (
      isOwnedWalletFileName(walletName, name, walletAnchorNames) ||
      KNOWN_WALLET_COMPANION_SUFFIXES.some(
        (suffix) => name === `${walletName}${suffix}`,
      )
    ) {
      return true;
    }
  }

  return false;
}

export function assertWalletNameAvailable(
  fs: EmscriptenFs,
  walletName: string,
): void {
  validateWalletName(walletName);
  if (walletStoragePathExists(fs, walletName)) {
    throw new Error(`Wallet with name ${walletName} already exists`);
  }
}

export function deleteWalletFiles(fs: EmscriptenFs, walletName: string): void {
  validateWalletName(walletName);
  for (const name of listOwnedWalletFileNames(fs, walletName)) {
    fs.unlink(name);
  }
}

export function renameWallet(
  fs: EmscriptenFs,
  oldName: string,
  newName: string,
): void {
  validateWalletName(oldName);
  validateWalletName(newName);

  if (oldName === newName) {
    return;
  }
  if (!pathExists(fs, `${oldName}${WALLET_KEYS_SUFFIX}`)) {
    throw new Error(`Wallet with name ${oldName} does not exist`);
  }

  const sourceNames = listOwnedWalletFileNames(fs, oldName);
  if (sourceNames.length === 0) {
    throw new Error(`Wallet with name ${oldName} does not exist`);
  }
  if (walletStoragePathExists(fs, newName)) {
    throw new Error("Wallet with the new name already exists");
  }

  const renamePlan = sourceNames.map((sourceName) => {
    const destinationName =
      sourceName === oldName
        ? newName
        : `${newName}${sourceName.slice(oldName.length)}`;
    return { sourceName, destinationName };
  });

  const destinationNames = new Set<string>();
  for (const { destinationName } of renamePlan) {
    if (destinationNames.has(destinationName)) {
      throw new Error(`Rename destination "${destinationName}" is duplicated`);
    }
    destinationNames.add(destinationName);
    if (pathExists(fs, destinationName)) {
      throw new Error(`Rename destination "${destinationName}" already exists`);
    }
  }

  for (const { sourceName, destinationName } of renamePlan) {
    fs.rename(sourceName, destinationName);
  }
}

export function getWalletFilesData(
  fs: EmscriptenFs,
  walletName: string,
): WalletFileData[] {
  validateWalletName(walletName);
  const keysName = `${walletName}${WALLET_KEYS_SUFFIX}`;
  if (!isRootFile(fs, keysName)) {
    throw new Error(`Wallet keys file "${keysName}" does not exist`);
  }

  return listOwnedWalletFileNames(fs, walletName).map((name) => ({
    name,
    data: fs.readFile(name),
  }));
}

export function getAllWalletFilesData(fs: EmscriptenFs): WalletFileData[] {
  const filesByName = new Map<string, WalletFileData>();
  for (const walletName of listWalletNames(fs)) {
    for (const file of getWalletFilesData(fs, walletName)) {
      if (!filesByName.has(file.name)) {
        filesByName.set(file.name, file);
      }
    }
  }
  return [...filesByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function saveWalletFilesData(
  fs: EmscriptenFs,
  walletName: string,
  files: WalletFileData[],
): void {
  validateWalletName(walletName);
  const keysName = `${walletName}${WALLET_KEYS_SUFFIX}`;
  const filesByName = new Map<string, Uint8Array>();

  for (const file of files) {
    const storageName = validateStorageFileName(walletName, file.name);
    if (filesByName.has(storageName)) {
      throw new Error(
        `Wallet archive contains duplicate file "${storageName}"`,
      );
    }
    filesByName.set(storageName, file.data);
  }

  if (!filesByName.has(keysName)) {
    throw new Error(`Wallet archive is missing required file "${keysName}"`);
  }
  if (walletStoragePathExists(fs, walletName)) {
    throw new Error(`Wallet with name ${walletName} already exists`);
  }
  for (const name of filesByName.keys()) {
    if (pathExists(fs, name)) {
      throw new Error(`File ${name} already exists`);
    }
  }

  for (const [name, data] of filesByName.entries()) {
    fs.writeFile(name, data);
  }
}
