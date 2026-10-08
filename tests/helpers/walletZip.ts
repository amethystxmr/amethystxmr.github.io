import * as fs from "node:fs/promises";
import JSZip from "jszip";

export async function readZipEntryNames(zipPath: string): Promise<string[]> {
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  return Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function writeZipWithEntries(
  zipPath: string,
  entries: { name: string; data: Uint8Array | string }[],
): Promise<void> {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.name, entry.data);
  }
  const data = await zip.generateAsync({ type: "nodebuffer" });
  await fs.writeFile(zipPath, data);
}

export async function writeZipWithOnlyEntries(
  sourceZipPath: string,
  destinationZipPath: string,
  shouldInclude: (name: string) => boolean,
): Promise<void> {
  const sourceZip = await JSZip.loadAsync(await fs.readFile(sourceZipPath));
  const destinationZip = new JSZip();

  for (const entry of Object.values(sourceZip.files)) {
    if (entry.dir || !shouldInclude(entry.name)) {
      continue;
    }
    destinationZip.file(entry.name, await entry.async("uint8array"));
  }

  const data = await destinationZip.generateAsync({ type: "nodebuffer" });
  await fs.writeFile(destinationZipPath, data);
}

export async function writeZipWithAdditionalEntries(
  sourceZipPath: string,
  destinationZipPath: string,
  entries: { name: string; data: Uint8Array | string }[],
): Promise<void> {
  const sourceZip = await JSZip.loadAsync(await fs.readFile(sourceZipPath));
  const destinationZip = new JSZip();

  for (const entry of Object.values(sourceZip.files)) {
    if (entry.dir) {
      continue;
    }
    destinationZip.file(entry.name, await entry.async("uint8array"));
  }
  for (const entry of entries) {
    destinationZip.file(entry.name, entry.data);
  }

  const data = await destinationZip.generateAsync({ type: "nodebuffer" });
  await fs.writeFile(destinationZipPath, data);
}
