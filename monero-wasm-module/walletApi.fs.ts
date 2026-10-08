import type { EmscriptenFs } from "./emscriptenFs";
import { getWalletModuleFs } from "./walletApi";
import {
  isWalletOwnedFileName,
  isWalletStorageFileOwned,
  leftoverWalletFileNames,
  unexpectedKeysExportFileNames,
  unexpectedKeysFileNames,
  validateWalletName,
  walletKeysFileName,
  walletNameFromKeysFile,
} from "./walletName";

const DATA_ROOT = ".";
const ROOT_SPECIAL_NAMES = new Set([".", ".."]);

export type WalletFileData = {
  name: string;
  data: Uint8Array;
};

function listRootNames(fs: EmscriptenFs): string[] {
  return fs
    .readdir(DATA_ROOT)
    .filter((name) => !ROOT_SPECIAL_NAMES.has(name))
    .sort((a, b) => a.localeCompare(b));
}

function isRootFile(fs: EmscriptenFs, name: string): boolean {
  try {
    return fs.isFile(fs.stat(name).mode);
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

function listWalletAnchorNames(fs: EmscriptenFs): Set<string> {
  const walletNames = new Set<string>();
  for (const name of listRootNames(fs)) {
    if (!isRootFile(fs, name)) {
      continue;
    }
    const walletName = walletNameFromKeysFile(name);
    if (walletName) {
      walletNames.add(walletName);
    }
  }
  return walletNames;
}

function listOwnedWalletFileNames(
  fs: EmscriptenFs,
  walletName: string,
): string[] {
  validateWalletName(walletName);
  const walletAnchorNames = listWalletAnchorNames(fs);
  const ownedNames = listRootNames(fs).filter(
    (name) =>
      isRootFile(fs, name) &&
      isWalletStorageFileOwned(walletName, name, walletAnchorNames),
  );
  return sortWalletFileNames(walletName, ownedNames);
}

function sortWalletFileNames(walletName: string, names: string[]): string[] {
  const keysName = walletKeysFileName(walletName);
  return [...names].sort((a, b) => {
    const rank = (name: string) =>
      name === walletName ? 0 : name === keysName ? 1 : 2;
    const rankDiff = rank(a) - rank(b);
    return rankDiff === 0 ? a.localeCompare(b) : rankDiff;
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
  if (!isWalletOwnedFileName(walletName, storageName)) {
    throw new Error(
      `Wallet file "${storageName}" does not belong to wallet "${walletName}"`,
    );
  }
  return storageName;
}

export function listWalletNames(): string[] {
  return [...listWalletAnchorNames(getWalletModuleFs())].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function walletStoragePathExists(walletName: string): boolean {
  validateWalletName(walletName);
  const fs = getWalletModuleFs();
  const walletAnchorNames = listWalletAnchorNames(fs);
  return listRootNames(fs).some((name) =>
    isWalletStorageFileOwned(walletName, name, walletAnchorNames),
  );
}

export function assertWalletNameAvailable(walletName: string): void {
  if (walletStoragePathExists(walletName)) {
    throw new Error(`Wallet with name ${walletName} already exists`);
  }
}

export function deleteWalletFiles(walletName: string): void {
  const fs = getWalletModuleFs();
  for (const name of listOwnedWalletFileNames(fs, walletName)) {
    fs.unlink(name);
  }
}

export function renameWallet(oldName: string, newName: string): void {
  validateWalletName(oldName);
  validateWalletName(newName);
  if (oldName === newName) {
    return;
  }

  const fs = getWalletModuleFs();
  if (!pathExists(fs, walletKeysFileName(oldName))) {
    throw new Error(`Wallet with name ${oldName} does not exist`);
  }

  const sourceNames = listOwnedWalletFileNames(fs, oldName);
  if (sourceNames.length === 0) {
    throw new Error(`Wallet with name ${oldName} does not exist`);
  }
  if (walletStoragePathExists(newName)) {
    throw new Error("Wallet with the new name already exists");
  }

  const renamePlan = sourceNames.map((sourceName) => ({
    sourceName,
    destinationName:
      sourceName === oldName
        ? newName
        : `${newName}${sourceName.slice(oldName.length)}`,
  }));

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

export function getWalletFilesData(walletName: string): WalletFileData[] {
  validateWalletName(walletName);
  const fs = getWalletModuleFs();
  const keysName = walletKeysFileName(walletName);
  if (!isRootFile(fs, keysName)) {
    throw new Error(`Wallet keys file "${keysName}" does not exist`);
  }

  return listOwnedWalletFileNames(fs, walletName).map((name) => ({
    name,
    data: fs.readFile(name),
  }));
}

export function getAllWalletFilesData(): WalletFileData[] {
  const fs = getWalletModuleFs();
  const rootFileNames = listRootFileNames(fs);
  const files = listWalletNames().flatMap((walletName) =>
    getWalletFilesData(walletName),
  );
  const included = new Set(files.map((file) => file.name));
  for (const name of unexpectedKeysExportFileNames(rootFileNames)) {
    if (included.has(name)) {
      continue;
    }
    included.add(name);
    files.push({
      name,
      data: fs.readFile(name),
    });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

export function listUnexpectedKeysFileNames(): string[] {
  return unexpectedKeysFileNames(listRootFileNames(getWalletModuleFs()));
}

function listRootFileNames(fs: EmscriptenFs): string[] {
  return listRootNames(fs).filter((name) => isRootFile(fs, name));
}

export function listLeftoverWalletFileNames(): string[] {
  return leftoverWalletFileNames(listRootFileNames(getWalletModuleFs()));
}

export function getRawWalletStorageFilesData(): WalletFileData[] {
  const fs = getWalletModuleFs();
  return listRootFileNames(fs).map((name) => ({
    name,
    data: fs.readFile(name),
  }));
}

export function saveWalletFilesData(
  walletName: string,
  files: WalletFileData[],
): void {
  validateWalletName(walletName);
  const fs = getWalletModuleFs();
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

  const keysName = walletKeysFileName(walletName);
  if (!filesByName.has(keysName)) {
    throw new Error(`Wallet archive is missing required file "${keysName}"`);
  }
  if (walletStoragePathExists(walletName)) {
    throw new Error(`Wallet with name ${walletName} already exists`);
  }
  for (const name of filesByName.keys()) {
    if (pathExists(fs, name)) {
      throw new Error(`File ${name} already exists`);
    }
  }

  for (const [name, data] of filesByName) {
    fs.writeFile(name, data);
  }
}
