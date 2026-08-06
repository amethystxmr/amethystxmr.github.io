import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { AppAlertsPage } from "./pages/app-alerts.page";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";
import { ManageWalletsPage } from "./pages/manage-wallets.page";
import { WalletMainPage } from "./pages/wallet-main.page";
import { initializeAppTestSettings } from "./helpers/testSettings";
import {
  readZipEntryNames,
  writeZipWithAdditionalEntries,
  writeZipWithEntries,
  writeZipWithOnlyEntries,
} from "./helpers/walletZip";

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("wallet name inputs reject dots in create, restore, rename, and import", async ({
  page,
}) => {
  test.setTimeout(700_000);

  const ts = Date.now();
  const validWalletName = `strict-name-${ts}`;
  const e2eTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "strict-name-"));
  const invalidZipPath = path.join(e2eTmpDir, "invalid-dot.zip");
  const unsafeZipPath = path.join(e2eTmpDir, "unsafe-path.zip");

  const initial = new InitialWalletListPage(page);
  const manage = new ManageWalletsPage(page);
  const alerts = new AppAlertsPage(page);

  await initial.goto();
  await initial.waitUntilLoaded();

  await initial.openCreateWallet();
  await initial.fillCreateWalletName("a.b");
  await initial.submitCreateWalletForm();
  await alerts.dismissNoticeMatching(/cannot contain dots/i);
  await initial.cancelCreateOrRestore();
  await initial.expectMainHomeVisible();

  await initial.openRestoreWallet();
  await initial.fillRestoreWalletName("a.keys");
  await initial.submitRestoreWalletForm();
  await alerts.dismissNoticeMatching(/cannot contain dots/i);
  await initial.cancelCreateOrRestore();
  await initial.expectMainHomeVisible();

  await initial.openCreateWallet();
  const main = await initial.createNewWallet({ walletName: validWalletName });
  await main.exitFromWallet();
  await initial.expectLoaded();

  await initial.openManageWallets();
  await manage.expectLoaded();
  await manage.startRenameForWallet(validWalletName);
  await manage.submitRenameDialog("renamed.bad");
  await alerts.dismissNoticeMatching(/cannot contain dots/i);
  await manage.cancelRenameDialog();

  await writeZipWithEntries(invalidZipPath, [
    { name: "bad.name.keys", data: new Uint8Array([1, 2, 3]) },
  ]);
  await manage.importZipFromPath(invalidZipPath);
  await alerts.dismissImportCompletedExpectingWarning(/bad\.name/i);

  await writeZipWithEntries(unsafeZipPath, [
    { name: "../evil.keys", data: new Uint8Array([1, 2, 3]) },
  ]);
  await manage.importZipFromPath(unsafeZipPath);
  await alerts.dismissNoticeMatching(
    /Unsafe archive path:[\s\S]*\.\.\/evil\.keys/i,
  );
});

test("imports keys-only wallet archives and warns that cache is missing", async ({
  page,
}) => {
  test.setTimeout(700_000);

  const ts = Date.now();
  const walletName = `keys-only-${ts}`;
  const e2eTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "keys-only-"));
  const fullZipPath = path.join(e2eTmpDir, "full.zip");
  const keysOnlyZipPath = path.join(e2eTmpDir, "keys-only.zip");

  const initial = new InitialWalletListPage(page);
  const manage = new ManageWalletsPage(page);
  const alerts = new AppAlertsPage(page);

  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openCreateWallet();
  const main = await initial.createNewWallet({ walletName });
  const address = await main.getPrimaryAddress();
  await main.exitFromWallet();
  await initial.expectLoaded();

  await initial.openManageWallets();
  await manage.expectLoaded();
  await manage.exportWalletToPath(walletName, fullZipPath);
  await writeZipWithOnlyEntries(
    fullZipPath,
    keysOnlyZipPath,
    (name) => name === `${walletName}.keys`,
  );

  await manage.startRemoveForWallet(walletName);
  await manage.confirmRemoveDialog(walletName);
  await manage.expectEmptyState();

  await manage.importZipFromPath(keysOnlyZipPath);
  await alerts.dismissImportCompletedExpectingWarning(
    /wallet cache file is missing|has no wallet cache file/i,
  );
  await manage.expectWalletRowVisible(walletName);

  await manage.backToWalletList();
  await initial.expectMainHomeVisible();
  await initial.openWalletFromList(walletName);
  const reopened = new WalletMainPage(page);
  await reopened.waitUntilLoaded();
  expect(await reopened.getPrimaryAddress()).toBe(address);
});

test("import summary reports invalid names and unused nested files", async ({
  page,
}) => {
  const ts = Date.now();
  const walletName = `import-warn-${ts}`;
  const e2eTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "import-warn-"));
  const sourceZipPath = path.join(e2eTmpDir, "source.zip");
  const warningZipPath = path.join(e2eTmpDir, "warning.zip");
  const invalidZipPath = path.join(e2eTmpDir, "invalid.zip");

  const initial = new InitialWalletListPage(page);
  const manage = new ManageWalletsPage(page);
  const alerts = new AppAlertsPage(page);

  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openCreateWallet();
  const main = await initial.createNewWallet({ walletName });
  await main.exitFromWallet();
  await initial.expectLoaded();

  await initial.openManageWallets();
  await manage.expectLoaded();
  await manage.exportWalletToPath(walletName, sourceZipPath);
  await writeZipWithAdditionalEntries(sourceZipPath, warningZipPath, [
    { name: "notes/readme.txt", data: "not a wallet file" },
  ]);

  await manage.startRemoveForWallet(walletName);
  await manage.confirmRemoveDialog(walletName);
  await manage.expectEmptyState();

  await manage.importZipFromPath(warningZipPath);
  await alerts.dismissImportCompletedExpectingWarning(/notes\/readme\.txt/i);
  await manage.expectWalletRowVisible(walletName);

  await writeZipWithEntries(invalidZipPath, [
    { name: "bad.name.keys", data: new Uint8Array([1, 2, 3]) },
  ]);
  await manage.importZipFromPath(invalidZipPath);
  await alerts.dismissImportCompletedExpectingWarning(/bad\.name\.keys/i);
});

test("rename moves all flat companion files to the new wallet prefix", async ({
  page,
}) => {
  test.setTimeout(700_000);

  const ts = Date.now();
  const walletName = `companions-${ts}`;
  const renamedWalletName = `companions-renamed-${ts}`;
  const e2eTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "companions-"));
  const sourceZipPath = path.join(e2eTmpDir, "source.zip");
  const companionZipPath = path.join(e2eTmpDir, "companions.zip");
  const renamedZipPath = path.join(e2eTmpDir, "renamed.zip");

  const initial = new InitialWalletListPage(page);
  const manage = new ManageWalletsPage(page);
  const alerts = new AppAlertsPage(page);

  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openCreateWallet();
  const main = await initial.createNewWallet({ walletName });
  await main.exitFromWallet();
  await initial.expectLoaded();

  await initial.openManageWallets();
  await manage.expectLoaded();
  await manage.exportWalletToPath(walletName, sourceZipPath);
  await writeZipWithAdditionalEntries(sourceZipPath, companionZipPath, [
    { name: `${walletName}.mms`, data: "mms" },
    { name: `${walletName}.background`, data: "background" },
    { name: `${walletName}.background.keys`, data: "background keys" },
    {
      name: `${walletName}.background.address.txt`,
      data: "background address",
    },
  ]);

  await manage.startRemoveForWallet(walletName);
  await manage.confirmRemoveDialog(walletName);
  await manage.expectEmptyState();

  await manage.importZipFromPath(companionZipPath);
  await alerts.dismissImportCompletedExpectingWallets([walletName]);
  await manage.expectWalletRowVisible(walletName);

  await manage.startRenameForWallet(walletName);
  await manage.submitRenameDialog(renamedWalletName);
  await manage.expectWalletRowVisible(renamedWalletName);
  await manage.exportWalletToPath(renamedWalletName, renamedZipPath);

  const exportedNames = await readZipEntryNames(renamedZipPath);
  expect(exportedNames).toContain(`${renamedWalletName}.mms`);
  expect(exportedNames).toContain(`${renamedWalletName}.background`);
  expect(exportedNames).toContain(`${renamedWalletName}.background.keys`);
  expect(exportedNames).toContain(
    `${renamedWalletName}.background.address.txt`,
  );
  expect(exportedNames.some((name) => name.startsWith(`${walletName}.`))).toBe(
    false,
  );
});
