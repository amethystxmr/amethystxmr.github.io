const CONTROL_CHARACTER_RE = /[\x00-\x1f\x7f]/;

export function validateWalletName(walletName: string): void {
  if (walletName.length === 0) {
    throw new Error("Wallet name cannot be empty");
  }
  if (walletName.trim() !== walletName) {
    throw new Error("Wallet name cannot have leading or trailing whitespace");
  }
  if (CONTROL_CHARACTER_RE.test(walletName)) {
    throw new Error("Wallet name cannot contain control characters");
  }
  if (walletName.includes("/") || walletName.includes("\\")) {
    throw new Error("Wallet name cannot contain path separators");
  }
  if (walletName === "." || walletName === "..") {
    throw new Error("Wallet name cannot be . or ..");
  }
  if (walletName.includes(".")) {
    throw new Error("Wallet name cannot contain dots");
  }

  const basename = walletName.replace(/\\/g, "/").split("/").pop();
  if (basename !== walletName) {
    throw new Error("Wallet name must be a plain file name");
  }
}

export function isWalletNameAllowed(walletName: string): boolean {
  try {
    validateWalletName(walletName);
    return true;
  } catch {
    return false;
  }
}

export function getWalletDisplayName(walletFilePath: string): string {
  const normalizedPath = walletFilePath.replace(/\\/g, "/");
  const basename =
    normalizedPath
      .split("/")
      .filter((segment) => segment.length > 0)
      .pop() || walletFilePath;

  return basename.endsWith(".keys") ? basename.slice(0, -5) : basename;
}
