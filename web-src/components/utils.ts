import {
  loadFilesystem,
  MoneroWasmWallet,
  saveFilesystem,
} from "../../monero-wasm-module/walletApi";

export function balanceToString(balance: bigint): string {
  // 1000000000n = 0.001
  // 0765432100n = 0.0007654321
  // 0000000765432100n = 0.0007654321
  const scale = 12;

  const digits = balance.toString().padStart(scale + 1, "0");
  const integerPart = digits.slice(0, -scale);
  const fractionalPart = digits.slice(-scale).replace(/0+$/, ""); // trim trailing zeros

  const result =
    fractionalPart.length > 0
      ? `${integerPart}.${fractionalPart}`
      : integerPart;
  return result;
}

export function toFiat(balance: bigint, price: number): number {
  // Convert balance from atomic units to XMR
  const balanceInXmr = Number(balance) / 1e12;
  return balanceInXmr * price;
}

export function stringToBalance(str: string): bigint {
  if (!/^\d*\.?\d*$/.test(str)) {
    throw new Error("Invalid balance string");
  }
  const [integerPart, fractionalPart = ""] = str.split(".");
  if (fractionalPart.length > 12) {
    throw new Error("Too many decimal places");
  }
  const paddedFractional = fractionalPart.padEnd(12, "0");
  const combined = integerPart + paddedFractional;
  return BigInt(combined);
}

export function shortenAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

export function formatWalletTimestamp(
  timestamp: bigint,
  options: {
    hideDateIfToday?: boolean;
    hideCurrentYear?: boolean;
  } = {},
): string {
  const date = new Date(Number(timestamp) * 1000);
  const hideDateIfToday = options.hideDateIfToday ?? false;
  const hideCurrentYear = options.hideCurrentYear ?? false;
  const now = new Date();

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const isCurrentYear = date.getFullYear() === now.getFullYear();

  if (hideDateIfToday && isToday) {
    return new Intl.DateTimeFormat(undefined, {
      hour12: false,
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    hour12: false,
    ...(hideCurrentYear && isCurrentYear ? {} : { year: "numeric" as const }),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export async function withOriginLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (navigator.locks?.request) {
    return navigator.locks.request(
      `origin:${name}`,
      { mode: "exclusive" },
      async () => {
        return await fn();
      },
    );
  }
  // Do nothing if locks are not supported, just run the function
  return await fn();
}

export async function withFsLock<T>(fn: () => Promise<T>): Promise<T> {
  return withOriginLock("fs-lock", async () => {
    await loadFilesystem();
    const result = await fn();
    await saveFilesystem();
    return result;
  });
}

export async function saveWalletIntoFs(wallet: MoneroWasmWallet) {
  return withFsLock(async () => {
    await wallet.store();
  });
}

export function downloadBlob(
  blob: Blob,
  fileName: string,
  revokeDelayMs: number = 1000,
) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.style.display = "none";
  link.click();

  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, revokeDelayMs);
}
