import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";
import { WalletMainPage } from "./pages/wallet-main.page";

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

async function expectNoticeThenDismiss(page: Page, pattern: RegExp): Promise<void> {
  await expect(page.getByText(pattern)).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: /^OK$/ }).click();
}

async function exitWalletThroughUi(walletMain: WalletMainPage): Promise<void> {
  await walletMain.openTab("other");
  // Exit triggers reload immediately after enqueueing alert(); "Loading" is usually skipped — wait on navigation instead.
  await Promise.all([
    walletMain.page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    walletMain.page.getByRole("button", { name: /exit/i }).click(),
  ]);
}

test("wallet management cross-tab locks, rename, export, remove, import", async ({
  page: page1,
  context,
}) => {
  test.setTimeout(600_000);

  const ts = Date.now();
  const originalWalletName = `wm-${ts}`;
  const renamedWalletName = `wm-${ts}-renamed`;

  let primaryAddressAfterCreate = "";

  await test.step("Tab 1: create wallet and remember primary address", async () => {
    const initial = new InitialWalletListPage(page1);
    await initial.goto();
    await initial.waitUntilLoaded();
    await initial.openCreateWallet();
    const main = await initial.createNewWallet({ walletName: originalWalletName });
    primaryAddressAfterCreate = await main.getPrimaryAddress();
    expect(primaryAddressAfterCreate.length).toBeGreaterThan(20);
  });

  const page2 = await context.newPage();
  await initializeAppTestSettings(page2);

  await test.step("Tab 2: cannot create another wallet with the same name while tab 1 holds lock", async () => {
    const initial2 = new InitialWalletListPage(page2);
    await initial2.goto();
    await initial2.waitUntilLoaded();
    await initial2.openCreateWallet();
    await page2
      .locator("div")
      .filter({ hasText: /^Wallet name$/ })
      .locator("input")
      .first()
      .fill(originalWalletName);
    await page2.getByRole("button", { name: /create wallet/i }).click();
    await expectNoticeThenDismiss(page2, /currently open in another tab/i);
    await page2.getByRole("button", { name: /^✖ Cancel$/ }).click();
    await expect(page2.getByRole("heading", { name: /amethyst xmr wallet/i })).toBeVisible();
  });

  await test.step("Tab 2: cannot restore with an existing wallet name", async () => {
    await page2.getByRole("button", { name: /restore/i }).click();
    await expect(page2.getByRole("heading", { name: /restore wallet/i })).toBeVisible();
    await page2
      .locator("div")
      .filter({ hasText: /^Wallet name$/ })
      .locator("input")
      .first()
      .fill(originalWalletName);
    await page2.getByRole("button", { name: /restore wallet/i }).click();
    await expectNoticeThenDismiss(page2, /already exists/i);
    await page2.getByRole("button", { name: /^✖ Cancel$/ }).click();
    await expect(page2.getByRole("heading", { name: /amethyst xmr wallet/i })).toBeVisible();
  });

  await test.step("Tab 2: cannot remove wallet while open in tab 1", async () => {
    await page2.getByRole("button", { name: /manage wallets/i }).click();
    await expect(page2.getByRole("heading", { name: /manage wallets/i })).toBeVisible();
    await page2.getByRole("button", { name: "🗑 Remove" }).first().click();
    await page2.getByPlaceholder(originalWalletName).fill(originalWalletName);
    await page2.getByRole("button", { name: /^Remove wallet$/ }).click();
    await expectNoticeThenDismiss(page2, /already opened in another tab/i);
  });

  await test.step("Tab 2: cannot rename wallet while open in tab 1", async () => {
    await page2.getByRole("button", { name: "✎ Rename" }).first().click();
    const renameForm = page2.locator("form").filter({ hasText: /Enter new name for/i });
    await renameForm.locator("input").fill(`${originalWalletName}-x`);
    await renameForm.getByRole("button", { name: /rename wallet/i }).click();
    await expectNoticeThenDismiss(page2, /currently opened in another tab/i);
  });

  await test.step("Tab 1: exit wallet (reload)", async () => {
    const walletMain1 = new WalletMainPage(page1);
    await exitWalletThroughUi(walletMain1);
    const initialAgain = new InitialWalletListPage(page1);
    await initialAgain.waitUntilLoaded();
  });

  await test.step("Tab 2: rename wallet succeeds", async () => {
    await page2.getByRole("button", { name: "✎ Rename" }).first().click();
    const renameForm = page2.locator("form").filter({ hasText: /Enter new name for/i });
    await renameForm.locator("input").fill(renamedWalletName);
    await renameForm.getByRole("button", { name: /rename wallet/i }).click();
    await expect(page2.getByText(renamedWalletName, { exact: true })).toBeVisible({
      timeout: 120_000,
    });
  });

  const zipPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "wm-e2e-")), "wallet.zip");

  await test.step("Tab 2: export wallet", async () => {
    const downloadPromise = page2.waitForEvent("download");
    await page2.getByRole("button", { name: "⬇︎ Export" }).first().click();
    const download = await downloadPromise;
    await download.saveAs(zipPath);
  });

  await test.step("Tab 2: remove wallet", async () => {
    await page2.getByRole("button", { name: "🗑 Remove" }).first().click();
    await page2.getByPlaceholder(renamedWalletName).fill(renamedWalletName);
    await page2.getByRole("button", { name: /^Remove wallet$/ }).click();
    await expect(page2.getByText(/No wallets available/i)).toBeVisible({ timeout: 120_000 });
  });

  await test.step("Tab 2: main list no longer lists wallet", async () => {
    await page2.getByRole("button", { name: /^← Back$/ }).click();
    await expect(page2.getByRole("heading", { name: /amethyst xmr wallet/i })).toBeVisible();
    await expect(page2.getByRole("button", { name: renamedWalletName })).toHaveCount(0);
  });

  await test.step("Tab 2: import wallet zip and see it in manage view", async () => {
    await page2.getByRole("button", { name: /manage wallets/i }).click();
    await expect(page2.getByRole("heading", { name: /manage wallets/i })).toBeVisible();
    const fileInput = page2.locator('input[type="file"][accept*="zip"]');
    await fileInput.setInputFiles(zipPath);
    await expectNoticeThenDismiss(page2, /Import completed/i);
    await expect(page2.getByText(renamedWalletName, { exact: true })).toBeVisible();
  });

  await test.step("Tab 2: main list, open wallet, address unchanged", async () => {
    await page2.getByRole("button", { name: /^← Back$/ }).click();
    await expect(page2.getByRole("heading", { name: /amethyst xmr wallet/i })).toBeVisible();
    await page2.getByRole("button", { name: renamedWalletName }).click();
    const reopened = new WalletMainPage(page2);
    await reopened.waitUntilLoaded();
    const addressAfterImport = await reopened.getPrimaryAddress();
    expect(addressAfterImport).toBe(primaryAddressAfterCreate);
  });

  await page2.close();
});
