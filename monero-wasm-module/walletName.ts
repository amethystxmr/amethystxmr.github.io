const CONTROL_CHARACTER_RE = /[\x00-\x1f\x7f]/;

export function validateWalletName(walletName: string): string {
  const normalized = walletName.trim();

  if (normalized.length === 0) {
    throw new Error("Wallet name cannot be empty");
  }
  if (CONTROL_CHARACTER_RE.test(normalized)) {
    throw new Error("Wallet name cannot contain control characters");
  }
  if (normalized.includes("/") || normalized.includes("\\")) {
    throw new Error("Wallet name cannot contain path separators");
  }
  if (normalized === "." || normalized === "..") {
    throw new Error("Wallet name cannot be . or ..");
  }
  if (normalized.includes(".")) {
    throw new Error("Wallet name cannot contain dots");
  }

  const basename = normalized.replace(/\\/g, "/").split("/").pop();
  if (basename !== normalized) {
    throw new Error("Wallet name must be a plain file name");
  }

  return normalized;
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
