import { validateWalletName } from "../../../monero-wasm-module/walletName";

export type WalletArchiveEntry = {
  path: string;
  isDirectory: boolean;
  data: Uint8Array;
};

export type WalletArchiveCandidateFile = {
  archivePath: string;
  storageName: string;
  data: Uint8Array;
};

export type WalletArchiveCandidate = {
  walletName: string;
  files: WalletArchiveCandidateFile[];
};

export type WalletArchiveInvalidName = {
  archivePath: string;
  walletName: string;
  reason: string;
};

export type WalletArchivePlan = {
  candidates: WalletArchiveCandidate[];
  invalidWalletNames: WalletArchiveInvalidName[];
  unusedFiles: string[];
  warnings: string[];
  errors: string[];
};

type RootArchiveFile = {
  archivePath: string;
  storageName: string;
  data: Uint8Array;
};

const WALLET_KEYS_SUFFIX = ".keys";

function formatValidationError(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid wallet name";
}

function validateArchivePath(rawPath: string): string[] | null {
  if (rawPath.length === 0) {
    return null;
  }
  if (rawPath.includes("\\")) {
    return null;
  }
  if (rawPath.startsWith("/") || /^[a-zA-Z]:/.test(rawPath)) {
    return null;
  }

  const segments = rawPath.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    return null;
  }

  return segments;
}

function makeCandidateFile(
  file: RootArchiveFile,
  walletName: string,
): WalletArchiveCandidateFile | null {
  if (file.storageName === walletName) {
    return file;
  }
  if (file.storageName.startsWith(`${walletName}.`)) {
    return file;
  }
  return null;
}

export function planWalletArchiveImport(
  entries: WalletArchiveEntry[],
): WalletArchivePlan {
  const plan: WalletArchivePlan = {
    candidates: [],
    invalidWalletNames: [],
    unusedFiles: [],
    warnings: [],
    errors: [],
  };

  const rootFiles = new Map<string, RootArchiveFile>();
  const seenStorageNames = new Set<string>();
  const duplicateStorageNames = new Set<string>();
  const invalidStorageNames = new Set<string>();

  for (const entry of entries) {
    const archivePath =
      entry.isDirectory && entry.path.endsWith("/")
        ? entry.path.slice(0, -1)
        : entry.path;
    const segments = validateArchivePath(archivePath);
    if (!segments) {
      plan.errors.push(`Unsafe archive path: ${entry.path}`);
      continue;
    }
    if (segments[0] === "__MACOSX") {
      continue;
    }
    if (entry.isDirectory) {
      continue;
    }
    if (segments.length !== 1) {
      plan.unusedFiles.push(entry.path);
      continue;
    }

    const storageName = segments[0];
    if (seenStorageNames.has(storageName)) {
      duplicateStorageNames.add(storageName);
      rootFiles.delete(storageName);
      plan.errors.push(`Duplicate archive file: ${storageName}`);
      continue;
    }
    if (duplicateStorageNames.has(storageName)) {
      continue;
    }
    seenStorageNames.add(storageName);
    rootFiles.set(storageName, {
      archivePath: entry.path,
      storageName,
      data: entry.data,
    });
  }

  const walletNames: string[] = [];
  for (const file of rootFiles.values()) {
    if (!file.storageName.endsWith(WALLET_KEYS_SUFFIX)) {
      continue;
    }

    const rawWalletName = file.storageName.slice(0, -WALLET_KEYS_SUFFIX.length);
    try {
      const walletName = validateWalletName(rawWalletName);
      if (walletName !== rawWalletName) {
        throw new Error("Wallet name must not need trimming in archive files");
      }
      walletNames.push(walletName);
    } catch (error) {
      const companionWalletName = rawWalletName.split(".")[0] || rawWalletName;
      const isCompanionFile =
        companionWalletName.length > 0 &&
        rootFiles.has(`${companionWalletName}${WALLET_KEYS_SUFFIX}`) &&
        file.storageName.startsWith(`${companionWalletName}.`);

      if (!isCompanionFile) {
        invalidStorageNames.add(file.storageName);
        plan.invalidWalletNames.push({
          archivePath: file.archivePath,
          walletName: rawWalletName,
          reason: formatValidationError(error),
        });
      }
    }
  }

  const assignedFiles = new Map<string, string>();
  for (const walletName of walletNames.sort((a, b) => a.localeCompare(b))) {
    const candidateFiles: WalletArchiveCandidateFile[] = [];
    for (const file of rootFiles.values()) {
      const candidateFile = makeCandidateFile(file, walletName);
      if (!candidateFile) {
        continue;
      }

      const previousWalletName = assignedFiles.get(file.storageName);
      if (previousWalletName && previousWalletName !== walletName) {
        plan.errors.push(
          `Archive file "${file.storageName}" could belong to both "${previousWalletName}" and "${walletName}"`,
        );
        continue;
      }
      assignedFiles.set(file.storageName, walletName);
      candidateFiles.push(candidateFile);
    }

    if (!candidateFiles.some((file) => file.storageName === walletName)) {
      plan.warnings.push(
        `Wallet "${walletName}" has no wallet cache file; it will be recreated/refreshed after open.`,
      );
    }

    plan.candidates.push({
      walletName,
      files: candidateFiles.sort((a, b) =>
        a.storageName.localeCompare(b.storageName),
      ),
    });
  }

  for (const file of rootFiles.values()) {
    if (
      !assignedFiles.has(file.storageName) &&
      !invalidStorageNames.has(file.storageName)
    ) {
      plan.unusedFiles.push(file.archivePath);
    }
  }

  plan.unusedFiles.sort((a, b) => a.localeCompare(b));
  plan.errors.sort((a, b) => a.localeCompare(b));
  plan.invalidWalletNames.sort((a, b) =>
    a.archivePath.localeCompare(b.archivePath),
  );

  return plan;
}
