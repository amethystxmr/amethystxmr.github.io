import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { AppAlertsPage } from "./pages/app-alerts.page";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";
import { ManageWalletsPage } from "./pages/manage-wallets.page";
import { WalletMainPage } from "./pages/wallet-main.page";
import { initializeAppTestSettings } from "./helpers/testSettings";

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("wallet management cross-tab locks, rename, export, remove, import", async ({
  page: page1,
  context,
}) => {
  test.setTimeout(600_000);

  const ts = Date.now();
  const preflightWalletName = `wm-${ts}-preflight`;
  const originalWalletName = `wm-${ts}-original`;
  const renamedWalletName = `wm-${ts}-renamed`;

  const e2eTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wm-e2e-"));
  const preflightZipPath = path.join(e2eTmpDir, "preflight.zip");

  let primaryAddressAfterCreate = "";

  await test.step("Closed wallet on disk: cannot create, restore, or import same name again", async () => {
    const initial = new InitialWalletListPage(page1);
    const alerts1 = new AppAlertsPage(page1);
    const manage1 = new ManageWalletsPage(page1);
    await initial.goto();
    await initial.waitUntilLoaded();
    await initial.openCreateWallet();
    await initial.createNewWallet({ walletName: preflightWalletName });
    await new WalletMainPage(page1).exitFromWallet();
    await initial.expectLoaded();

    await initial.openCreateWallet();
    await initial.fillCreateWalletName(preflightWalletName);
    await initial.submitCreateWalletForm();
    await alerts1.dismissNoticeMatching(/already exists/i);
    await initial.cancelCreateOrRestore();
    await initial.expectMainHomeVisible();

    await initial.openRestoreWallet();
    await initial.fillRestoreWalletName(preflightWalletName);
    await initial.submitRestoreWalletForm();
    await alerts1.dismissNoticeMatching(/already exists/i);
    await initial.cancelCreateOrRestore();
    await initial.expectMainHomeVisible();

    await initial.openManageWallets();
    await manage1.expectLoaded();
    await manage1.exportWalletToPath(preflightWalletName, preflightZipPath);
    await manage1.importZipFromPath(preflightZipPath);
    await alerts1.dismissImportCompletedExpectingSkippedWallet(preflightWalletName);
    await manage1.backToWalletList();
    await initial.expectMainHomeVisible();
  });

  await test.step("Tab 1: create wallet and remember primary address", async () => {
    const initial = new InitialWalletListPage(page1);
    await initial.goto();
    await initial.waitUntilLoaded();
    await initial.openCreateWallet();
    const main = await initial.createNewWallet({
      walletName: originalWalletName,
    });
    primaryAddressAfterCreate = await main.getPrimaryAddress();
    expect(primaryAddressAfterCreate.length).toBeGreaterThan(20);
  });

  const page2 = await context.newPage();
  await initializeAppTestSettings(page2);
  const initial2 = new InitialWalletListPage(page2);
  const manage2 = new ManageWalletsPage(page2);
  const alerts2 = new AppAlertsPage(page2);

  await test.step("Tab 2: cannot create another wallet with the same name while tab 1 holds lock", async () => {
    await initial2.goto();
    await initial2.waitUntilLoaded();
    await initial2.openCreateWallet();
    await initial2.fillCreateWalletName(originalWalletName);
    await initial2.submitCreateWalletForm();
    await alerts2.dismissNoticeMatching(/currently open in another tab/i);
    await initial2.cancelCreateOrRestore();
    await initial2.expectMainHomeVisible();
  });

  await test.step("Tab 2: cannot restore with an existing wallet name", async () => {
    await initial2.openRestoreWallet();
    await initial2.fillRestoreWalletName(originalWalletName);
    await initial2.submitRestoreWalletForm();
    await alerts2.dismissNoticeMatching(/already exists/i);
    await initial2.cancelCreateOrRestore();
    await initial2.expectMainHomeVisible();
  });

  await test.step("Tab 2: cannot remove wallet while open in tab 1", async () => {
    await initial2.openManageWallets();
    await manage2.expectLoaded();
    await manage2.startRemoveForWallet(originalWalletName);
    await manage2.confirmRemoveDialog(originalWalletName);
    await alerts2.dismissNoticeMatching(/already opened in another tab/i);
  });

  await test.step("Tab 2: cannot rename wallet while open in tab 1", async () => {
    await manage2.startRenameForWallet(originalWalletName);
    await manage2.submitRenameDialog(`${originalWalletName}-x`);
    await alerts2.dismissNoticeMatching(/currently opened in another tab/i);
  });

  await test.step("Tab 1: exit wallet", async () => {
    const walletMain1 = new WalletMainPage(page1);
    await walletMain1.exitFromWallet();
    await new InitialWalletListPage(page1).expectLoaded();
  });

  await test.step("Tab 2: rename wallet succeeds", async () => {
    await manage2.startRenameForWallet(originalWalletName);
    await manage2.submitRenameDialog(renamedWalletName);
    await manage2.expectWalletRowVisible(renamedWalletName);
  });

  const zipPath = path.join(e2eTmpDir, "wallet.zip");

  await test.step("Tab 2: export wallet", async () => {
    await manage2.exportWalletToPath(renamedWalletName, zipPath);
  });

  await test.step("Tab 2: remove wallet", async () => {
    await manage2.startRemoveForWallet(renamedWalletName);
    await manage2.confirmRemoveDialog(renamedWalletName);
    await manage2.expectWalletRowVisible(preflightWalletName);
  });

  await test.step("Tab 2: main list no longer lists wallet", async () => {
    await manage2.backToWalletList();
    await initial2.expectMainHomeVisible();
    await initial2.expectWalletNotOnList(renamedWalletName);
  });

  await test.step("Tab 2: import wallet zip and see it in manage view", async () => {
    await initial2.openManageWallets();
    await manage2.expectLoaded();
    await manage2.importZipFromPath(zipPath);
    await alerts2.dismissNoticeMatching(/Import completed/i);
    await manage2.expectWalletRowVisible(renamedWalletName);
  });

  await test.step("Tab 2: main list, open wallet, address unchanged", async () => {
    await manage2.backToWalletList();
    await initial2.expectMainHomeVisible();
    await initial2.openWalletFromList(renamedWalletName);
    const reopened = new WalletMainPage(page2);
    await reopened.waitUntilLoaded();
    const addressAfterImport = await reopened.getPrimaryAddress();
    expect(addressAfterImport).toBe(primaryAddressAfterCreate);
  });

  await page2.close();
});
