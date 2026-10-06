import {
  WALLET_KEYS_SUFFIX,
  isWalletOwnedFileName,
  validateWalletName,
  walletKeysFileName,
  walletNameFromKeysCompanionFile,
} from "../../../monero-wasm-module/walletName";

export type WalletArchiveEntry = {
  path: string;
  isDirectory: boolean;
  data?: Uint8Array;
};

export type WalletArchiveCandidateFile = {
  archivePath: string;
  storageName: string;
  data?: Uint8Array;
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

type RootArchiveFile = WalletArchiveCandidateFile;

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

function emptyPlan(): WalletArchivePlan {
  return {
    candidates: [],
    invalidWalletNames: [],
    unusedFiles: [],
    warnings: [],
    errors: [],
  };
}

function archivePathOf(entry: WalletArchiveEntry): string {
  return entry.isDirectory && entry.path.endsWith("/")
    ? entry.path.slice(0, -1)
    : entry.path;
}

function collectRootFiles(
  entries: WalletArchiveEntry[],
  plan: WalletArchivePlan,
): Map<string, RootArchiveFile> {
  const rootFiles = new Map<string, RootArchiveFile>();
  const seenStorageNames = new Set<string>();
  const duplicateStorageNames = new Set<string>();

  for (const entry of entries) {
    const archivePath = archivePathOf(entry);
    const segments = validateArchivePath(archivePath);
    if (!segments) {
      plan.errors.push(`Unsafe archive path: ${entry.path}`);
      continue;
    }
    if (
      segments[0] === "__MACOSX" &&
      (entry.isDirectory || segments.length > 1)
    ) {
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

  return rootFiles;
}

function recordInvalidKeysFile(
  file: RootArchiveFile,
  rawWalletName: string,
  error: unknown,
  rootFiles: Map<string, RootArchiveFile>,
  invalidStorageNames: Set<string>,
  plan: WalletArchivePlan,
): void {
  const companionWalletName = walletNameFromKeysCompanionFile(file.storageName);
  const isCompanionFile =
    companionWalletName !== null &&
    rootFiles.has(walletKeysFileName(companionWalletName));
  if (isCompanionFile) {
    return;
  }

  invalidStorageNames.add(file.storageName);
  const reason = formatValidationError(error);
  if (rawWalletName.includes(".")) {
    plan.errors.push(
      `Invalid wallet name in archive file "${file.archivePath}": ${reason}`,
    );
    return;
  }

  plan.invalidWalletNames.push({
    archivePath: file.archivePath,
    walletName: rawWalletName,
    reason,
  });
}

function collectWalletNames(
  rootFiles: Map<string, RootArchiveFile>,
  plan: WalletArchivePlan,
): { walletNames: string[]; invalidStorageNames: Set<string> } {
  const walletNames: string[] = [];
  const invalidStorageNames = new Set<string>();

  for (const file of rootFiles.values()) {
    if (!file.storageName.endsWith(WALLET_KEYS_SUFFIX)) {
      continue;
    }

    const rawWalletName = file.storageName.slice(0, -WALLET_KEYS_SUFFIX.length);
    try {
      validateWalletName(rawWalletName);
      walletNames.push(rawWalletName);
    } catch (error) {
      recordInvalidKeysFile(
        file,
        rawWalletName,
        error,
        rootFiles,
        invalidStorageNames,
        plan,
      );
    }
  }

  walletNames.sort((a, b) => a.localeCompare(b));
  return { walletNames, invalidStorageNames };
}

function assignWalletFiles(
  rootFiles: Map<string, RootArchiveFile>,
  walletNames: string[],
  invalidStorageNames: Set<string>,
  plan: WalletArchivePlan,
): void {
  const assignedFiles = new Map<string, string>();

  for (const walletName of walletNames) {
    const candidateFiles: WalletArchiveCandidateFile[] = [];
    for (const file of rootFiles.values()) {
      if (
        invalidStorageNames.has(file.storageName) ||
        !isWalletOwnedFileName(walletName, file.storageName)
      ) {
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
      candidateFiles.push(file);
    }

    if (!candidateFiles.some((file) => file.storageName === walletName)) {
      plan.warnings.push(
        `Wallet "${walletName}" has no wallet cache file; it will be recreated/refreshed after open.`,
      );
    }

    candidateFiles.sort((a, b) => a.storageName.localeCompare(b.storageName));
    plan.candidates.push({ walletName, files: candidateFiles });
  }

  for (const file of rootFiles.values()) {
    if (
      !assignedFiles.has(file.storageName) &&
      !invalidStorageNames.has(file.storageName)
    ) {
      plan.unusedFiles.push(file.archivePath);
    }
  }
}

export function planWalletArchiveImport(
  entries: WalletArchiveEntry[],
): WalletArchivePlan {
  const plan = emptyPlan();
  const rootFiles = collectRootFiles(entries, plan);
  const { walletNames, invalidStorageNames } = collectWalletNames(
    rootFiles,
    plan,
  );
  assignWalletFiles(rootFiles, walletNames, invalidStorageNames, plan);

  plan.unusedFiles.sort((a, b) => a.localeCompare(b));
  plan.errors.sort((a, b) => a.localeCompare(b));
  plan.invalidWalletNames.sort((a, b) =>
    a.archivePath.localeCompare(b.archivePath),
  );

  return plan;
}
