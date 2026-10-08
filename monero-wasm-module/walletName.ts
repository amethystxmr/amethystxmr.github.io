const CONTROL_CHARACTER_RE = /[\x00-\x1f\x7f]/;

function walletNameError(walletName: string): string | null {
  if (walletName.length === 0) {
    return "Wallet name cannot be empty";
  }
  if (walletName.trim() !== walletName) {
    return "Wallet name cannot have leading or trailing whitespace";
  }
  if (CONTROL_CHARACTER_RE.test(walletName)) {
    return "Wallet name cannot contain control characters";
  }
  if (walletName.includes("/") || walletName.includes("\\")) {
    return "Wallet name cannot contain path separators";
  }
  if (walletName.includes(":")) {
    return "Wallet name cannot contain colons";
  }
  if (walletName === "." || walletName === "..") {
    return "Wallet name cannot be . or ..";
  }
  if (walletName.includes(".")) {
    return "Wallet name cannot contain dots";
  }

  const basename = walletName.replace(/\\/g, "/").split("/").pop();
  if (basename !== walletName) {
    return "Wallet name must be a plain file name";
  }

  return null;
}

export function isWalletNameAllowed(walletName: string): boolean {
  return walletNameError(walletName) === null;
}

export function validateWalletName(walletName: string): void {
  const error = walletNameError(walletName);
  if (error !== null) {
    throw new Error(error);
  }
}

export const WALLET_KEYS_SUFFIX = ".keys";

/** Keys files that belong to a wallet but are not a second wallet, such as `alice.background.keys`. */
const WALLET_KEYS_COMPANION_SUFFIXES = [".background.keys"] as const;

export function walletKeysFileName(walletName: string): string {
  return `${walletName}${WALLET_KEYS_SUFFIX}`;
}

export function walletNameFromKeysFile(fileName: string): string | null {
  if (!fileName.endsWith(WALLET_KEYS_SUFFIX)) {
    return null;
  }
  const walletName = fileName.slice(0, -WALLET_KEYS_SUFFIX.length);
  return isWalletNameAllowed(walletName) ? walletName : null;
}

export function walletNameFromKeysCompanionFile(
  fileName: string,
): string | null {
  for (const suffix of WALLET_KEYS_COMPANION_SUFFIXES) {
    if (!fileName.endsWith(suffix)) {
      continue;
    }
    const walletName = fileName.slice(0, -suffix.length);
    return isWalletNameAllowed(walletName) ? walletName : null;
  }
  return null;
}

export function isWalletOwnedFileName(
  walletName: string,
  fileName: string,
): boolean {
  return fileName === walletName || fileName.startsWith(`${walletName}.`);
}

/** A root file owned by `walletName`, and not another wallet's `.keys` file. */
export function isWalletStorageFileOwned(
  walletName: string,
  fileName: string,
  walletAnchorNames: ReadonlySet<string>,
): boolean {
  if (!isWalletOwnedFileName(walletName, fileName)) {
    return false;
  }
  const otherWalletName = walletNameFromKeysFile(fileName);
  return (
    otherWalletName === null ||
    otherWalletName === walletName ||
    !walletAnchorNames.has(otherWalletName)
  );
}

/**
 * `.keys` files that are not a listed wallet and not a companion such as
 * `alice.background.keys`.
 */
export function unexpectedKeysFileNames(
  rootFileNames: readonly string[],
): string[] {
  return rootFileNames.filter((name) => {
    if (!name.endsWith(WALLET_KEYS_SUFFIX)) {
      return false;
    }
    if (walletNameFromKeysFile(name) !== null) {
      return false;
    }
    return walletNameFromKeysCompanionFile(name) === null;
  });
}

/** Unexpected keys files, plus the matching cache file when it is present. */
export function unexpectedKeysExportFileNames(
  rootFileNames: readonly string[],
): string[] {
  const present = new Set(rootFileNames);
  const names: string[] = [];
  for (const keysName of unexpectedKeysFileNames(rootFileNames)) {
    names.push(keysName);
    const cacheName = keysName.slice(0, -WALLET_KEYS_SUFFIX.length);
    if (present.has(cacheName)) {
      names.push(cacheName);
    }
  }
  return names;
}

/** Root files that are not part of any wallet this app will list. */
export function leftoverWalletFileNames(
  rootFileNames: readonly string[],
): string[] {
  const walletAnchorNames = new Set<string>();
  for (const name of rootFileNames) {
    const walletName = walletNameFromKeysFile(name);
    if (walletName) {
      walletAnchorNames.add(walletName);
    }
  }

  const ownedNames = new Set<string>();
  for (const walletName of walletAnchorNames) {
    for (const name of rootFileNames) {
      if (isWalletStorageFileOwned(walletName, name, walletAnchorNames)) {
        ownedNames.add(name);
      }
    }
  }

  return rootFileNames.filter((name) => !ownedNames.has(name));
}

export function getWalletDisplayName(walletFilePath: string): string {
  const normalizedPath = walletFilePath.replace(/\\/g, "/");
  const basename =
    normalizedPath
      .split("/")
      .filter((segment) => segment.length > 0)
      .pop() || walletFilePath;

  return basename.endsWith(WALLET_KEYS_SUFFIX)
    ? basename.slice(0, -WALLET_KEYS_SUFFIX.length)
    : basename;
}
