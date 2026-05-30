import { expect, test } from "@playwright/test";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";

const POLYSEED_RESTORE_SEED =
  "raven tail swear infant grief assist regular lamp duck valid someone little harsh puppy airport language";
const POLYSEED_RESTORE_ADDRESS =
  "47AjPj7DVPQVGGXJXbbTMZWcKQDejGHYZChVkeujy8qPLjKkgdsxge4DzvkRMgU4sDUigGLuBN9stKBMowhuXH2HJHWAuRf";

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("restore wallet from Cake 16-word polyseed", async ({ page }) => {
  test.setTimeout(300_000);

  const initial = new InitialWalletListPage(page);
  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openRestoreWallet();

  const wallet = await initial.restoreWallet({
    walletName: `polyseed-restore-${Date.now()}`,
    seed: POLYSEED_RESTORE_SEED,
    seedType: "cake-16",
  });

  const address = await wallet.getPrimaryAddress();
  expect(address).toBe(POLYSEED_RESTORE_ADDRESS);
});
