import { expect, test } from "@playwright/test";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("send form validation", async ({ page }) => {
  test.setTimeout(120_000);

  const initial = new InitialWalletListPage(page);
  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openCreateWallet();
  const wallet = await initial.createNewWallet({
    walletName: `send-val-${Date.now()}`,
  });

  const ownAddress = await wallet.getPrimaryAddress();

  await test.step("Invalid address keeps review disabled", async () => {
    await wallet.fillSendRecipient("not-a-valid-address", "1");
    await wallet.expectSendReviewDisabled();
  });

  await test.step("Valid address and amount enable review", async () => {
    await wallet.fillSendRecipient(ownAddress, "0.001");
    await expect(
      page.getByRole("button", { name: /review transaction/i }),
    ).toBeEnabled();
  });
});
