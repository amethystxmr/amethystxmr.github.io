import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { AppAlertsPage } from "./pages/app-alerts.page";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";
import { ManageWalletsPage } from "./pages/manage-wallets.page";
import { WalletMainPage } from "./pages/wallet-main.page";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { readZipEntryNames } from "./helpers/walletZip";

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("export all and import all keep flat wallet archive layout", async ({
  page,
}) => {
  test.setTimeout(900_000);

  const ts = Date.now();
  const walletA = `export-all-a-${ts}`;
  const walletB = `export-all-b-${ts}`;
  const e2eTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wallet-all-"));
  const exportAllZipPath = path.join(e2eTmpDir, "all-wallets.zip");
  const addresses = new Map<string, string>();

  const initial = new InitialWalletListPage(page);
  const manage = new ManageWalletsPage(page);
  const alerts = new AppAlertsPage(page);

  await initial.goto();
  await initial.waitUntilLoaded();

  for (const walletName of [walletA, walletB]) {
    await initial.openCreateWallet();
    const main = await initial.createNewWallet({ walletName });
    addresses.set(walletName, await main.getPrimaryAddress());
    await main.exitFromWallet();
    await initial.expectLoaded();
  }

  await initial.openManageWallets();
  await manage.expectLoaded();
  await manage.exportAllWalletsToPath(exportAllZipPath);

  const exportedNames = await readZipEntryNames(exportAllZipPath);
  expect(exportedNames).toContain(walletA);
  expect(exportedNames).toContain(`${walletA}.keys`);
  expect(exportedNames).toContain(walletB);
  expect(exportedNames).toContain(`${walletB}.keys`);
  expect(exportedNames.every((name) => !name.includes("/"))).toBe(true);

  for (const walletName of [walletA, walletB]) {
    await manage.startRemoveForWallet(walletName);
    await manage.confirmRemoveDialog(walletName);
  }
  await manage.expectEmptyState();

  await manage.importZipFromPath(exportAllZipPath);
  await alerts.dismissImportCompletedExpectingWallets([walletA, walletB]);
  await manage.expectWalletRowVisible(walletA);
  await manage.expectWalletRowVisible(walletB);

  await manage.backToWalletList();
  await initial.expectMainHomeVisible();

  for (const walletName of [walletA, walletB]) {
    await initial.openWalletFromList(walletName);
    const reopened = new WalletMainPage(page);
    await reopened.waitUntilLoaded();
    expect(await reopened.getPrimaryAddress()).toBe(addresses.get(walletName));
    await reopened.exitFromWallet();
    await initial.expectLoaded();
  }
});
