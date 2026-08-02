import JSZip from "jszip";
import {
  api as walletApi,
  type WalletFileData,
} from "../../../monero-wasm-module/walletApi.workerClient";
import {
  planWalletArchiveImport,
  type WalletArchiveCandidate,
  type WalletArchiveEntry,
  type WalletArchiveInvalidName,
} from "./walletArchiveCandidates";

export type WalletImportSummary = {
  imported: string[];
  skippedExisting: string[];
  invalidWalletNames: WalletArchiveInvalidName[];
  warnings: string[];
  unusedFiles: string[];
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function getArchivePath(zipEntry: JSZip.JSZipObject): string {
  return zipEntry.unsafeOriginalName ?? zipEntry.name;
}

async function buildZipBlob(files: WalletFileData[]): Promise<Blob> {
  const zip = new JSZip();
  const names = new Set<string>();

  for (const file of files) {
    if (names.has(file.name)) {
      throw new Error(`Duplicate wallet file "${file.name}"`);
    }
    names.add(file.name);
    zip.file(file.name, file.data);
  }

  return await zip.generateAsync({ type: "blob" });
}

export async function buildWalletZip(files: WalletFileData[]): Promise<Blob> {
  return await buildZipBlob(files);
}

export async function buildWalletsZip(files: WalletFileData[]): Promise<Blob> {
  return await buildZipBlob(files);
}

export async function readWalletArchive(
  file: File,
): Promise<WalletArchiveEntry[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const zipEntries = Object.values(zip.files);
  const entries: WalletArchiveEntry[] = zipEntries.map((zipEntry) => ({
    path: getArchivePath(zipEntry),
    isDirectory: zipEntry.dir,
  }));

  const metadataPlan = planWalletArchiveImport(entries);
  if (metadataPlan.errors.length > 0) {
    return entries;
  }

  const walletArchivePaths = new Set(
    metadataPlan.candidates.flatMap((candidate) =>
      candidate.files.map((candidateFile) => candidateFile.archivePath),
    ),
  );
  if (walletArchivePaths.size === 0) {
    return entries;
  }

  const entriesWithData: WalletArchiveEntry[] = [];

  for (const zipEntry of zipEntries) {
    const entry: WalletArchiveEntry = {
      path: getArchivePath(zipEntry),
      isDirectory: zipEntry.dir,
    };

    if (entry.isDirectory || !walletArchivePaths.has(entry.path)) {
      entriesWithData.push(entry);
      continue;
    }

    entriesWithData.push({
      ...entry,
      data: await zipEntry.async("uint8array"),
    });
  }

  return entriesWithData;
}

function getCandidateFileData(file: WalletArchiveCandidate["files"][number]) {
  if (file.data === undefined) {
    throw new Error(`Archive file "${file.archivePath}" was not read`);
  }

  return file.data;
}

export async function importWalletArchiveEntries(
  entries: WalletArchiveEntry[],
): Promise<WalletImportSummary> {
  const plan = planWalletArchiveImport(entries);
  if (plan.errors.length > 0) {
    throw new Error(
      `Import archive is unsafe or ambiguous:\n${plan.errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
  }

  const summary: WalletImportSummary = {
    imported: [],
    skippedExisting: [],
    invalidWalletNames: plan.invalidWalletNames,
    warnings: [...plan.warnings],
    unusedFiles: plan.unusedFiles,
  };

  if (
    plan.candidates.length === 0 &&
    plan.invalidWalletNames.length === 0 &&
    plan.unusedFiles.length === 0
  ) {
    summary.warnings.push("No wallet keys files were found in the archive.");
  }

  const candidatesToImport: WalletArchiveCandidate[] = [];
  for (const candidate of plan.candidates) {
    if (await walletApi.walletStoragePathExists(candidate.walletName)) {
      summary.skippedExisting.push(candidate.walletName);
    } else {
      candidatesToImport.push(candidate);
    }
  }

  for (const candidate of candidatesToImport) {
    try {
      await walletApi.saveWalletFilesData(
        candidate.walletName,
        candidate.files.map((file) => ({
          name: file.storageName,
          data: getCandidateFileData(file),
        })),
      );
      summary.imported.push(candidate.walletName);
    } catch (error) {
      throw new Error(
        `Failed to import wallet "${candidate.walletName}": ${getErrorMessage(
          error,
        )}`,
      );
    }
  }

  summary.imported.sort((a, b) => a.localeCompare(b));
  summary.skippedExisting.sort((a, b) => a.localeCompare(b));
  summary.warnings.sort((a, b) => a.localeCompare(b));
  summary.unusedFiles.sort((a, b) => a.localeCompare(b));

  return summary;
}

function formatListSection(
  title: string,
  items: string[],
  emptyText: string,
): string {
  if (items.length === 0) {
    return `${title} (0):\n${emptyText}`;
  }
  return `${title} (${items.length}):\n${items
    .map((item) => `- ${item}`)
    .join("\n")}`;
}

export function formatImportSummary(summary: WalletImportSummary): string {
  const invalidNames = summary.invalidWalletNames.map(
    (item) => `${item.walletName} (${item.archivePath}): ${item.reason}`,
  );

  return [
    "Import completed.",
    "",
    formatListSection(
      "Imported",
      summary.imported,
      "No wallets were imported.",
    ),
    "",
    formatListSection(
      "Skipped (already exists)",
      summary.skippedExisting,
      "No wallets were skipped.",
    ),
    "",
    formatListSection(
      "Invalid wallet names",
      invalidNames,
      "No invalid wallet names.",
    ),
    "",
    formatListSection("Warnings", summary.warnings, "No warnings."),
    "",
    formatListSection("Unused files", summary.unusedFiles, "No unused files."),
  ].join("\n");
}
