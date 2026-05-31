import { expect, test } from "@playwright/test";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("receive tab subaddress and QR", async ({ page }) => {
  test.setTimeout(120_000);

  const initial = new InitialWalletListPage(page);
  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openCreateWallet();
  const wallet = await initial.createNewWallet({
    walletName: `receive-${Date.now()}`,
  });

  const primaryAddress = await wallet.getPrimaryAddress();
  expect(primaryAddress.length).toBeGreaterThan(20);

  await test.step("Primary address QR opens", async () => {
    await wallet.openPrimaryAddressQr();
  });

  await test.step("Add labeled subaddress", async () => {
    await wallet.addSubaddress("Donations");
    await wallet.expectReceiveRowUnused("Donations (#1)");
    const subaddress = await wallet.getAddressFromReceiveRow("Donations (#1)");
    expect(subaddress.length).toBeGreaterThan(20);
    expect(subaddress).not.toBe(primaryAddress);
  });
});
