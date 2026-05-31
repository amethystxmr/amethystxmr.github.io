import { expect, test } from "@playwright/test";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("restore view-only wallet from keys", async ({ page }) => {
  test.setTimeout(180_000);

  const sourceWalletName = `view-src-${Date.now()}`;
  const viewOnlyWalletName = `view-only-${Date.now()}`;

  const initial = new InitialWalletListPage(page);
  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openCreateWallet();
  const sourceWallet = await initial.createNewWallet({
    walletName: sourceWalletName,
  });

  let keys: { address: string; privateViewKey: string };
  await test.step("Read address and view key from source wallet", async () => {
    await sourceWallet.openSeedKeysOverlay();
    keys = await sourceWallet.readSeedKeysOverlay();
    await sourceWallet.closeSeedKeysOverlay();
  });

  await test.step("Exit and restore as view-only", async () => {
    await sourceWallet.exitFromWallet();
    await initial.expectLoaded();
    await initial.openRestoreWallet();
    const viewOnlyWallet = await initial.restoreWalletFromKeys({
      walletName: viewOnlyWalletName,
      address: keys.address,
      secretViewKey: keys.privateViewKey,
      startingHeight: "0",
    });
    await viewOnlyWallet.expectViewOnlyMode();
    const restoredAddress = await viewOnlyWallet.getPrimaryAddress();
    expect(restoredAddress).toBe(keys.address);
  });
});
