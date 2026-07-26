import { expect, test } from "./fixtures/e2eTest";
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

test("restore spendable wallet from keys", async ({ page }) => {
  test.setTimeout(120_000);

  const initial = new InitialWalletListPage(page);
  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openRestoreWallet();

  const wallet = await initial.restoreWalletFromKeys({
    walletName: `from-keys-${Date.now()}`,
    address: FROM_KEYS_TEST_ADDRESS,
    secretViewKey: FROM_KEYS_TEST_PRIVATE_VIEW_KEY,
    secretSpendKey: FROM_KEYS_TEST_PRIVATE_SPEND_KEY,
    startingHeight: "30",
  });

  await wallet.expectSpendableWallet();
  expect(await wallet.getPrimaryAddress()).toBe(FROM_KEYS_TEST_ADDRESS);
});
