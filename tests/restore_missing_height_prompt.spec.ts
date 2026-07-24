import { expect, test } from "@playwright/test";
import {
  FROM_KEYS_TEST_ADDRESS,
  FROM_KEYS_TEST_PRIVATE_SPEND_KEY,
  FROM_KEYS_TEST_PRIVATE_VIEW_KEY,
} from "./constants";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("declining the missing-height prompt cancels the restore", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const initial = new InitialWalletListPage(page);
  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openRestoreWallet();

  await initial.submitRestoreFromKeysWithoutHeight({
    walletName: `missing-height-decline-${Date.now()}`,
    address: FROM_KEYS_TEST_ADDRESS,
    secretViewKey: FROM_KEYS_TEST_PRIVATE_VIEW_KEY,
    secretSpendKey: FROM_KEYS_TEST_PRIVATE_SPEND_KEY,
  });

  await initial.expectNoHeightConfirmVisible();
  await initial.declineUseDaemonHeight();

  await expect(
    page.getByRole("heading", { name: /restore wallet/i }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /receive/i })).toHaveCount(0);
});

test("confirming the missing-height prompt restores using the daemon height", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const initial = new InitialWalletListPage(page);
  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openRestoreWallet();

  await initial.submitRestoreFromKeysWithoutHeight({
    walletName: `missing-height-confirm-${Date.now()}`,
    address: FROM_KEYS_TEST_ADDRESS,
    secretViewKey: FROM_KEYS_TEST_PRIVATE_VIEW_KEY,
    secretSpendKey: FROM_KEYS_TEST_PRIVATE_SPEND_KEY,
  });

  await initial.expectNoHeightConfirmVisible();
  const wallet = await initial.confirmUseDaemonHeight();

  await wallet.expectSpendableWallet();
  expect(await wallet.getPrimaryAddress()).toBe(FROM_KEYS_TEST_ADDRESS);
});
